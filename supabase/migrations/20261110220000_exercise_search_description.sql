-- Add description to exercise search results.
-- Apply once in the Supabase SQL editor for project thyrgloermygnezfareg,
-- AFTER 20261109195000_exercises.sql:
--   Dashboard → SQL → New query → paste this file → Run.
--
-- Merging this file does not change the live database. The editor can pre-fill
-- Notes only after this function returns description.
--
-- CREATE OR REPLACE cannot change the return columns, so the function is dropped
-- and recreated with the same arguments. Search behavior is unchanged aside from
-- the extra description column (plain text, used as stored).

drop function if exists public.search_exercises(text, text, text, text, integer, integer);

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
  target text,
  description text
)
language sql
stable
security invoker
set search_path = public
as $$
  select e.id, e.name, e.body_part, e.equipment, e.target, e.description
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

revoke all on function public.search_exercises(text, text, text, text, integer, integer) from public, anon;
grant execute on function public.search_exercises(text, text, text, text, integer, integer) to authenticated;
