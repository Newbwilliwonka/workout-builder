-- View-only circuit placements for clients invited onto a calendar day.
-- Apply once in the Supabase SQL editor AFTER 20261123200000_circuits.sql
-- and 20261111180000_programs.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. No Edge Function.
--
-- What it does
--   Invites live on the placement, not on the circuit. A trainer can invite
--   any linked client when they schedule a circuit. Those clients see the
--   circuit on their calendar. The invite does not decide who is in class.
--   public.circuit_guest_placements(p_client) returns the placement id, the
--   day, the start and end, the circuit name, and the trainer's display name.
--   A client sees placements they were invited to by a linked trainer.
--   A trainer looking at someone else sees only circuits that trainer owns.
--   A display name that is an email is returned as Trainer.
--
-- Until this is applied, the calendar still loads. The app treats a missing
-- function as no guest placements.

create table if not exists public.circuit_placement_invites (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  placement_id text not null,
  client_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint circuit_placement_invites_placement_len check (char_length(placement_id) between 1 and 80),
  constraint circuit_placement_invites_unique unique (trainer_id, placement_id, client_id)
);

comment on table public.circuit_placement_invites is
  'Clients invited to see one circuit placement. Not the class roster.';

create index if not exists circuit_placement_invites_client_idx
  on public.circuit_placement_invites (client_id, trainer_id);

alter table public.circuit_placement_invites enable row level security;

revoke all on public.circuit_placement_invites from public, anon, authenticated;
grant select, insert, update, delete on public.circuit_placement_invites to authenticated;

drop policy if exists circuit_invites_trainer on public.circuit_placement_invites;
create policy circuit_invites_trainer
  on public.circuit_placement_invites
  for all
  to authenticated
  using (
    trainer_id = (select auth.uid())
    and (select public.program_is_trainer((select auth.uid())))
  )
  with check (
    trainer_id = (select auth.uid())
    and (select public.program_is_trainer((select auth.uid())))
  );

drop policy if exists circuit_invites_invitee_read on public.circuit_placement_invites;
create policy circuit_invites_invitee_read
  on public.circuit_placement_invites
  for select
  to authenticated
  using (client_id = (select auth.uid()));

drop function if exists public.circuit_guest_placements(uuid);

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
set search_path = public, pg_temp
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
