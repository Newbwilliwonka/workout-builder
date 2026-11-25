-- Optional client info for the signed-in user.
-- Apply once in the Supabase SQL editor AFTER 20261107160000_invites.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. No Edge Function.
--
-- The person writes their own row. A trainer can read it only while a
-- trainer_clients link to that person is still live. Age is not stored.

create table if not exists public.client_info (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  birthday date,
  sex text,
  height_cm numeric,
  weight_kg numeric,
  goals text[] not null default '{}',
  goals_other text,
  updated_at timestamptz not null default now(),
  constraint client_info_sex check (sex is null or sex in ('male', 'female')),
  constraint client_info_height check (height_cm is null or (height_cm >= 30 and height_cm <= 280)),
  constraint client_info_weight check (weight_kg is null or (weight_kg >= 1 and weight_kg <= 500)),
  constraint client_info_other_len check (goals_other is null or char_length(goals_other) <= 120),
  constraint client_info_other_at check (goals_other is null or position('@' in goals_other) = 0)
);

comment on table public.client_info is
  'Optional body and goal notes. Only the person can change the row.';

alter table public.client_info enable row level security;

revoke all on public.client_info from public, anon, authenticated;
grant select, insert, update, delete on public.client_info to authenticated;

create or replace function public.client_info_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  goal text;
  allowed text[] := array[
    'Weight or fat loss',
    'Building strength and muscle',
    'General health and fitness',
    'Mobility or pain relief',
    'Athletic performance',
    'Other'
  ];
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null and old.user_id is distinct from auth.uid() then
      raise exception 'Only you can change your client info.';
    end if;
    return old;
  end if;

  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    raise exception 'Only you can change your client info.';
  end if;
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'That client info cannot be reassigned.';
  end if;

  if new.sex is not null and new.sex not in ('male', 'female') then
    raise exception 'Choose Male or Female.';
  end if;
  if new.birthday is not null and new.birthday > current_date then
    raise exception 'Birthday cannot be in the future.';
  end if;

  if new.goals_other is not null then
    new.goals_other := btrim(new.goals_other);
    if new.goals_other = '' then
      new.goals_other := null;
    end if;
  end if;
  if new.goals_other is not null and char_length(new.goals_other) > 120 then
    raise exception 'Other goals can be at most 120 characters.';
  end if;
  if new.goals_other is not null and position('@' in new.goals_other) > 0 then
    raise exception 'Other goals cannot include an email.';
  end if;

  if new.goals is null then
    new.goals := '{}';
  end if;
  foreach goal in array new.goals loop
    if goal is null or not (goal = any (allowed)) then
      raise exception 'Choose a goal from the list.';
    end if;
  end loop;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists client_info_guard on public.client_info;
create trigger client_info_guard
  before insert or update or delete on public.client_info
  for each row execute function public.client_info_guard();

revoke all on function public.client_info_guard() from public, anon;
grant execute on function public.client_info_guard() to authenticated;

-- The caller cannot read trainer_clients directly. This check runs as the
-- owner so a live link can allow a select without opening that table.
create or replace function public.client_info_trainer_can_read(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trainer_clients link
    where link.trainer_id = auth.uid()
      and link.client_id = p_client
      and link.ended_at is null
  );
$$;

revoke all on function public.client_info_trainer_can_read(uuid) from public, anon;
grant execute on function public.client_info_trainer_can_read(uuid) to authenticated;

drop policy if exists client_info_select on public.client_info;
create policy client_info_select
  on public.client_info
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.client_info_trainer_can_read(user_id))
  );

drop policy if exists client_info_insert on public.client_info;
create policy client_info_insert
  on public.client_info
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists client_info_update on public.client_info;
create policy client_info_update
  on public.client_info
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists client_info_delete on public.client_info;
create policy client_info_delete
  on public.client_info
  for delete
  to authenticated
  using (user_id = (select auth.uid()));
