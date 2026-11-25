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

-- Copy invites already stored in the side table onto the row that owns them.
-- The placement guard sets updated_at to now() when nobody is signed in, so
-- this pauses that guard (and the invite triggers, once they exist) and
-- writes the previous updated_at back. A row that already has invitees is
-- left alone, so running this file again does not move the clock or the list.
do $pause_entry_guards$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'program_entries_guard' and tgrelid = 'public.program_entries'::regclass
  ) then
    alter table public.program_entries disable trigger program_entries_guard;
  end if;
  if exists (
    select 1 from pg_trigger
    where tgname = 'program_entry_invitees_guard' and tgrelid = 'public.program_entries'::regclass
  ) then
    alter table public.program_entries disable trigger program_entry_invitees_guard;
  end if;
  if exists (
    select 1 from pg_trigger
    where tgname = 'program_entry_invitees_project' and tgrelid = 'public.program_entries'::regclass
  ) then
    alter table public.program_entries disable trigger program_entry_invitees_project;
  end if;
end
$pause_entry_guards$;

update public.program_entries placed
set invitees = existing.ids,
    updated_at = placed.updated_at
from (
  select trainer_id, placement_id, array_agg(distinct client_id) as ids
  from public.circuit_placement_invites
  group by trainer_id, placement_id
) existing
where placed.owner_id = existing.trainer_id
  and placed.local_id = existing.placement_id
  and placed.invitees = '{}';

do $resume_entry_guards$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'program_entries_guard' and tgrelid = 'public.program_entries'::regclass
  ) then
    alter table public.program_entries enable trigger program_entries_guard;
  end if;
  if exists (
    select 1 from pg_trigger
    where tgname = 'program_entry_invitees_guard' and tgrelid = 'public.program_entries'::regclass
  ) then
    alter table public.program_entries enable trigger program_entry_invitees_guard;
  end if;
  if exists (
    select 1 from pg_trigger
    where tgname = 'program_entry_invitees_project' and tgrelid = 'public.program_entries'::regclass
  ) then
    alter table public.program_entries enable trigger program_entry_invitees_project;
  end if;
end
$resume_entry_guards$;

create or replace function public.program_entry_invitees_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
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
  -- Migrations and the service role run with no signed-in user, same as
  -- program_entries_guard. A signed-in caller still has to own the row,
  -- be a trainer, and invite only a live linked client.
  if auth.uid() is null then
    return new;
  end if;
  if new.owner_id is distinct from auth.uid() or not public.program_is_trainer(auth.uid()) then
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
set search_path = ''
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
set search_path = ''
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

-- Re-apply the guest read with an empty search_path. Creating it in the
-- earlier file is not enough when that file was already applied.
create or replace function public.circuit_guest_placements(p_client uuid)
returns table (
  placement_id text,
  day date,
  starts_at text,
  ends_at text,
  circuit_name text,
  trainer_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_client is null then
    return;
  end if;
  if auth.uid() is distinct from p_client
     and not (
       public.program_is_trainer(auth.uid())
       and exists (
         select 1
         from public.trainer_clients link
         where link.trainer_id = auth.uid()
           and link.client_id = p_client
           and link.ended_at is null
       )
     ) then
    return;
  end if;

  return query
  select
    e.local_id,
    e.day,
    to_char(e.starts_at, 'HH24:MI'),
    to_char(e.ends_at, 'HH24:MI'),
    c.name,
    case
      when p.display_name is null or position('@' in p.display_name) > 0 then 'Trainer'
      else left(btrim(p.display_name), 80)
    end
  from public.program_entries e
  join public.circuits c
    on c.owner_id = e.owner_id
   and c.id::text = e.workout_local_id
  join public.profiles p
    on p.id = c.owner_id
  where (
      auth.uid() = p_client
      or c.owner_id = auth.uid()
    )
    and exists (
      select 1
      from public.circuit_placement_invites inv
      where inv.trainer_id = c.owner_id
        and inv.placement_id = e.local_id
        and inv.client_id = p_client
    )
    and exists (
      select 1
      from public.trainer_clients link
      where link.trainer_id = c.owner_id
        and link.client_id = p_client
        and link.ended_at is null
    )
    and exists (
      select 1
      from jsonb_array_elements(coalesce(e.items, '[]'::jsonb)) item
      where item->>'source' = 'circuit'
        and item->>'circuitId' = c.id::text
    );
end;
$$;

revoke all on function public.circuit_guest_placements(uuid) from public, anon;
grant execute on function public.circuit_guest_placements(uuid) to authenticated;
