-- Find a trainer: the client's active linked trainer comes first.
-- Apply once in the Supabase SQL editor AFTER 20261118230000_trainer_near.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app.
-- Safe to run again. A second run does not duplicate rows, policies, or indexes.
-- If 20261118230000_trainer_near.sql or 20261118210000_trainer_find.sql is
-- run again after this file, run this file once more. Those older files
-- replace trainer_search.
--
-- What it changes
--   public.trainer_search(text, double precision, double precision)
--     Same signature and grants as 20261118230000_trainer_near.sql.
--     Online and Near me still return the top 10 other trainers, with the
--     same filters, ranking, request state, city, state, and rounded miles.
--     The caller's active linked trainer (trainer_clients.ended_at is null)
--     is prepended and does not use one of those 10 spots. That row is
--     returned even when the trainer is not listed, and even when their
--     service or pin does not match the mode. It is never repeated in the
--     other 10. isLinked is true on that row and false on the others.
--     Temporary conversations stay out of the other results. The row does
--     not include email, latitude, longitude, or country. p_lat and p_lng
--     are still used only to sort and round a Near me search. They are not
--     stored. The sign-in, approval, and client-or-enthusiast checks stay.

create or replace function public.trainer_search(
  p_mode text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  uid uuid := (select auth.uid());
  me public.profiles;
  mode text := lower(btrim(coalesce(p_mode, '')));
  linked_id uuid;
  linked jsonb;
  rows jsonb;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;
  if not private.is_approved(uid) then
    raise exception 'Your account is waiting for approval.';
  end if;
  select * into me from public.profiles where id = uid;
  if not found or not private.can_find_trainer(me) then
    raise exception 'Find a trainer is for clients and enthusiasts.';
  end if;

  if mode = 'near' then
    if p_lat is null or p_lng is null
       or p_lat <> p_lat or p_lng <> p_lng
       or p_lat < -90 or p_lat > 90
       or p_lng < -180 or p_lng > 180 then
      raise exception 'Choose a location.';
    end if;
  elsif mode <> 'online' then
    raise exception 'Choose online or near me.';
  end if;

  select c.trainer_id into linked_id
  from public.trainer_clients c
  where c.client_id = uid
    and c.ended_at is null
    and c.trainer_id <> uid
  limit 1;

  if linked_id is not null then
    select jsonb_build_object(
      'id', p.id,
      'name', person.name,
      'role', person.role,
      'verified', person.verified,
      'serviceType', p.service_type,
      'city', place.city,
      'state', place.region,
      'distanceMiles', case when mode = 'near' then place.miles else null end,
      'request', 'none',
      'isLinked', true
    )
    into linked
    from public.profiles p
    cross join lateral (
      select
        j->>'name' as name,
        j->>'role' as role,
        coalesce((j->>'verified')::boolean, false) as verified
      from (select private.public_person(p.id) as j) raw
    ) person
    left join lateral (
      select
        l.city,
        l.region,
        case
          when mode = 'near' then private.rounded_miles(p_lat, p_lng, l.latitude, l.longitude)
          else null
        end as miles
      from private.trainer_locations l
      where l.trainer_id = p.id
      order by
        case
          when mode = 'near' then private.distance_miles(p_lat, p_lng, l.latitude, l.longitude)
          else 0::double precision
        end asc,
        l.slot asc
      limit 1
    ) place on true
    where p.id = linked_id;

    if linked is not null and (mode <> 'near' or linked->'distanceMiles' = 'null'::jsonb) then
      linked := linked - 'distanceMiles';
    end if;
  end if;

  if mode = 'near' then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'role', s.role,
        'verified', s.verified,
        'serviceType', s.service_type,
        'city', s.city,
        'state', s.region,
        'distanceMiles', s.miles,
        'request', s.request_state,
        'isLinked', false
      )
      order by s.exact_miles asc, s.name asc, s.id asc
    ), '[]'::jsonb)
    into rows
    from (
      select
        p.id,
        person.name,
        person.role,
        person.verified,
        p.service_type,
        place.city,
        place.region,
        place.miles,
        place.exact_miles,
        case
          when exists (
            select 1 from public.trainer_requests q
            where q.client_id = uid
              and q.trainer_id = p.id
              and q.status = 'open'
          ) then 'open'
          when exists (
            select 1 from public.trainer_requests q
            where q.client_id = uid
              and q.trainer_id = p.id
              and q.status = 'declined'
              and q.decided_at > now() - interval '30 days'
          ) then 'cooldown'
          else 'none'
        end as request_state
      from public.profiles p
      cross join lateral (
        select
          j->>'name' as name,
          j->>'role' as role,
          coalesce((j->>'verified')::boolean, false) as verified
        from (select private.public_person(p.id) as j) raw
      ) person
      join lateral (
        select
          l.city,
          l.region,
          private.distance_miles(p_lat, p_lng, l.latitude, l.longitude) as exact_miles,
          private.rounded_miles(p_lat, p_lng, l.latitude, l.longitude) as miles
        from private.trainer_locations l
        where l.trainer_id = p.id
        order by private.distance_miles(p_lat, p_lng, l.latitude, l.longitude) asc, l.slot asc
        limit 1
      ) place on true
      where p.listed
        and p.service_type in ('in_person', 'both')
        and p.membership in ('trainer', 'master_trainer')
        and private.is_approved(p.id)
        and p.id <> uid
        and p.id is distinct from linked_id
        and not exists (
          select 1 from public.trainer_clients c
          where c.trainer_id = p.id
            and c.client_id = uid
            and c.ended_at is null
        )
        and not exists (
          select 1 from public.trainer_temp_links t
          where t.trainer_id = p.id
            and t.client_id = uid
            and t.ended_at is null
            and t.converted_at is null
            and t.expires_at > now()
        )
      order by place.exact_miles asc, person.name asc, p.id asc
      limit 10
    ) s;
  else
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'role', s.role,
        'verified', s.verified,
        'serviceType', s.service_type,
        'city', s.city,
        'state', s.region,
        'request', s.request_state,
        'isLinked', false
      )
      order by s.score desc, s.name asc, s.id asc
    ), '[]'::jsonb)
    into rows
    from (
      select
        p.id,
        person.name,
        person.role,
        person.verified,
        p.service_type,
        place.city,
        place.region,
        case
          when exists (
            select 1 from public.trainer_requests q
            where q.client_id = uid
              and q.trainer_id = p.id
              and q.status = 'open'
          ) then 'open'
          when exists (
            select 1 from public.trainer_requests q
            where q.client_id = uid
              and q.trainer_id = p.id
              and q.status = 'declined'
              and q.decided_at > now() - interval '30 days'
          ) then 'cooldown'
          else 'none'
        end as request_state,
        private.trainer_activity_score(p.id) as score
      from public.profiles p
      cross join lateral (
        select
          j->>'name' as name,
          j->>'role' as role,
          coalesce((j->>'verified')::boolean, false) as verified
        from (select private.public_person(p.id) as j) raw
      ) person
      left join lateral (
        select l.city, l.region
        from private.trainer_locations l
        where l.trainer_id = p.id
        order by l.slot asc
        limit 1
      ) place on true
      where p.listed
        and p.service_type in ('online', 'both')
        and p.membership in ('trainer', 'master_trainer')
        and private.is_approved(p.id)
        and p.id <> uid
        and p.id is distinct from linked_id
        and not exists (
          select 1 from public.trainer_clients c
          where c.trainer_id = p.id
            and c.client_id = uid
            and c.ended_at is null
        )
        and not exists (
          select 1 from public.trainer_temp_links t
          where t.trainer_id = p.id
            and t.client_id = uid
            and t.ended_at is null
            and t.converted_at is null
            and t.expires_at > now()
        )
      order by private.trainer_activity_score(p.id) desc, person.name asc, p.id asc
      limit 10
    ) s;
  end if;

  rows := coalesce(rows, '[]'::jsonb);
  if linked is not null then
    rows := jsonb_build_array(linked) || rows;
  end if;

  return jsonb_build_object(
    'mode', mode,
    'comingSoon', false,
    'trainers', rows
  );
end;
$fn$;

revoke all on function public.trainer_search(text, double precision, double precision) from public, anon;
grant execute on function public.trainer_search(text, double precision, double precision) to authenticated;

notify pgrst, 'reload schema';
