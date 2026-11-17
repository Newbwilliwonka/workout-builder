-- Static holds and Stopwatch on the tracking dashboard.
-- Apply once in the Supabase SQL editor AFTER 20261117010000_trainer_dashboard_layout.sql:
--   Dashboard → SQL → New query → paste this file → Run.
-- Do not run this from the app. This file was not applied to the live project.
-- Until it is applied, the two cards still show in the app. Saving a layout
-- that includes them, or sharing a dashboard that includes them, says it
-- could not be saved or shared.
--
-- What changed:
--   A trainer can keep nine cards: the eight on the standard dashboard
--   (Hit the plan, Workouts and streak, Strength and Capacity, Total volume,
--   Recent personal records, Consistency, Static holds, Stopwatch) plus the
--   optional Stopwatch pass rate card.
--   shared_dashboards accepts 1 to 9 frozen cards.
--   dashboard_layouts accepts up to 9 card names.
--   Static holds (holds) and Stopwatch (stopwatch) are allowed card names.
--
-- Who can see a row is unchanged. This file does not add or replace a policy.
-- An email-looking trainer name is still replaced before a shared row is stored.
-- A later workout still does not change a shared copy.

alter table public.dashboard_layouts drop constraint if exists dashboard_layouts_cards_array;
alter table public.dashboard_layouts add constraint dashboard_layouts_cards_array check (
  jsonb_typeof(cards) = 'array'
  and jsonb_array_length(cards) <= 9
);

alter table public.shared_dashboards drop constraint if exists shared_dashboards_cards_array;
alter table public.shared_dashboards add constraint shared_dashboards_cards_array check (
  jsonb_typeof(cards) = 'array'
  and jsonb_array_length(cards) between 1 and 9
);

-- Same checks as 20261117010000_trainer_dashboard_layout.sql.
-- Nine cards fit, including Static holds and Stopwatch.
create or replace function private.dashboard_layout_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  seen text[] := '{}';
  kind text;
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null and old.user_id is distinct from auth.uid() then
      raise exception 'You can only reset your own dashboard.';
    end if;
    if auth.uid() is not null and not exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and membership in ('trainer', 'master_trainer')
    ) then
      raise exception 'Only a trainer can save a dashboard layout.';
    end if;
    return old;
  end if;

  if auth.uid() is not null then
    if new.user_id is distinct from auth.uid() then
      raise exception 'You can only save your own dashboard.';
    end if;
    if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
      raise exception 'A dashboard layout stays with the same account.';
    end if;
    if not exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and membership in ('trainer', 'master_trainer')
    ) then
      raise exception 'Only a trainer can save a dashboard layout.';
    end if;
  end if;

  if new.cards is null
     or jsonb_typeof(new.cards) is distinct from 'array'
     or jsonb_array_length(new.cards) > 9 then
    raise exception 'Choose the cards on your dashboard.';
  end if;
  for item in select value from jsonb_array_elements(new.cards) loop
    if jsonb_typeof(item) is distinct from 'string' then
      raise exception 'Choose the cards on your dashboard.';
    end if;
    kind := item #>> '{}';
    if kind is null or kind not in ('plan', 'workouts', 'strength', 'volume', 'records', 'calendar', 'holds', 'stopwatch', 'pass') then
      raise exception 'Choose the cards on your dashboard.';
    end if;
    if kind = any (seen) then
      raise exception 'Each card is listed once.';
    end if;
    seen := seen || kind;
  end loop;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.dashboard_layout_guard() from public, anon, authenticated;

-- Same checks as 20261117010000_trainer_dashboard_layout.sql.
-- Nine frozen cards fit, including Static holds and Stopwatch.
-- An email-looking trainer name is still replaced before the row is stored.
create or replace function private.shared_dashboard_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  seen text[] := '{}';
  kind text;
begin
  if tg_op = 'INSERT' and position('@' in btrim(coalesce(new.trainer_name, ''))) > 0 then
    select private.shown_name(p.display_name, 'Trainer')
      into new.trainer_name
    from public.profiles p
    where p.id = new.trainer_id;
    if new.trainer_name is null
       or position('@' in new.trainer_name) > 0
       or char_length(btrim(new.trainer_name)) < 1 then
      new.trainer_name := 'Trainer';
    end if;
  end if;

  if auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'A shared dashboard is kept.';
  end if;

  if tg_op = 'INSERT' then
    if new.trainer_id is distinct from auth.uid() then
      raise exception 'You share a dashboard as yourself.';
    end if;
    if not private.tracking_trainer_of(new.client_id) then
      raise exception 'You can share a dashboard only with a connected client.';
    end if;
    if not exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and membership in ('trainer', 'master_trainer')
    ) then
      raise exception 'Only a trainer can share a dashboard.';
    end if;
    if not private.share_inbox(new.client_id) then
      raise exception 'A shared dashboard goes to a free client.';
    end if;
    if new.viewed_at is not null then
      raise exception 'A new dashboard has not been opened.';
    end if;
    new.trainer_name := btrim(coalesce(new.trainer_name, ''));
    if char_length(new.trainer_name) < 1 or char_length(new.trainer_name) > 80 then
      raise exception 'Enter the trainer name.';
    end if;
    if position('@' in new.trainer_name) > 0 then
      new.trainer_name := 'Trainer';
    end if;
    if new.as_of is null then
      raise exception 'A dashboard needs a date.';
    end if;
    if new.cards is null
       or jsonb_typeof(new.cards) is distinct from 'array'
       or jsonb_array_length(new.cards) < 1
       or jsonb_array_length(new.cards) > 9
       or octet_length(new.cards::text) > 200000 then
      raise exception 'Choose the cards to share.';
    end if;
    for item in select value from jsonb_array_elements(new.cards) loop
      kind := item->>'type';
      if kind is null or kind not in ('plan', 'workouts', 'strength', 'volume', 'records', 'calendar', 'holds', 'stopwatch', 'pass') then
        raise exception 'Choose the cards to share.';
      end if;
      if kind = any (seen) then
        raise exception 'Each card is shared once.';
      end if;
      seen := seen || kind;
    end loop;
    new.created_at := now();
    return new;
  end if;

  if auth.uid() is distinct from old.client_id then
    raise exception 'Only the client can open this dashboard.';
  end if;
  if new.id is distinct from old.id
     or new.client_id is distinct from old.client_id
     or new.trainer_id is distinct from old.trainer_id
     or new.trainer_name is distinct from old.trainer_name
     or new.as_of is distinct from old.as_of
     or new.cards is distinct from old.cards
     or new.created_at is distinct from old.created_at then
    raise exception 'A shared dashboard cannot be changed.';
  end if;
  if old.viewed_at is not null then
    raise exception 'This dashboard was already opened.';
  end if;
  if new.viewed_at is null then
    raise exception 'Opening a dashboard marks it viewed.';
  end if;
  return new;
end;
$$;

revoke all on function private.shared_dashboard_guard() from public, anon, authenticated;
