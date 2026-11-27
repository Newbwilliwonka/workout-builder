// Pending-cancel column and the service-only writer. Text only. Does not touch a database.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migrationName = '20261127120000_subscription_cancel_at.sql';
const sqlText = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations', migrationName), 'utf8');

[
  'add column if not exists cancel_at timestamptz',
  'new.cancel_at is distinct from old.cancel_at',
  'new.cancel_at is not null',
  'public.set_subscription_cancel',
  'p_cancel_at timestamptz',
  'private.billing_service_only()',
  "set search_path = ''",
  'security definer',
  'for update',
  'stripe_subscription_id is distinct from v_subscription',
  'set cancel_at = p_cancel_at',
  'revoke all on function public.set_subscription_cancel(uuid, text, timestamp with time zone) from public, anon, authenticated',
  'grant execute on function public.set_subscription_cancel(uuid, text, timestamp with time zone) to service_role',
  'Billing changes require payment.'
].forEach(function (bit) {
  assert.ok(sqlText.indexOf(bit) !== -1, bit);
});
assert.ok(!/\b(sk|rk)_(live|test)_/i.test(sqlText));
assert.ok(!/\bwhsec_/i.test(sqlText));
console.log('cancel-at sql text ok');
