-- Group circuits a trainer sets up for a class.
-- Apply once in the Supabase SQL editor AFTER 20261117180000_invite_only_access.sql
-- and 20261111180000_programs.sql (program_is_trainer):
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. No Edge Function.
--
-- What it stores
--   public.circuits
--     One row per saved circuit. name is the title. data holds the stations,
--     their grid squares, the closed loop order, the clock, and the clients.
--     Linked clients are stored by id and display name. Manual clients are
--     a typed name. There is no reps field and no weight field.
--     This table is not account_workouts. Circuits do not show up in
--     Workouts, Programs, or Send.
--
-- Who can use a row (row level security)
--   The owner can select, insert, update, and delete their own rows.
--   Nobody else can read them. anon has no access.
--   Insert is trainers only (Trainer or Master Trainer, same rule as
--   program_is_trainer, including a saved trainer plan that is not a
--   client membership yet). Update and delete stay with the owner.
--   A person who is not approved cannot write.
--   The database sets updated_at. A row cannot be handed to someone else.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.circuits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.circuits is
  'Trainer group circuits. Owner-only. Not part of workouts, programs, or send.';

create index if not exists circuits_owner_updated_idx
  on public.circuits (owner_id, updated_at desc);

alter table public.circuits enable row level security;

revoke all on public.circuits from public, anon, authenticated;
grant select, insert, update, delete on public.circuits to authenticated;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'circuits_name_len' and conrelid = 'public.circuits'::regclass
  ) then
    alter table public.circuits
      add constraint circuits_name_len check (char_length(name) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'circuits_data_object' and conrelid = 'public.circuits'::regclass
  ) then
    alter table public.circuits
      add constraint circuits_data_object check (
        jsonb_typeof(data) = 'object'
        and octet_length(data::text) <= 80000
      );
  end if;
end
$constraints$;

create or replace function private.circuit_keys(value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(key order by key), '{}'::text[])
  from jsonb_object_keys(value) as key;
$$;

create or replace function private.circuit_int(value jsonb, lo int, hi int)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  raw text;
  n int;
begin
  if jsonb_typeof(value) is distinct from 'number' then
    return null;
  end if;
  raw := value #>> '{}';
  if raw !~ '^(0|[1-9][0-9]*)$' then
    return null;
  end if;
  n := raw::int;
  if n < lo or n > hi then
    return null;
  end if;
  return n;
end;
$$;

revoke all on function private.circuit_keys(jsonb) from public, anon, authenticated;
revoke all on function private.circuit_int(jsonb, int, int) from public, anon, authenticated;

create or replace function public.circuits_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  station jsonb;
  item jsonb;
  exercise jsonb;
  keys text[];
  ids text[] := '{}';
  positions text[] := '{}';
  ordered text[] := '{}';
  linked text[] := '{}';
  manuals text[] := '{}';
  sid text;
  ename text;
  lib text;
  cname text;
  cid text;
  src text;
  pos text;
  col int;
  row_n int;
  n int;
  work_sec int;
  move_sec int;
  rounds int;
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null and old.owner_id is distinct from auth.uid() then
      raise exception 'You can only delete your own circuit.';
    end if;
    return old;
  end if;

  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      if new.owner_id is not null and new.owner_id is distinct from auth.uid() then
        raise exception 'You can only change your own circuit.';
      end if;
      new.owner_id := auth.uid();
      new.created_at := now();
      if not public.program_is_trainer(auth.uid()) then
        raise exception 'Only a trainer can save a circuit.';
      end if;
      if not private.is_approved(auth.uid()) then
        raise exception 'Your account is waiting for approval.';
      end if;
    else
      if old.owner_id is distinct from auth.uid() then
        raise exception 'You can only change your own circuit.';
      end if;
      if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id then
        raise exception 'That circuit cannot be reassigned.';
      end if;
      new.owner_id := old.owner_id;
      new.created_at := old.created_at;
      if not private.is_approved(auth.uid()) then
        raise exception 'Your account is waiting for approval.';
      end if;
    end if;
  end if;

  new.updated_at := now();
  new.name := btrim(coalesce(new.name, ''));
  if char_length(new.name) < 1 or position('@' in new.name) > 0 then
    raise exception 'Name this circuit.';
  end if;
  if char_length(new.name) > 80 then
    raise exception 'That name is too long.';
  end if;

  if new.data is null or jsonb_typeof(new.data) is distinct from 'object' then
    raise exception 'That circuit could not be saved.';
  end if;
  if octet_length(new.data::text) > 80000 then
    raise exception 'This circuit is too large.';
  end if;
  if new.data::text ~ '"(reps|weight|sets|rest|restSec|repetitions|mode|modeConfig)"[[:space:]]*:' then
    raise exception 'Take out reps and weight. Circuits track time only.';
  end if;
  if private.circuit_keys(new.data) is distinct from array['clients', 'clock', 'order', 'stations']::text[] then
    raise exception 'That circuit could not be saved.';
  end if;

  if jsonb_typeof(new.data->'stations') is distinct from 'array' then
    raise exception 'That circuit could not be saved.';
  end if;
  n := jsonb_array_length(new.data->'stations');
  if n < 1 then
    raise exception 'Add a station.';
  end if;
  if n > 24 then
    raise exception 'The grid is full.';
  end if;

  for station in select value from jsonb_array_elements(new.data->'stations') loop
    if jsonb_typeof(station) is distinct from 'object'
       or private.circuit_keys(station) is distinct from array['col', 'exercise', 'id', 'row']::text[] then
      raise exception 'That circuit could not be saved.';
    end if;
    if jsonb_typeof(station->'id') is distinct from 'string' then
      raise exception 'That circuit could not be saved.';
    end if;
    sid := station->>'id';
    if sid !~ '^st_[a-z0-9]{6,20}$' or sid = any (ids) then
      raise exception 'That circuit could not be saved.';
    end if;
    col := private.circuit_int(station->'col', 0, 3);
    row_n := private.circuit_int(station->'row', 0, 5);
    if col is null or row_n is null then
      raise exception 'Move that station onto the grid.';
    end if;
    pos := col::text || ',' || row_n::text;
    if pos = any (positions) then
      raise exception 'Two stations are on the same square.';
    end if;
    exercise := station->'exercise';
    if jsonb_typeof(exercise) is distinct from 'object' then
      raise exception 'Choose an exercise for every station.';
    end if;
    src := exercise->>'source';
    if src = 'library' then
      if private.circuit_keys(exercise) is distinct from array['libraryId', 'name', 'source']::text[] then
        raise exception 'Choose an exercise for every station.';
      end if;
      if jsonb_typeof(exercise->'libraryId') is distinct from 'string' then
        raise exception 'Choose an exercise for every station.';
      end if;
      lib := exercise->>'libraryId';
      if lib !~ '^[A-Za-z0-9_-]{1,32}$' then
        raise exception 'Choose an exercise for every station.';
      end if;
    elsif src = 'manual' then
      keys := private.circuit_keys(exercise);
      if keys is distinct from array['libraryId', 'name', 'source']::text[]
         and keys is distinct from array['name', 'source']::text[] then
        raise exception 'Choose an exercise for every station.';
      end if;
      if keys = array['libraryId', 'name', 'source']::text[]
         and jsonb_typeof(exercise->'libraryId') is distinct from 'null' then
        raise exception 'Choose an exercise for every station.';
      end if;
    else
      raise exception 'Choose an exercise for every station.';
    end if;
    ename := btrim(coalesce(exercise->>'name', ''));
    if char_length(ename) < 1 or char_length(ename) > 80 or position('@' in ename) > 0
       or ename is distinct from coalesce(exercise->>'name', '') then
      raise exception 'Choose an exercise for every station.';
    end if;
    ids := ids || sid;
    positions := positions || pos;
  end loop;

  if jsonb_typeof(new.data->'order') is distinct from 'array'
     or jsonb_array_length(new.data->'order') is distinct from n then
    raise exception 'Tap every station to close the loop.';
  end if;
  for item in select value from jsonb_array_elements(new.data->'order') loop
    if jsonb_typeof(item) is distinct from 'string' then
      raise exception 'Tap every station to close the loop.';
    end if;
    sid := item #>> '{}';
    if not (sid = any (ids)) or sid = any (ordered) then
      raise exception 'Tap every station to close the loop.';
    end if;
    ordered := ordered || sid;
  end loop;

  if jsonb_typeof(new.data->'clients') is distinct from 'array' then
    raise exception 'That circuit could not be saved.';
  end if;
  if jsonb_array_length(new.data->'clients') > 40 then
    raise exception 'Too many clients.';
  end if;
  for item in select value from jsonb_array_elements(new.data->'clients') loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'That circuit could not be saved.';
    end if;
    src := item->>'source';
    if src = 'linked' then
      if private.circuit_keys(item) is distinct from array['id', 'name', 'source']::text[] then
        raise exception 'That circuit could not be saved.';
      end if;
      if jsonb_typeof(item->'id') is distinct from 'string' then
        raise exception 'Name every client.';
      end if;
      cid := item->>'id';
      if cid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'Name every client.';
      end if;
      if cid = any (linked) then
        raise exception 'That client is already on this circuit.';
      end if;
      linked := linked || cid;
    elsif src = 'manual' then
      if private.circuit_keys(item) is distinct from array['name', 'source']::text[] then
        raise exception 'That circuit could not be saved.';
      end if;
    else
      raise exception 'That circuit could not be saved.';
    end if;
    cname := coalesce(item->>'name', '');
    if cname is distinct from btrim(cname)
       or char_length(cname) < 1
       or char_length(cname) > 80
       or position('@' in cname) > 0 then
      raise exception 'Name every client.';
    end if;
    if src = 'manual' and lower(cname) = any (manuals) then
      raise exception 'That client is already on this circuit.';
    end if;
    if src = 'manual' then
      manuals := manuals || lower(cname);
    end if;
  end loop;

  if jsonb_typeof(new.data->'clock') is distinct from 'object'
     or private.circuit_keys(new.data->'clock') is distinct from array['moveSec', 'rounds', 'workSec']::text[] then
    raise exception 'That circuit could not be saved.';
  end if;
  work_sec := private.circuit_int(new.data->'clock'->'workSec', 0, 3600);
  move_sec := private.circuit_int(new.data->'clock'->'moveSec', 0, 3600);
  rounds := private.circuit_int(new.data->'clock'->'rounds', 1, 99);
  if work_sec is null then
    raise exception 'Enter the work time.';
  end if;
  if move_sec is null then
    raise exception 'Enter the move time.';
  end if;
  if rounds is null then
    raise exception 'Enter the rounds.';
  end if;

  return new;
end;
$$;

drop trigger if exists circuits_guard on public.circuits;
create trigger circuits_guard
  before insert or update or delete on public.circuits
  for each row execute function public.circuits_guard();

revoke all on function public.circuits_guard() from public, anon;
grant execute on function public.circuits_guard() to authenticated;

drop policy if exists circuits_select on public.circuits;
create policy circuits_select
  on public.circuits
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.is_approved((select auth.uid())))
  );

drop policy if exists circuits_insert on public.circuits;
create policy circuits_insert
  on public.circuits
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select private.is_approved((select auth.uid())))
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid())
        and (
          membership in ('trainer', 'master_trainer')
          or (
            membership not in ('trainer', 'master_trainer', 'enthusiast', 'free_client')
            and intended_plan in ('trainer', 'master_trainer')
          )
        )
    )
  );

drop policy if exists circuits_update on public.circuits;
create policy circuits_update
  on public.circuits
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.is_approved((select auth.uid())))
  )
  with check (
    owner_id = (select auth.uid())
    and (select private.is_approved((select auth.uid())))
  );

drop policy if exists circuits_delete on public.circuits;
create policy circuits_delete
  on public.circuits
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.is_approved((select auth.uid())))
  );
