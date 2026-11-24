-- Circuits no longer store a class roster.
-- Apply once in the Supabase SQL editor AFTER 20261123200000_circuits.sql
-- and 20261124200000_circuit_guest_calendar.sql.
-- Do not run this from the app.
--
-- Saved circuits keep stations, order, and the clock. Client placement is
-- chosen when a class starts and is not written back onto the circuit.
-- This drops a clients column or table only when one is already there,
-- strips clients out of saved circuit data, and replaces the save guard.

alter table public.circuits drop column if exists clients;
drop table if exists public.circuit_clients;

-- Strip saved rosters before the stricter guard exists, and without firing
-- the old guard. Existing rows, including unnamed stations, stay in place.
do $pause_guard$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'circuits_guard' and tgrelid = 'public.circuits'::regclass
  ) then
    alter table public.circuits disable trigger circuits_guard;
  end if;
end
$pause_guard$;

update public.circuits
set data = data - 'clients'
where data ? 'clients';

do $resume_guard$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'circuits_guard' and tgrelid = 'public.circuits'::regclass
  ) then
    alter table public.circuits enable trigger circuits_guard;
  end if;
end
$resume_guard$;

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
  new.data := new.data - 'clients';
  if private.circuit_keys(new.data) is distinct from array['clock', 'order', 'stations']::text[] then
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
    if exercise is null or jsonb_typeof(exercise) = 'null' then
      raise exception 'Name every station before saving.';
    end if;
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
