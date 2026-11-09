-- Exercise library schema and access only.
-- Apply once in the Supabase SQL editor for project thyrgloermygnezfareg,
-- AFTER the profiles and invites migrations:
--   Dashboard → SQL → New query → paste this file → Run.
--
-- Do not put exercise rows, GIF files, or a catalog dump in this file or in
-- the site. Load the library in the SQL editor yourself (as the database
-- owner). Host the GIFs separately. This app only reads a page at a time.
--
-- Signed-in users may read exercises. Visitors who are not signed in cannot.
-- There is no insert, update, or delete access for the app.

create table if not exists public.exercises (
  id text primary key,
  name text not null,
  body_part text not null default '',
  equipment text not null default '',
  target text not null default '',
  secondary_muscles text[] not null default '{}',
  instructions text[] not null default '{}',
  description text not null default '',
  constraint exercises_id_check check (id ~ '^[A-Za-z0-9_-]{1,32}$'),
  constraint exercises_name_check check (length(btrim(name)) > 0)
);

alter table public.exercises enable row level security;

revoke all on public.exercises from public, anon, authenticated;
grant select on public.exercises to authenticated;

drop policy if exists exercises_select_authenticated on public.exercises;
create policy exercises_select_authenticated
  on public.exercises
  for select
  to authenticated
  using ((select auth.uid()) is not null);

create index if not exists exercises_name_idx on public.exercises (name);
create index if not exists exercises_body_part_idx on public.exercises (body_part);
create index if not exists exercises_equipment_idx on public.exercises (equipment);
create index if not exists exercises_target_idx on public.exercises (target);

-- One page of matches. An empty search returns nothing, so opening the
-- builder does not download the catalog. Each call returns at most 30 rows.
create or replace function public.search_exercises(
  p_query text default '',
  p_body_part text default '',
  p_equipment text default '',
  p_target text default '',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id text,
  name text,
  body_part text,
  equipment text,
  target text
)
language sql
stable
security invoker
set search_path = public
as $$
  select e.id, e.name, e.body_part, e.equipment, e.target
  from public.exercises e
  where (select auth.uid()) is not null
    and (btrim(coalesce(p_body_part, '')) = '' or e.body_part = btrim(p_body_part))
    and (btrim(coalesce(p_equipment, '')) = '' or e.equipment = btrim(p_equipment))
    and (btrim(coalesce(p_target, '')) = '' or e.target = btrim(p_target))
    and (
      length(btrim(coalesce(p_query, ''))) >= 2
      or btrim(coalesce(p_body_part, '')) <> ''
      or btrim(coalesce(p_equipment, '')) <> ''
      or btrim(coalesce(p_target, '')) <> ''
    )
    and (
      length(btrim(coalesce(p_query, ''))) = 0
      or e.name ilike '%' || replace(
        replace(
          replace(btrim(p_query), chr(92), chr(92) || chr(92)),
          '%', chr(92) || '%'
        ),
        '_', chr(92) || '_'
      ) || '%' escape $esc$\$esc$
    )
  order by e.name, e.id
  limit least(greatest(coalesce(p_limit, 20), 1), 30)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Short filter labels only (body part, equipment, target). Not the catalog.
create or replace function public.exercise_filter_options()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when (select auth.uid()) is null then '{}'::jsonb
    else jsonb_build_object(
      'bodyParts', coalesce((
        select jsonb_agg(v order by v)
        from (select distinct body_part as v from public.exercises where body_part <> '') s
      ), '[]'::jsonb),
      'equipment', coalesce((
        select jsonb_agg(v order by v)
        from (select distinct equipment as v from public.exercises where equipment <> '') s
      ), '[]'::jsonb),
      'targets', coalesce((
        select jsonb_agg(v order by v)
        from (select distinct target as v from public.exercises where target <> '') s
      ), '[]'::jsonb)
    )
  end;
$$;

revoke all on function public.search_exercises(text, text, text, text, integer, integer) from public, anon;
grant execute on function public.search_exercises(text, text, text, text, integer, integer) to authenticated;

revoke all on function public.exercise_filter_options() from public, anon;
grant execute on function public.exercise_filter_options() to authenticated;
