-- Profiles and Beta membership.
-- Apply once in the Supabase SQL editor for project thyrgloermygnezfareg:
--   Dashboard → SQL → New query → paste this file → Run.
-- Site URL to set under Authentication → URL configuration:
--   https://newbwilliwonka.github.io/workout-builder/
--
-- A new account starts as membership 'none'. The signed-in user may store an
-- intended paid plan only. They cannot grant themselves Free Client, Enthusiast,
-- Trainer, or Master Trainer. Those membership values are for a later invite
-- or payment step (run as the database owner, when auth.uid() is null).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  membership text not null default 'none',
  intended_plan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_membership_check check (
    membership in ('none', 'free_client', 'enthusiast', 'trainer', 'master_trainer')
  ),
  constraint profiles_intended_plan_check check (
    intended_plan is null or intended_plan in ('enthusiast', 'trainer', 'master_trainer')
  )
);

alter table public.profiles enable row level security;

create or replace function public.guard_profile_insert()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    if new.id is distinct from auth.uid() then
      raise exception 'cannot create a profile for someone else';
    end if;
    if new.membership is distinct from 'none' then
      raise exception 'new accounts do not start with a membership';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'profile id cannot change';
  end if;
  if auth.uid() is not null and new.membership is distinct from old.membership then
    raise exception 'membership changes require an invite or payment';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_guard_insert on public.profiles;
create trigger profiles_guard_insert
  before insert on public.profiles
  for each row execute function public.guard_profile_insert();

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, membership)
  values (new.id, new.email, 'none')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

grant select, insert, update on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (
    id = auth.uid()
    and membership = 'none'
    and (intended_plan is null or intended_plan in ('enthusiast', 'trainer', 'master_trainer'))
  );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and (intended_plan is null or intended_plan in ('enthusiast', 'trainer', 'master_trainer'))
  );
