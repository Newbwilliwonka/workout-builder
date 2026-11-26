// Checkout result parsing and the service-role grant file. No network.
// node tests/checkout.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Bill = require('../billing.js');
const Mem = require('../membership.js');

assert.deepStrictEqual(
  Bill.outcome({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' }, 'Checkout could not be started.'),
  { url: 'https://checkout.stripe.com/c/pay/cs_test_123' }
);
assert.deepStrictEqual(
  Bill.outcome({ url: 'https://billing.stripe.com/p/session/test_123' }, 'The billing page could not be opened.'),
  { url: 'https://billing.stripe.com/p/session/test_123' }
);
assert.deepStrictEqual(
  Bill.outcome({ error: 'You already have a subscription. Use Manage billing to change it.' }, 'Checkout could not be started.'),
  { error: 'You already have a subscription. Use Manage billing to change it.' }
);
assert.deepStrictEqual(
  Bill.outcome({ error: 'Checkout is starting, try again in a moment.' }, 'Checkout could not be started.'),
  { error: 'Checkout is starting, try again in a moment.' }
);
assert.deepStrictEqual(
  Bill.outcome({ error: 'This account keeps its current plan. Checkout is not used.' }, 'Checkout could not be started.'),
  { error: 'This account keeps its current plan. Checkout is not used.' }
);
assert.deepStrictEqual(Bill.outcome({ url: 'http://evil.example/checkout' }, 'Checkout could not be started.'), {
  error: 'Checkout could not be started.'
});
assert.deepStrictEqual(Bill.outcome({ url: 'javascript:alert(1)' }, 'Checkout could not be started.'), {
  error: 'Checkout could not be started.'
});
assert.deepStrictEqual(Bill.outcome(null, 'The billing page could not be opened.'), {
  error: 'The billing page could not be opened.'
});
assert.strictEqual(Bill.httpsUrl('https://checkout.stripe.com/c/pay/cs_test_123'), 'https://checkout.stripe.com/c/pay/cs_test_123');
assert.strictEqual(Bill.httpsUrl('http://checkout.stripe.com/c/pay/cs_test_123'), '');
assert.deepStrictEqual(Bill.switchOutcome({ status: 'ok' }, 'That plan could not be changed.'), { status: 'ok' });
assert.deepStrictEqual(Bill.switchOutcome({ status: 'payment_failed' }, 'That plan could not be changed.'), { status: 'payment_failed' });
assert.deepStrictEqual(
  Bill.switchOutcome({ status: 'requires_action', url: 'https://invoice.stripe.com/i/confirm' }, 'That plan could not be changed.'),
  { status: 'requires_action', url: 'https://invoice.stripe.com/i/confirm' }
);
assert.deepStrictEqual(Bill.switchOutcome({ status: 'requires_action', url: 'http://evil.example/i' }, 'That plan could not be changed.'), {
  error: 'That plan could not be changed.'
});
assert.deepStrictEqual(Bill.switchOutcome({ error: 'Subscribe to a plan before switching.' }, 'That plan could not be changed.'), {
  error: 'Subscribe to a plan before switching.'
});
assert.deepStrictEqual(Bill.switchOutcome({ error: 'You are already on that plan.' }, 'That plan could not be changed.'), {
  error: 'You are already on that plan.'
});

assert.strictEqual(Mem.activePaidPlan({ membership: 'enthusiast', billing_status: 'active' }), 'enthusiast');
assert.strictEqual(Mem.activePaidPlan({ membership: 'free_client', billing_status: 'active' }), null);

const root = path.join(__dirname, '..');
const grants = fs.readFileSync(path.join(root, 'supabase/migrations/20261125235000_service_role_billing_grants.sql'), 'utf8');
assert.deepStrictEqual(grants.split('\n').filter(function (line) { return line.length; }), [
  'grant select, insert, update, delete on table public.profiles to service_role;',
  'grant select, insert, update, delete on table public.stripe_events to service_role;'
]);

const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
assert.ok(app.indexOf("if (!currentId) h += \"<p class=\\\"foot\\\">You'll finish payment on Stripe Checkout.</p>\";") !== -1);
(function () {
  var start = app.indexOf('function drawSubscriptions(');
  var end = app.indexOf('function renderSimpleAccount(');
  assert.ok(start > 0 && end > start);
  assert.strictEqual(app.slice(start, end).indexOf('redeemCard'), -1);
})();
assert.ok(app.indexOf('Starting checkout…') !== -1);
assert.ok(app.indexOf('Payment received, your plan is activating.') !== -1);
assert.strictEqual(app.indexOf('wb.checkout.wait'), -1);
assert.strictEqual(app.indexOf('checkoutWaitActive'), -1);
assert.ok(app.indexOf("Checkout was canceled. You can subscribe whenever you're ready.") !== -1);
assert.ok(app.indexOf('Manage billing') !== -1);
assert.ok(app.indexOf('>Subscribe<') !== -1);
assert.ok(app.indexOf('Beta pricing for the first 100 members.') !== -1);
assert.ok(app.indexOf('Choosing a plan saves your selection.') === -1);
assert.ok(!/sold out|beta has ended|Beta ended/i.test(app));
assert.ok(auth.indexOf("callBilling('create-checkout-session', { plan: planId }, 'Checkout could not be started.')") !== -1);
assert.ok(auth.indexOf("callBilling('create-portal-session', {}, 'The billing page could not be opened.')") !== -1);
assert.ok(auth.indexOf("c.functions.invoke('change-subscription', { body: { plan: planId } })") !== -1);
assert.ok(app.indexOf('Starts now. Today your card is charged only the difference for the rest of this billing month.') !== -1);
assert.ok(app.indexOf('Starts now. Your remaining plan will be credited towards your next bills.') !== -1);
assert.ok(app.indexOf('Nothing is refunded to your card.') === -1);
assert.ok(app.indexOf('Confirm upgrade') !== -1);
assert.ok(app.indexOf('Confirm switch') !== -1);
assert.ok(app.indexOf('>Not now</button>') !== -1);
assert.ok(app.indexOf("Your payment didn't go through. You're still on ") !== -1);
assert.ok(app.indexOf('data-switch') !== -1);
(function () {
  var start = app.indexOf('function confirmSwitch()');
  var end = app.indexOf('app.onkeydown = function', start);
  assert.ok(start > 0 && end > start);
  assert.strictEqual(app.slice(start, end).indexOf('route()'), -1);
})();
assert.ok(auth.indexOf("var full = 'billing_status,stripe_customer_id,complimentary,beta_locked,plan_ended_at';") !== -1);
assert.ok(auth.indexOf("var base = 'billing_status,stripe_customer_id,complimentary,beta_locked';") !== -1);
assert.ok(app.indexOf('id="plan-ended-hold"') !== -1);
assert.ok(app.indexOf('Your plan has ended. Rejoin within 2 weeks to keep your clients, workouts and history.') === -1);

console.log('CHECKOUT OK');
