-- View-only circuit placements on an invited client's calendar.
-- Apply once in the Supabase SQL editor AFTER 20261123200000_circuits.sql
-- and 20261111180000_programs.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. No Edge Function.
--
-- What it does
--   A trainer's circuit placed on the trainer's own calendar shows on the
--   calendar of each linked client invited to that circuit. The client cannot
--   read the circuit row or the other people on it.
--   public.circuit_guest_placements(p_client) returns only the day, the start
--   and end, the circuit name, and the trainer's display name.
--   The caller may be that client, or a trainer with a live link to that client.
--   A display name that is an email is returned as Trainer.
--
-- Until this is applied, the calendar still loads. The app treats a missing
-- function as no guest placements.

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
set search_path = public
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
  where e.owner_id <> p_client
    and exists (
      select 1
      from public.trainer_clients link
      where link.trainer_id = c.owner_id
        and link.client_id = p_client
        and link.ended_at is null
    )
    and exists (
      select 1
      from jsonb_array_elements(coalesce(c.data->'clients', '[]'::jsonb)) person
      where person->>'source' = 'linked'
        and lower(person->>'id') = lower(p_client::text)
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
