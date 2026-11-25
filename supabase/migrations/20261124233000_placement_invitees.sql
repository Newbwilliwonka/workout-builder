-- Invitees ride on the placement row, so one upsert saves the day and the invites.
-- Apply once in the Supabase SQL editor AFTER 20261124200000_circuit_guest_calendar.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. No Edge Function.
--
-- What it does
--   program_entries.invitees is the list for that placement. Saving the row
--   writes the list in the same statement. A trigger checks each id against a
--   live trainer_clients link and copies the list into circuit_placement_invites
--   before the statement commits. Deleting the placement still removes those
--   invite rows through the existing foreign key.

alter table public.program_entries
  add column if not exists invitees uuid[] not null default '{}';

comment on column public.program_entries.invitees is
  'Clients invited to see this placement. Written with the placement, not in a later call.';

-- Keep any invites already stored in the side table on the row that owns them.
update public.program_entries placed
set invitees = existing.ids
from (
  select trainer_id, placement_id, array_agg(distinct client_id) as ids
  from public.circuit_placement_invites
  group by trainer_id, placement_id
) existing
where placed.owner_id = existing.trainer_id
  and placed.local_id = existing.placement_id
  and placed.invitees = '{}';

create or replace function public.program_entry_invitees_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wanted uuid[];
begin
  if tg_op = 'UPDATE' and new.invitees is not distinct from old.invitees then
    return new;
  end if;

  select coalesce(array_agg(distinct cid), '{}'::uuid[])
    into wanted
  from unnest(coalesce(new.invitees, '{}'::uuid[])) as cid
  where cid is not null;
  new.invitees := wanted;

  if cardinality(wanted) = 0 then
    return new;
  end if;
  if auth.uid() is null or new.owner_id is distinct from auth.uid() or not public.program_is_trainer(auth.uid()) then
    raise exception 'Only a trainer can invite clients.';
  end if;
  if exists (
    select 1
    from unnest(wanted) as cid
    where not exists (
      select 1
      from public.trainer_clients link
      where link.trainer_id = auth.uid()
        and link.client_id = cid
        and link.ended_at is null
    )
  ) then
    raise exception 'Invite only linked clients.';
  end if;
  return new;
end;
$$;

drop trigger if exists program_entry_invitees_guard on public.program_entries;
create trigger program_entry_invitees_guard
  before insert or update on public.program_entries
  for each row execute function public.program_entry_invitees_guard();

create or replace function public.program_entry_invitees_project()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.circuit_placement_invites
  where trainer_id = new.owner_id
    and placement_id = new.local_id
    and not (client_id = any (coalesce(new.invitees, '{}'::uuid[])));

  insert into public.circuit_placement_invites (trainer_id, placement_id, client_id)
  select new.owner_id, new.local_id, cid
  from unnest(coalesce(new.invitees, '{}'::uuid[])) as cid
  where not exists (
    select 1
    from public.circuit_placement_invites inv
    where inv.trainer_id = new.owner_id
      and inv.placement_id = new.local_id
      and inv.client_id = cid
  );
  return null;
end;
$$;

drop trigger if exists program_entry_invitees_project on public.program_entries;
create trigger program_entry_invitees_project
  after insert or update of invitees on public.program_entries
  for each row execute function public.program_entry_invitees_project();

-- The old two-step save now writes the same column. The trigger projects the
-- invite table, so a failed check rolls the placement change back with it.
drop function if exists public.circuit_placement_invites_save(text, uuid[]);

create or replace function public.circuit_placement_invites_save(p_placement text, p_clients uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wanted uuid[];
begin
  if auth.uid() is null then
    raise exception 'Sign in to save invites.';
  end if;
  if not public.program_is_trainer(auth.uid()) then
    raise exception 'Only a trainer can invite clients.';
  end if;
  if p_placement is null or char_length(btrim(p_placement)) < 1 or char_length(p_placement) > 80 then
    raise exception 'That placement was not found.';
  end if;

  select coalesce(array_agg(distinct cid), '{}'::uuid[])
    into wanted
  from unnest(coalesce(p_clients, '{}'::uuid[])) as cid
  where cid is not null;

  update public.program_entries
  set invitees = wanted
  where owner_id = auth.uid()
    and local_id = p_placement;
  if not found then
    raise exception 'That placement was not found.';
  end if;
end;
$$;

revoke all on function public.program_entry_invitees_guard() from public, anon;
revoke all on function public.program_entry_invitees_project() from public, anon;
revoke all on function public.circuit_placement_invites_save(text, uuid[]) from public, anon;

grant execute on function public.program_entry_invitees_guard() to authenticated;
grant execute on function public.program_entry_invitees_project() to authenticated;
grant execute on function public.circuit_placement_invites_save(text, uuid[]) to authenticated;
