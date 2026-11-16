-- Paid Enthusiasts can receive a frozen dashboard.
-- private.share_inbox used to allow only an unpaid client, so a share addressed
-- to a paid Enthusiast was rejected. A connected trainer check
-- already lives in private.shared_dashboard_guard (private.tracking_trainer_of).
-- This only requires the client profile to exist.
-- Safe to run more than once. Do not run this from the app.
-- Until it is applied, sharing with an Enthusiast fails and the app says it
-- could not share that dashboard. A client simply has no new rows.

create or replace function private.share_inbox(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = client
  );
$$;

revoke all on function private.share_inbox(uuid) from public, anon, authenticated;
