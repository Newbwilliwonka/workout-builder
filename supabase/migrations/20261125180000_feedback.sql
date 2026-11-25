-- In-app feedback. A signed-in person can file their own note.
-- Apply once in the Supabase SQL editor AFTER 20261125130000_circuit_history.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. No Edge Function.
--
-- The sender can insert only their own row and cannot read anyone else's.
-- Only the admin can read and update every row. Display names come from
-- private.shown_name. This file does not return another person's address.
--
-- A reply is a normal row in public.messages. If the admin and the sender
-- are not already connected, the admin-only function opens the same kind of
-- temporary conversation Messages already uses, then inserts the message.
-- Policies on public.messages stay as they are.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  page text not null,
  type text not null,
  message text not null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  replied_at timestamptz,
  constraint feedback_page_len check (char_length(page) between 1 and 120),
  constraint feedback_type_check check (type in ('bug', 'idea', 'other')),
  constraint feedback_message_len check (char_length(message) between 1 and 2000),
  constraint feedback_status_check check (status in ('new', 'replied', 'fixed'))
);

comment on table public.feedback is
  'Notes sent from the app. A person inserts their own row. Only the admin can read or update every row.';

create index if not exists feedback_created_idx
  on public.feedback (created_at desc, id desc);

alter table public.feedback enable row level security;

revoke all on public.feedback from public, anon, authenticated;
grant select, insert, update on public.feedback to authenticated;

create or replace function public.feedback_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is null then
      raise exception 'Sign in first.';
    end if;
    if new.user_id is distinct from (select auth.uid()) then
      raise exception 'You can only send your own feedback.';
    end if;
    new.page := btrim(coalesce(new.page, ''));
    new.message := btrim(coalesce(new.message, ''));
    new.type := lower(btrim(coalesce(new.type, '')));
    if new.page = '' then
      raise exception 'Enter a page.';
    end if;
    if char_length(new.page) > 120 then
      raise exception 'That page name is too long.';
    end if;
    if new.type not in ('bug', 'idea', 'other') then
      raise exception 'Choose Bug, Idea, or Other.';
    end if;
    if new.message = '' then
      raise exception 'Enter a message.';
    end if;
    if char_length(new.message) > 2000 then
      raise exception 'That message is too long.';
    end if;
    if (
      select count(*)
      from public.feedback f
      where f.user_id = new.user_id
        and f.created_at > now() - interval '1 minute'
    ) >= 4 then
      raise exception 'Please wait a moment before sending again.';
    end if;
    new.status := 'new';
    new.replied_at := null;
    new.created_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not private.is_admin() then
      raise exception 'Only the admin can update feedback.';
    end if;
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.page is distinct from old.page
       or new.type is distinct from old.type
       or new.message is distinct from old.message
       or new.created_at is distinct from old.created_at then
      raise exception 'Feedback details cannot change.';
    end if;
    if new.status not in ('new', 'replied', 'fixed') then
      raise exception 'Choose a status.';
    end if;
    if new.status = 'replied' and new.status is distinct from old.status then
      new.replied_at := now();
    end if;
    if new.status = 'replied' and new.replied_at is null then
      new.replied_at := now();
    end if;
    if new.status is distinct from 'replied' then
      new.replied_at := old.replied_at;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if (select auth.uid()) is not null then
      raise exception 'Feedback cannot be deleted.';
    end if;
    return old;
  end if;

  return null;
end;
$fn$;

revoke all on function public.feedback_guard() from public, anon;
grant execute on function public.feedback_guard() to authenticated;

drop trigger if exists feedback_guard on public.feedback;
create trigger feedback_guard
  before insert or update or delete on public.feedback
  for each row execute function public.feedback_guard();

drop policy if exists feedback_select_own on public.feedback;
create policy feedback_select_own
  on public.feedback
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists feedback_select_admin on public.feedback;
create policy feedback_select_admin
  on public.feedback
  for select
  to authenticated
  using ((select private.is_admin()));

drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own
  on public.feedback
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists feedback_update_admin on public.feedback;
create policy feedback_update_admin
  on public.feedback
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Admin list. Empty unless private.is_admin() is true. Names only.
create or replace view public.feedback_admin
with (security_barrier = true, security_invoker = false) as
select
  f.id,
  f.user_id,
  case
    when nullif(btrim(p.display_name), '') is not null
     and position('@' in btrim(p.display_name)) = 0
    then btrim(p.display_name)
    else case p.membership
      when 'free_client' then 'Client'
      when 'enthusiast' then 'Enthusiast'
      when 'trainer' then 'Trainer'
      when 'master_trainer' then 'Trainer'
      else 'Member'
    end
  end as display_name,
  f.page,
  f.type,
  f.message,
  f.status,
  f.created_at,
  f.replied_at
from public.feedback f
join public.profiles p on p.id = f.user_id
where private.is_admin();

revoke all on table public.feedback_admin from public, anon, authenticated;
grant select on table public.feedback_admin to authenticated;

-- Sends the reply as a normal message, then marks the note replied.
-- Callable by any signed-in role; the admin check is inside the function.
create or replace function public.feedback_reply(p_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  note public.feedback;
  clean text := btrim(coalesce(p_body, ''));
  trainer uuid;
  client uuid;
  message_id uuid := gen_random_uuid();
  created public.messages;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_admin() then
    raise exception 'Only the admin can reply to feedback.';
  end if;
  if char_length(clean) < 1 or char_length(clean) > 2000 then
    raise exception 'Enter a message.';
  end if;
  select * into note from public.feedback where id = p_id;
  if not found then
    raise exception 'That feedback was not found.';
  end if;
  if note.user_id = uid then
    raise exception 'You cannot message yourself.';
  end if;

  select c.trainer_id, c.client_id into trainer, client
  from public.trainer_clients c
  where c.ended_at is null
    and (
      (c.trainer_id = uid and c.client_id = note.user_id)
      or (c.trainer_id = note.user_id and c.client_id = uid)
    )
  limit 1;

  if trainer is null then
    select t.trainer_id, t.client_id into trainer, client
    from public.trainer_temp_links t
    where t.ended_at is null
      and t.converted_at is null
      and t.expires_at > now()
      and (
        (t.trainer_id = uid and t.client_id = note.user_id)
        or (t.trainer_id = note.user_id and t.client_id = uid)
      )
    limit 1;
  end if;

  if trainer is null then
    update public.trainer_temp_links
      set ended_at = now()
    where trainer_id = uid
      and client_id = note.user_id
      and ended_at is null
      and converted_at is null
      and expires_at <= now();
    perform set_config('app.temp_link', 'on', true);
    insert into public.trainer_temp_links (trainer_id, client_id, expires_at)
    values (uid, note.user_id, now() + interval '7 days');
    perform set_config('app.temp_link', 'off', true);
    trainer := uid;
    client := note.user_id;
  end if;

  insert into public.messages (id, trainer_id, client_id, sender_id, body)
  values (message_id, trainer, client, uid, clean)
  returning * into created;

  update public.feedback
    set status = 'replied',
        replied_at = now()
  where id = note.id;

  return jsonb_build_object(
    'id', created.id,
    'senderId', created.sender_id,
    'body', created.body,
    'at', created.created_at,
    'feedbackId', note.id,
    'status', 'replied'
  );
end;
$fn$;

revoke all on function public.feedback_reply(uuid, text) from public, anon, authenticated;
grant execute on function public.feedback_reply(uuid, text) to authenticated;

notify pgrst, 'reload schema';
