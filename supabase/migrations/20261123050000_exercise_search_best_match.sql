-- Exercise library search ranks a best match, ignoring punctuation.
-- Apply in the Supabase SQL editor AFTER 20261123040000_client_pin.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Merging this file does not change the live database. Search stays on the
-- old ILIKE until this file is run there. Do not deploy an Edge Function.
-- Safe to run again. A second run does not rename, insert, or delete exercises
-- and does not add a second column or index.
--
-- Display names stay exactly as loaded. Media and saved workouts still use id.
--
-- What it changes
--   public.exercises.name_key
--     Stored generated column. Lowercase letters and digits from the name.
--     "push-up", "push up", and "Push-Up" all share the key pushup.
--     The name column is not written.
--   indexes
--     A btree on name_key for an exact or prefix match, and a pg_trgm gin
--     index on name_key for contains and the typo fallback.
--   public.search_exercises(text, text, text, text, integer, integer)
--     Same arguments and the same columns as before (id, name, body_part,
--     equipment, target, description). Same body-part, equipment, and target
--     filters. Same approval check. Same limit (1 to 30) and offset.
--     A match ignores case, spaces, hyphens, and other punctuation.
--     The two-character minimum applies to that compact key. "a!" and "!!!"
--     are not searches. With a filter they behave like an empty query.
--     "close grip press" finds "close-grip bench press" (each word, any order).
--     A trailing plural s is ignored when the word is at least 4 letters and
--     does not already end in ss ("push-ups" finds "push-up"; "press" stays
--     "press"; "ups" does not become "up").
--     Order: exact compact key, then names that start with it, then contains
--     (earlier in the name, then shorter names), then a pg_trgm typo last.
--     Ties break by name, then id, so offset/limit stays stable.

create schema if not exists extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create extension if not exists pg_trgm with schema extensions;

-- ASCII fold only. lower() is stable (it follows the database locale) and
-- cannot be used in a stored generated column. Exercise names are ASCII.
create or replace function private.exercise_name_key(raw text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $key$
  select regexp_replace(
    translate(
      coalesce(raw, ''),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'abcdefghijklmnopqrstuvwxyz'
    ),
    '[^a-z0-9]',
    '',
    'g'
  );
$key$;

revoke all on function private.exercise_name_key(text) from public, anon;
grant execute on function private.exercise_name_key(text) to authenticated;

comment on function private.exercise_name_key(text) is
  'Lowercase letters and digits only. Used by exercises.name_key and exercise search. Not a display name.';

do $col$
begin
  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.exercises'::regclass
      and attname = 'name_key'
      and not attisdropped
  ) then
    alter table public.exercises
      add column name_key text
      generated always as (private.exercise_name_key(name)) stored;
  end if;
end
$col$;

comment on column public.exercises.name_key is
  'Letters and digits from name, lowercased, for search. The display name is unchanged.';

create index if not exists exercises_name_key_idx
  on public.exercises (name_key text_pattern_ops);

do $trgm$
declare
  sch text;
begin
  select n.nspname into sch
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';
  if sch is null then
    raise exception 'pg_trgm is not installed';
  end if;

  execute format(
    'create or replace function private.exercise_name_similarity(query_key text, exercise_key text)
     returns real
     language sql
     immutable
     parallel safe
     security definer
     set search_path = %I
     as $body$
       select similarity($1, $2);
     $body$',
    sch
  );
  revoke all on function private.exercise_name_similarity(text, text) from public, anon;
  grant execute on function private.exercise_name_similarity(text, text) to authenticated;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'exercises_name_key_trgm_idx'
  ) then
    execute format(
      'create index exercises_name_key_trgm_idx on public.exercises using gin (name_key %I.gin_trgm_ops)',
      sch
    );
  end if;
end
$trgm$;

comment on function private.exercise_name_similarity(text, text) is
  'pg_trgm similarity of two compact exercise keys. Typo fallback for search. Does not read the catalog.';

-- Typo cutoff: above 0.42 when the shorter key is 8 letters or fewer,
-- otherwise above 0.55. 0.42 keeps a one-character miss on a short name
-- ("push uo" and "pushp" find "push-up") and drops "pull-up" and a shorter
-- name that only shares some letters ("3/4 sit-up" does not add "sit-up").
-- 0.55 keeps a real typo of a longer name and drops a different exercise
-- that only shares a prefix ("close grip press" does not add "close-grip
-- push-up"). A row that already matched on the compact key never uses this
-- score for its rank.
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
as $search$
  with params as (
    select
      btrim(coalesce(p_query, '')) as q,
      btrim(coalesce(p_body_part, '')) as body_part,
      btrim(coalesce(p_equipment, '')) as equipment,
      btrim(coalesce(p_target, '')) as target,
      private.exercise_name_key(btrim(coalesce(p_query, ''))) as q_key
  ),
  stemmed as (
    select
      p.*,
      case
        when length(p.q_key) > 3
         and right(p.q_key, 1) = 's'
         and right(p.q_key, 2) is distinct from 'ss'
        then left(p.q_key, length(p.q_key) - 1)
        else p.q_key
      end as q_stem
    from params p
  ),
  words as (
    select
      k.word,
      case
        when length(k.word) > 3
         and right(k.word, 1) = 's'
         and right(k.word, 2) is distinct from 'ss'
        then left(k.word, length(k.word) - 1)
        else k.word
      end as stem
    from stemmed s
    cross join lateral regexp_split_to_table(s.q, '[^A-Za-z0-9]+') as piece(raw)
    cross join lateral (
      select private.exercise_name_key(piece.raw) as word
    ) k
    -- A single digit stays a word so "3/4 sit-up" does not match every sit-up.
    -- A single letter does not; it would match almost every name.
    where length(k.word) >= 2
       or k.word ~ '^[0-9]$'
  ),
  scored as (
    select
      e.id,
      e.name,
      e.body_part,
      e.equipment,
      e.target,
      e.description,
      e.name_key,
      s.q,
      s.q_key,
      s.q_stem,
      (
        length(s.q_key) >= 2
        and strpos(e.name_key, s.q_key) > 0
      ) as hit_key,
      (
        s.q_stem <> s.q_key
        and strpos(e.name_key, s.q_stem) > 0
      ) as hit_stem,
      (
        length(s.q_key) >= 2
        and exists (select 1 from words)
        and not exists (
          select 1
          from words w
          where strpos(e.name_key, w.word) = 0
            and (
              w.stem = w.word
              or strpos(e.name_key, w.stem) = 0
            )
        )
      ) as hit_words
    from public.exercises e
    cross join stemmed s
    where private.is_approved((select auth.uid()))
      and (s.body_part = '' or e.body_part = s.body_part)
      and (s.equipment = '' or e.equipment = s.equipment)
      and (s.target = '' or e.target = s.target)
      and (
        length(s.q_key) >= 2
        or s.body_part <> ''
        or s.equipment <> ''
        or s.target <> ''
      )
  ),
  measured as (
    select
      r.id,
      r.name,
      r.body_part,
      r.equipment,
      r.target,
      r.description,
      r.name_key,
      r.q,
      r.q_key,
      r.q_stem,
      r.hit_key,
      r.hit_stem,
      r.hit_words,
      case
        when length(r.q_key) < 4 then 0::real
        when r.q_stem <> r.q_key then greatest(
          private.exercise_name_similarity(r.q_key, r.name_key),
          private.exercise_name_similarity(r.q_stem, r.name_key)
        )
        else private.exercise_name_similarity(r.q_key, r.name_key)
      end as sim,
      case
        when r.hit_key then strpos(r.name_key, r.q_key)
        when r.hit_stem then strpos(r.name_key, r.q_stem)
        else (
          select min(
            case
              when strpos(r.name_key, w.word) > 0 then strpos(r.name_key, w.word)
              else strpos(r.name_key, w.stem)
            end
          )
          from words w
        )
      end as match_pos
    from scored r
  ),
  ranked as (
    select
      m.id,
      m.name,
      m.body_part,
      m.equipment,
      m.target,
      m.description,
      m.sim,
      m.match_pos,
      case
        when m.hit_key then 0
        when m.hit_stem then 1
        else 2
      end as contain_rank,
      case
        when length(m.q) = 0 or length(m.q_key) < 2 then 0
        when m.q_key <> '' and m.name_key = m.q_key then 0
        when m.q_stem <> m.q_key and m.name_key = m.q_stem then 0
        when m.q_key <> '' and m.name_key like m.q_key || '%' then 1
        when m.hit_stem and m.name_key like m.q_stem || '%' and not m.hit_key then 1
        when m.hit_key or m.hit_stem or m.hit_words then 2
        when m.sim > case
          when least(length(m.q_key), length(m.name_key)) <= 8 then 0.42
          else 0.55
        end then 3
        else null
      end as tier
    from measured m
  )
  select
    ranked.id,
    ranked.name,
    ranked.body_part,
    ranked.equipment,
    ranked.target,
    ranked.description
  from ranked
  where ranked.tier is not null
  order by
    ranked.tier,
    case when ranked.tier = 3 then ranked.sim else 0::real end desc,
    case when ranked.tier = 2 then ranked.contain_rank else 0 end,
    case when ranked.tier = 2 then coalesce(ranked.match_pos, 1000000) else 0 end,
    case when ranked.tier = 2 then char_length(ranked.name) else 0 end,
    ranked.name,
    ranked.id
  limit least(greatest(coalesce(p_limit, 20), 1), 30)
  offset greatest(coalesce(p_offset, 0), 0);
$search$;

comment on function public.search_exercises(text, text, text, text, integer, integer) is
  'One page of exercise matches for an approved signed-in user. Compact-key match, then prefix, then contains, then a pg_trgm typo. Display names are unchanged.';

revoke all on function public.search_exercises(text, text, text, text, integer, integer) from public, anon;
grant execute on function public.search_exercises(text, text, text, text, integer, integer) to authenticated;

analyze public.exercises;
