// Stripe checkout, webhook, and portal. No network and no live keys.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const shared = path.join(__dirname, '..', 'supabase/functions/_shared');
const USER = '44444444-4444-4444-8444-444444444444';
const TEST_KEY = 'sk_' + 'test_example';
const LIVE_KEY = 'sk_' + 'live_example';
const LIVE_RAK = 'rk_' + 'live_example';

function stripeMock() {
  const calls = [];
  return {
    calls: calls,
    prices: {
      list: async function (params) {
        calls.push(['prices.list', params]);
        const key = params.lookup_keys[0];
        return { data: [{ id: 'price_from_' + key, lookup_key: key }] };
      },
      retrieve: async function (id) {
        calls.push(['prices.retrieve', id]);
        return { id: id, lookup_key: 'trainer_beta_monthly' };
      }
    },
    customers: {
      retrieve: async function (id) {
        calls.push(['customers.retrieve', id]);
        return { id: id, deleted: false };
      },
      create: async function (params, opts) {
        calls.push(['customers.create', params, opts]);
        return { id: 'cus_Newcustomer1' };
      }
    },
    checkout: {
      sessions: {
        create: async function (params, opts) {
          calls.push(['sessions.create', params, opts]);
          return { id: 'cs_test_session1', url: 'https://checkout.stripe.com/c/pay/cs_test_session1', status: 'open', created: 1, metadata: params.metadata };
        },
        list: async function (params) {
          calls.push(['sessions.list', params]);
          return { data: [] };
        }
      }
    },
    billingPortal: {
      sessions: {
        create: async function (params) {
          calls.push(['portal.create', params]);
          return { url: 'https://billing.stripe.com/p/session/test_portal' };
        }
      }
    },
    subscriptions: {
      list: async function (params) {
        calls.push(['subscriptions.list', params]);
        return { data: [] };
      },
      retrieve: async function (id) {
        calls.push(['subscriptions.retrieve', id]);
        return {
          id: id,
          status: 'active',
          current_period_end: Date.parse('2027-03-01T00:00:00.000Z') / 1000,
          metadata: { supabase_user_id: USER },
          items: {
            data: [{
              price: { id: 'price_current', lookup_key: 'master_trainer_standard_monthly' },
              current_period_end: Date.parse('2027-03-01T00:00:00.000Z') / 1000
            }]
          }
        };
      },
      cancel: async function (id, params, opts) {
        calls.push(['subscriptions.cancel', id, params, opts]);
        return { id: id, status: 'canceled' };
      }
    }
  };
}

function dbMock(setup) {
  const calls = [];
  setup = setup || {};
  return {
    calls: calls,
    loadProfile: async function () {
      calls.push(['loadProfile']);
      return setup.profile;
    },
    eventSeen: async function (id) {
      calls.push(['eventSeen', id]);
      return setup.seen === true;
    },
    findProfile: async function (customerId) {
      calls.push(['findProfile', customerId]);
      const found = setup.profiles && setup.profiles[customerId];
      if (!found) return null;
      if (typeof found === 'object') return found;
      return {
        id: found,
        complimentary: false,
        billing_status: 'active',
        stripe_subscription_id: 'sub_payer001'
      };
    },
    rpc: async function (name, args) {
      calls.push([name, args]);
      if (setup.failRpc === name) throw new Error(setup.failMessage || 'failed');
      if (name === 'beta_paid_count') return setup.betaCount == null ? 0 : setup.betaCount;
      if (name === 'checkout_claim') return setup.claim || { granted: true };
      if (name === 'billing_write') {
        if (typeof setup.billingWrite === 'function') return setup.billingWrite(args);
        return { applied: true, duplicate: false };
      }
      if (name === 'keep_paid_subscription') return { applied: true };
      if (name === 'stripe_event_begin') return setup.begin === false ? false : true;
      return { applied: true };
    }
  };
}

function names(calls) {
  return calls.map(function (row) { return row[0]; });
}

async function main() {
  const guard = await import(path.join(shared, 'billing-guard.mjs'));
  const plans = await import(path.join(shared, 'billing-plans.mjs'));
  const checkout = await import(path.join(shared, 'billing-checkout.mjs'));
  const webhook = await import(path.join(shared, 'billing-webhook.mjs'));
  const portal = await import(path.join(shared, 'billing-portal.mjs'));
  const change = await import(path.join(shared, 'billing-change.mjs'));

  assert.strictEqual(guard.testModeOn('true'), true);
  assert.strictEqual(guard.testModeOn('off'), false);
  assert.throws(function () {
    guard.assertStripeKeyAllowed(LIVE_KEY, 'true');
  }, /TEST_MODE/);
  assert.throws(function () {
    guard.assertStripeKeyAllowed(LIVE_RAK, '1');
  }, /TEST_MODE/);
  guard.assertStripeKeyAllowed(TEST_KEY, 'true');
  guard.assertStripeKeyAllowed(LIVE_KEY, '');

  assert.strictEqual(plans.lookupKey('enthusiast', 'beta'), 'enthusiast_beta_monthly');
  assert.strictEqual(plans.lookupKey('master_trainer', 'standard'), 'master_trainer_standard_monthly');
  assert.deepStrictEqual(plans.planFromLookupKey('trainer_standard_monthly'), { plan: 'trainer', tier: 'standard' });
  assert.strictEqual(plans.planFromLookupKey('price_hack'), null);
  assert.strictEqual(plans.planFromProduct({ id: 'prod_trainer', metadata: { plan: 'trainer' } }), 'trainer');
  assert.strictEqual(plans.planFromProduct({ id: 'prod_mt', metadata: { membership: 'Master_Trainer' } }), 'master_trainer');
  assert.strictEqual(plans.planFromProduct({ id: 'prod_mapped', metadata: {} }, { prod_mapped: 'enthusiast' }), 'enthusiast');
  assert.strictEqual(plans.planFromProduct({ id: 'prod_mapped', metadata: { plan: 'trainer' } }, { prod_mapped: 'enthusiast' }), 'trainer');
  assert.strictEqual(plans.planFromProduct({ id: 'prod_mapped', metadata: { plan: 'nope' } }, { prod_mapped: 'enthusiast' }), 'enthusiast');
  assert.strictEqual(plans.planFromProduct({ metadata: { plan: 'lifetime' } }), null);
  assert.strictEqual(checkout.planFromBody({ plan: 'trainer', price: 'price_from_browser' }), 'trainer');
  assert.strictEqual(checkout.planFromBody({ price: 'price_from_browser' }), '');

  const unapproved = dbMock({ profile: { access_approved: false, beta_locked: false, stripe_customer_id: null } });
  const stripe = stripeMock();
  await assert.rejects(function () {
    return checkout.createCheckoutSession({
      stripe: stripe,
      db: unapproved,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true'
    });
  }, /approves the account/);
  assert.deepStrictEqual(stripe.calls, []);
  assert.deepStrictEqual(names(unapproved.calls), ['loadProfile']);

  await assert.rejects(function () {
    return checkout.createCheckoutSession({
      stripe: stripe,
      db: dbMock({ profile: { access_approved: true } }),
      userId: USER,
      plan: 'lifetime',
      secretKey: TEST_KEY,
      testMode: 'true'
    });
  }, /Choose Enthusiast/);

  const held = dbMock({
    profile: { access_approved: true, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 12
  });
  const heldStripe = stripeMock();
  const created = await checkout.createCheckoutSession({
    stripe: heldStripe,
    db: held,
    userId: USER,
    email: 'payer@example.com',
    plan: 'enthusiast',
    secretKey: TEST_KEY,
    testMode: 'true',
    now: function () { return Date.parse('2026-11-25T18:00:00Z'); }
  });
  assert.strictEqual(created.body.url, 'https://checkout.stripe.com/c/pay/cs_test_session1');
  const sessionCall = heldStripe.calls.filter(function (row) { return row[0] === 'sessions.create'; })[0];
  const params = sessionCall[1];
  assert.strictEqual(params.mode, 'subscription');
  assert.strictEqual(params.customer, 'cus_Existing1');
  assert.strictEqual(params.client_reference_id, USER);
  assert.strictEqual(params.line_items[0].price, 'price_from_enthusiast_beta_monthly');
  assert.strictEqual(params.line_items[0].quantity, 1);
  assert.strictEqual(params.success_url, 'https://coachtrainerapp.com/#/account?checkout=success');
  assert.strictEqual(params.cancel_url, 'https://coachtrainerapp.com/#/subscriptions?checkout=cancel');
  assert.strictEqual(params.integration_identifier, plans.INTEGRATION_ID);
  assert.strictEqual(params.metadata.user_id, USER);
  assert.strictEqual(params.metadata.plan, 'enthusiast');
  assert.strictEqual(params.metadata.tier, 'beta');
  assert.strictEqual(params.subscription_data.metadata.supabase_user_id, USER);
  assert.strictEqual(params.subscription_data.metadata.plan, 'enthusiast');
  assert.strictEqual(params.subscription_data.metadata.tier, 'beta');
  assert.deepStrictEqual(params.managed_payments, { enabled: false });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(params, 'automatic_tax'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(params, 'payment_method_types'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(params, 'expires_at'), false);
  assert.strictEqual(sessionCall[2], undefined);
  assert.ok(names(held.calls).indexOf('beta_paid_count') !== -1);
  assert.ok(names(held.calls).indexOf('beta_reservation_hold') === -1);
  assert.ok(names(held.calls).indexOf('customers.create') === -1);

  const locked = dbMock({
    profile: { access_approved: true, beta_locked: true, stripe_customer_id: null }
  });
  const lockedStripe = stripeMock();
  await checkout.createCheckoutSession({
    stripe: lockedStripe,
    db: locked,
    userId: USER,
    plan: 'trainer',
    secretKey: TEST_KEY,
    testMode: 'true',
    now: function () { return Date.parse('2026-11-25T18:00:00Z'); }
  });
  assert.ok(names(locked.calls).indexOf('beta_paid_count') === -1);
  assert.ok(names(locked.calls).indexOf('beta_reservation_hold') === -1);
  const lockedSession = lockedStripe.calls.filter(function (row) { return row[0] === 'sessions.create'; })[0][1];
  assert.strictEqual(lockedSession.line_items[0].price, 'price_from_trainer_beta_monthly');
  assert.ok(names(locked.calls).indexOf('apply_stripe_membership') !== -1);
  assert.strictEqual(lockedStripe.calls.filter(function (row) { return row[0] === 'customers.create'; })[0][1].metadata.user_id, USER);

  const standard = dbMock({
    profile: { access_approved: true, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 100
  });
  const standardStripe = stripeMock();
  await checkout.createCheckoutSession({
    stripe: standardStripe,
    db: standard,
    userId: USER,
    plan: 'master_trainer',
    secretKey: TEST_KEY,
    testMode: 'true',
    now: function () { return Date.parse('2026-11-25T18:00:00Z'); }
  });
  const standardSession = standardStripe.calls.filter(function (row) { return row[0] === 'sessions.create'; })[0][1];
  assert.strictEqual(standardSession.line_items[0].price, 'price_from_master_trainer_standard_monthly');
  assert.strictEqual(standardSession.metadata.tier, 'standard');
  assert.ok(names(standard.calls).indexOf('beta_reservation_attach') === -1);

  const failing = dbMock({
    profile: { access_approved: true, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 1
  });
  const failingStripe = stripeMock();
  failingStripe.checkout.sessions.create = async function () {
    throw new Error('Stripe said sk_test_secret in the body');
  };
  await assert.rejects(function () {
    return checkout.createCheckoutSession({
      stripe: failingStripe,
      db: failing,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true'
    });
  }, function (err) {
    assert.strictEqual(err.message, 'Checkout could not be started.');
    assert.ok(err.message.indexOf('secret') === -1);
    return true;
  });
  assert.ok(names(failing.calls).indexOf('beta_reservation_release') === -1);

  function eventDb(extra) {
    return dbMock(Object.assign({
      profiles: { cus_Existing1: USER },
      begin: true
    }, extra || {}));
  }
  function paidInvoice() {
    return {
      id: 'evt_paid001',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_001',
          customer: 'cus_Existing1',
          period_end: Date.parse('2026-12-25T00:00:00Z') / 1000,
          parent: { subscription_details: { subscription: 'sub_payer001', metadata: { supabase_user_id: USER } } },
          lines: { data: [{ type: 'subscription', amount: 999, proration: false, period: { end: Date.parse('2026-12-25T00:00:00Z') / 1000 }, pricing: { price_details: { price: { id: 'price_1', lookup_key: 'enthusiast_beta_monthly' } } } }] }
        }
      }
    };
  }
  const paidDb = eventDb();
  const logs = [];
  const paid = await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: JSON.stringify(paidInvoice()),
    signature: 'good',
    log: function (fields) { logs.push(fields); },
    constructEvent: function (raw, sig, secret) {
      assert.strictEqual(sig, 'good');
      assert.ok(secret.indexOf('whsec_') === 0);
      return JSON.parse(raw);
    },
    db: paidDb
  });
  assert.strictEqual(paid.status, 200);
  const grant = paidDb.calls.filter(function (row) { return row[0] === 'billing_write'; })[0][1];
  assert.strictEqual(grant.p_action, 'grant');
  assert.strictEqual(grant.p_plan, 'enthusiast');
  assert.strictEqual(grant.p_profile, USER);
  assert.strictEqual(grant.p_subscription_id, 'sub_payer001');
  assert.strictEqual(grant.p_beta, true);
  assert.ok(names(paidDb.calls).indexOf('beta_reservation_confirm') === -1);
  assert.ok(names(paidDb.calls).indexOf('stripe_event_begin') !== -1);
  assert.ok(JSON.stringify(logs).indexOf('card') === -1);
  assert.ok(JSON.stringify(logs).indexOf(TEST_KEY) === -1);

  const dup = eventDb({ seen: true });
  const dupResult = await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () { return { id: 'evt_paid001', type: 'invoice.paid', data: { object: {} } }; },
    db: dup
  });
  assert.strictEqual(dupResult.status, 200);
  assert.deepStrictEqual(names(dup.calls), ['eventSeen']);

  await assert.rejects(function () {
    return webhook.handleWebhook({
      stripe: stripeMock(),
      secretKey: TEST_KEY,
      testMode: 'true',
      webhookSecret: 'whsec_' + 'example',
      rawBody: '{}',
      signature: 'bad',
      constructEvent: function () { throw new Error('signature'); },
      db: eventDb()
    });
  }, /Invalid signature/);

  const unpaid = eventDb();
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_unpaid1',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test_open', payment_status: 'unpaid', customer: 'cus_Existing1', metadata: { user_id: USER } } }
      };
    },
    db: unpaid
  });
  assert.ok(names(unpaid.calls).indexOf('apply_stripe_membership') === -1);

  const completed = eventDb();
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_done1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_done',
            payment_status: 'paid',
            customer: 'cus_Existing1',
            subscription: 'sub_payer001',
            client_reference_id: USER,
            metadata: { user_id: USER }
          }
        }
      };
    },
    db: completed
  });
  const completedApply = completed.calls.filter(function (row) { return row[0] === 'billing_write'; })[0][1];
  assert.strictEqual(completedApply.p_action, 'attach');
  assert.ok(names(completed.calls).indexOf('beta_reservation_attach') === -1);
  assert.ok(names(completed.calls).indexOf('beta_reservation_confirm') === -1);

  const updated = eventDb();
  const updatedStripe = stripeMock();
  await webhook.handleWebhook({
    stripe: updatedStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_subupd1',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_payer001',
            customer: 'cus_Existing1',
            status: 'active',
            metadata: { supabase_user_id: USER },
            items: { data: [{ price: 'price_only_id', current_period_end: 1798329600 }] }
          }
        }
      };
    },
    db: updated
  });
  assert.deepStrictEqual(updatedStripe.calls[0], ['prices.retrieve', 'price_only_id']);
  const sync = updated.calls.filter(function (row) { return row[0] === 'billing_write'; })[0][1];
  assert.strictEqual(sync.p_action, 'sync');
  assert.strictEqual(sync.p_plan, 'trainer');
  assert.strictEqual(sync.p_billing_status, 'active');
  assert.ok(sync.p_period_end.indexOf('2026') === -1 || sync.p_period_end.indexOf('T') !== -1);

  const failed = eventDb();
  const renewalStripe = stripeMock();
  renewalStripe.subscriptions.retrieve = async function (id) {
    renewalStripe.calls.push(['subscriptions.retrieve', id]);
    return { id: id, status: 'past_due' };
  };
  const renewalLogs = [];
  const renewalRpc = failed.rpc;
  failed.rpc = async function (name, args) {
    const result = await renewalRpc(name, args);
    if (name === 'apply_stripe_membership') return { applied: true, newly_ended: true, membership: 'none' };
    return result;
  };
  await webhook.handleWebhook({
    stripe: renewalStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    log: function (fields) { renewalLogs.push(fields); },
    constructEvent: function () {
      return {
        id: 'evt_fail1',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_fail_cycle',
            customer: 'cus_Existing1',
            billing_reason: 'subscription_cycle',
            parent: { subscription_details: { subscription: 'sub_payer001', metadata: { user_id: USER } } },
            lines: { data: [] }
          }
        }
      };
    },
    db: failed
  });
  const endedRenewal = failed.calls.filter(function (row) { return row[0] === 'apply_stripe_membership'; })[0][1];
  assert.strictEqual(endedRenewal.p_action, 'end');
  assert.strictEqual(endedRenewal.p_billing_status, 'canceled');
  assert.strictEqual(endedRenewal.p_subscription_id, 'sub_payer001');
  assert.strictEqual(endedRenewal.p_period_end, null);
  const renewalCancel = renewalStripe.calls.filter(function (row) { return row[0] === 'subscriptions.cancel'; })[0];
  assert.strictEqual(renewalCancel[1], 'sub_payer001');
  assert.deepStrictEqual(renewalCancel[2], { prorate: false, invoice_now: false });
  assert.deepStrictEqual(renewalCancel[3], { idempotencyKey: 'cancel-failed-renewal-in_fail_cycle' });
  assert.ok(renewalLogs.some(function (row) { return row.result === 'plan_ended_email_pending'; }));
  assert.ok(names(failed.calls).indexOf('beta_reservation_release') === -1);
  assert.ok(JSON.stringify(renewalLogs).indexOf('sk_') === -1);

  const ignoredFail = eventDb();
  const ignoredStripe = stripeMock();
  await webhook.handleWebhook({
    stripe: ignoredStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_fail_create',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_fail_create',
            customer: 'cus_Existing1',
            billing_reason: 'subscription_create',
            parent: { subscription_details: { subscription: 'sub_payer001', metadata: { user_id: USER } } }
          }
        }
      };
    },
    db: ignoredFail
  });
  assert.ok(names(ignoredFail.calls).indexOf('apply_stripe_membership') === -1);
  assert.ok(ignoredStripe.calls.filter(function (row) { return row[0] === 'subscriptions.cancel'; }).length === 0);

  const staleFail = eventDb();
  const staleFailStripe = stripeMock();
  await webhook.handleWebhook({
    stripe: staleFailStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_fail_recovered',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_fail_recovered',
            customer: 'cus_Existing1',
            billing_reason: 'subscription_cycle',
            parent: { subscription_details: { subscription: 'sub_payer001', metadata: { user_id: USER } } }
          }
        }
      };
    },
    db: staleFail
  });
  assert.ok(names(staleFail.calls).indexOf('apply_stripe_membership') === -1);
  assert.ok(staleFailStripe.calls.filter(function (row) { return row[0] === 'subscriptions.cancel'; }).length === 0);
  assert.ok(staleFailStripe.calls.some(function (row) {
    return row[0] === 'subscriptions.retrieve' && row[1] === 'sub_payer001';
  }));

  const ended = eventDb();
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_del1',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_payer001',
            customer: 'cus_Existing1',
            status: 'canceled',
            metadata: { user_id: USER },
            items: { data: [{ current_period_end: Date.parse('2020-01-01T00:00:00Z') / 1000 }] }
          }
        }
      };
    },
    db: ended
  });
  const endCall = ended.calls.filter(function (row) { return row[0] === 'apply_stripe_membership'; })[0][1];
  assert.strictEqual(endCall.p_action, 'end');
  assert.strictEqual(endCall.p_billing_status, 'canceled');

  const createdSub = eventDb();
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_newsub',
        type: 'customer.subscription.created',
        data: { object: { id: 'sub_payer001', customer: 'cus_Existing1', status: 'incomplete', metadata: { user_id: USER }, items: { data: [] } } }
      };
    },
    db: createdSub
  });
  assert.ok(names(createdSub.calls).indexOf('apply_stripe_membership') === -1);

  const kept = dbMock({
    profiles: {},
    begin: true
  });
  kept.findProfile = async function () {
    kept.calls.push(['findProfile']);
    return { id: USER, complimentary: true, billing_status: null, stripe_subscription_id: null };
  };
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_keep1',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_abandoned',
            customer: 'cus_Existing1',
            status: 'canceled',
            metadata: { user_id: USER },
            items: { data: [{ current_period_end: Date.parse('2020-01-01T00:00:00Z') / 1000 }] }
          }
        }
      };
    },
    db: kept
  });
  assert.ok(names(kept.calls).indexOf('apply_stripe_membership') === -1);
  assert.ok(names(kept.calls).indexOf('beta_reservation_release') === -1);

  const portalStripe = stripeMock();
  const opened = await portal.createPortalSession({
    stripe: portalStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    userId: USER,
    portalBeta: 'bpc_beta',
    portalStandard: 'bpc_standard',
    db: dbMock({ profile: { stripe_customer_id: 'cus_Existing1', beta_locked: true, access_approved: true } })
  });
  assert.strictEqual(opened.body.url, 'https://billing.stripe.com/p/session/test_portal');
  assert.deepStrictEqual(Object.keys(portalStripe.calls[0][1]).sort(), ['customer', 'return_url']);
  assert.strictEqual(portalStripe.calls[0][1].customer, 'cus_Existing1');
  assert.strictEqual(portalStripe.calls[0][1].return_url, 'https://coachtrainerapp.com/#/account');
  assert.strictEqual(portalStripe.calls[0][1].configuration, undefined);

  const standardPortal = stripeMock();
  await portal.createPortalSession({
    stripe: standardPortal,
    secretKey: TEST_KEY,
    testMode: 'true',
    userId: USER,
    db: dbMock({ profile: { stripe_customer_id: 'cus_Existing1', beta_locked: false, access_approved: true } })
  });
  assert.strictEqual(standardPortal.calls[0][1].configuration, undefined);
  assert.deepStrictEqual(Object.keys(standardPortal.calls[0][1]).sort(), ['customer', 'return_url']);

  await assert.rejects(function () {
    return portal.createPortalSession({
      stripe: stripeMock(),
      secretKey: TEST_KEY,
      testMode: 'true',
      userId: USER,
      db: dbMock({ profile: { stripe_customer_id: null, beta_locked: false, access_approved: true } })
    });
  }, /subscribe/);

  const broken = eventDb({ failRpc: 'billing_write', failMessage: 'database down' });
  await assert.rejects(function () {
    return webhook.handleWebhook({
      stripe: stripeMock(),
      secretKey: TEST_KEY,
      testMode: 'true',
      webhookSecret: 'whsec_' + 'example',
      rawBody: '{}',
      signature: 'good',
      constructEvent: function () { return paidInvoice(); },
      db: broken
    });
  }, /database down/);
  assert.ok(names(broken.calls).indexOf('stripe_event_begin') === -1);

  const comp = dbMock({
    profile: { access_approved: true, complimentary: true, beta_locked: false, billing_status: null, stripe_subscription_id: null }
  });
  await assert.rejects(function () {
    return checkout.createCheckoutSession({
      stripe: stripeMock(),
      db: comp,
      userId: USER,
      plan: 'trainer',
      secretKey: TEST_KEY,
      testMode: 'true'
    });
  }, /keeps its current plan/);
  assert.ok(names(comp.calls).indexOf('beta_paid_count') === -1);
  assert.ok(names(comp.calls).indexOf('beta_reservation_hold') === -1);
  assert.strictEqual(comp.calls[0][0], 'loadProfile');

  const already = dbMock({
    profile: { access_approved: true, complimentary: false, billing_status: 'active', stripe_subscription_id: 'sub_payer001', beta_locked: true }
  });
  await assert.rejects(function () {
    return checkout.createCheckoutSession({
      stripe: stripeMock(),
      db: already,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true'
    });
  }, /Manage billing/);
  assert.ok(names(already.calls).indexOf('beta_paid_count') === -1);
  assert.ok(names(already.calls).indexOf('beta_reservation_hold') === -1);

  await assert.rejects(function () {
    return portal.createPortalSession({
      stripe: stripeMock(),
      secretKey: TEST_KEY,
      testMode: 'true',
      userId: USER,
      db: dbMock({ profile: { access_approved: false, stripe_customer_id: 'cus_Existing1', beta_locked: false } })
    });
  }, /approves the account/);

  const upgrade = eventDb();
  const lineEnd = Date.parse('2027-02-01T00:00:00Z') / 1000;
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_upgrade1',
        type: 'invoice.paid',
        data: {
          object: {
            customer: 'cus_Existing1',
            period_end: Date.parse('2026-01-01T00:00:00Z') / 1000,
            parent: {
              subscription_details: {
                subscription: {
                  id: 'sub_payer001',
                  current_period_end: Date.parse('2027-01-15T00:00:00Z') / 1000,
                  items: { data: [{ price: { id: 'price_new', lookup_key: 'trainer_beta_monthly' }, current_period_end: lineEnd }] },
                  metadata: { supabase_user_id: USER }
                },
                metadata: { supabase_user_id: USER }
              }
            },
            lines: {
              data: [
                {
                  amount: -999,
                  proration: true,
                  type: 'invoiceitem',
                  period: { end: Date.parse('2026-06-01T00:00:00Z') / 1000 },
                  pricing: { price_details: { price: { id: 'price_old', lookup_key: 'enthusiast_beta_monthly' } } }
                },
                {
                  amount: 1999,
                  proration: false,
                  type: 'subscription',
                  period: { end: lineEnd },
                  pricing: { price_details: { price: { id: 'price_new', lookup_key: 'trainer_beta_monthly' } } }
                }
              ]
            }
          }
        }
      };
    },
    db: upgrade
  });
  const upgraded = upgrade.calls.filter(function (row) { return row[0] === 'billing_write'; })[0][1];
  assert.strictEqual(upgraded.p_action, 'grant');
  assert.strictEqual(upgraded.p_plan, 'trainer');
  assert.strictEqual(upgraded.p_period_end, new Date(lineEnd * 1000).toISOString());
  assert.strictEqual(upgraded.p_beta, true);

  const endedAt = Date.parse('2026-12-01T12:00:00Z') / 1000;
  const closed = eventDb();
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_endedat',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_payer001',
            customer: 'cus_Existing1',
            status: 'canceled',
            ended_at: endedAt,
            metadata: { user_id: USER },
            items: { data: [{ current_period_end: Date.parse('2027-06-01T00:00:00Z') / 1000 }] }
          }
        }
      };
    },
    db: closed
  });
  const closedCall = closed.calls.filter(function (row) { return row[0] === 'apply_stripe_membership'; })[0][1];
  assert.strictEqual(closedCall.p_period_end, new Date(endedAt * 1000).toISOString());

  const retry = dbMock({
    profile: { access_approved: true, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 3
  });
  const retryStripe = stripeMock();
  retryStripe.checkout.sessions.create = async function () {
    const err = new Error('Keys for idempotent requests must match');
    err.code = 'idempotency_error';
    throw err;
  };
  await assert.rejects(function () {
    return checkout.createCheckoutSession({
      stripe: retryStripe,
      db: retry,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true',
      now: function () { return Date.parse('2026-11-25T18:00:00Z'); }
    });
  }, /could not be started/);
  assert.ok(names(retry.calls).indexOf('beta_reservation_release') === -1);

  const firstFail = dbMock({ profiles: { cus_Existing1: { id: USER, complimentary: true, billing_status: null, stripe_subscription_id: null } } });
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_firstfail',
        type: 'invoice.payment_failed',
        data: {
          object: {
            customer: 'cus_Existing1',
            parent: { subscription_details: { subscription: 'sub_new001', metadata: { user_id: USER } } }
          }
        }
      };
    },
    db: firstFail
  });
  assert.ok(names(firstFail.calls).indexOf('apply_stripe_membership') === -1);
  assert.ok(names(firstFail.calls).indexOf('beta_reservation_release') === -1);

  const neverPaid = dbMock({ profiles: { cus_Existing1: { id: USER, complimentary: false, billing_status: null, stripe_subscription_id: null } } });
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_never',
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_new001', customer: 'cus_Existing1', status: 'canceled', metadata: { user_id: USER }, ended_at: endedAt } }
      };
    },
    db: neverPaid
  });
  assert.ok(names(neverPaid.calls).indexOf('apply_stripe_membership') === -1);

  const prorated = eventDb();
  const currentEnd = Date.parse('2027-03-01T00:00:00.000Z') / 1000;
  const prorateStripe = stripeMock();
  await webhook.handleWebhook({
    stripe: prorateStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_prorate1',
        type: 'invoice.paid',
        data: {
          object: {
            customer: 'cus_Existing1',
            period_end: Date.parse('2026-01-01T00:00:00.000Z') / 1000,
            parent: { subscription_details: { subscription: 'sub_payer001', metadata: { supabase_user_id: USER } } },
            lines: {
              data: [
                {
                  amount: -999,
                  proration: true,
                  type: 'invoiceitem',
                  period: { end: Date.parse('2026-06-01T00:00:00.000Z') / 1000 },
                  pricing: { price_details: { price: { id: 'price_old', lookup_key: 'enthusiast_beta_monthly' } } }
                }
              ]
            }
          }
        }
      };
    },
    db: prorated
  });
  assert.deepStrictEqual(prorateStripe.calls.filter(function (row) { return row[0] === 'subscriptions.retrieve'; })[0], ['subscriptions.retrieve', 'sub_payer001']);
  const proratedGrant = prorated.calls.filter(function (row) { return row[0] === 'billing_write'; })[0][1];
  assert.strictEqual(proratedGrant.p_plan, 'master_trainer');
  assert.strictEqual(proratedGrant.p_period_end, new Date(currentEnd * 1000).toISOString());
  assert.strictEqual(proratedGrant.p_beta, false);

  const reuse = dbMock({
    profile: { access_approved: true, billing_status: 'canceled', beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 4
  });
  const reuseStripe = stripeMock();
  reuseStripe.checkout.sessions.list = async function (params) {
    reuseStripe.calls.push(['sessions.list', params]);
    return { data: [{ id: 'cs_open_1', status: 'open', url: 'https://checkout.stripe.com/c/pay/cs_open_1' }] };
  };
  reuseStripe.checkout.sessions.expire = async function () {
    throw new Error('must not expire');
  };
  const reused = await checkout.createCheckoutSession({
    stripe: reuseStripe,
    db: reuse,
    userId: USER,
    plan: 'trainer',
    secretKey: TEST_KEY,
    testMode: 'true'
  });
  assert.strictEqual(reused.body.url, 'https://checkout.stripe.com/c/pay/cs_open_1');
  assert.ok(reuseStripe.calls.filter(function (row) { return row[0] === 'sessions.create'; }).length === 0);
  const reuseLists = reuseStripe.calls.filter(function (row) { return row[0] === 'sessions.list'; });
  assert.ok(reuseLists.some(function (row) { return row[1].status === 'open'; }));
  assert.ok(names(reuse.calls).indexOf('beta_reservation_hold') === -1);

  const again = dbMock({
    profile: { access_approved: true, billing_status: 'canceled', beta_locked: true, stripe_customer_id: 'cus_Existing1' }
  });
  const againStripe = stripeMock();
  againStripe.checkout.sessions.list = async function () {
    againStripe.calls.push(['sessions.list', { status: 'open' }]);
    return { data: [] };
  };
  const resub = await checkout.createCheckoutSession({
    stripe: againStripe,
    db: again,
    userId: USER,
    plan: 'enthusiast',
    secretKey: TEST_KEY,
    testMode: 'true'
  });
  assert.strictEqual(resub.body.url, 'https://checkout.stripe.com/c/pay/cs_test_session1');
  assert.strictEqual(againStripe.calls.filter(function (row) { return row[0] === 'sessions.create'; })[0][1].line_items[0].price, 'price_from_enthusiast_beta_monthly');

  const dupLogs = [];
  const dupStripe = stripeMock();
  const canceled = [];
  const refunds = [];
  dupStripe.subscriptions.retrieve = async function (id) {
    return { id: id, status: 'active', created: id === 'sub_duplicate' ? 200 : 100 };
  };
  dupStripe.subscriptions.cancel = async function (id) {
    canceled.push(id);
    return { id: id, status: 'canceled' };
  };
  dupStripe.invoices = {
    list: async function () {
      return { data: [{ id: 'in_first', status: 'paid', created: 10 }] };
    }
  };
  dupStripe.invoicePayments = {
    list: async function (params) {
      return { data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_first' }, invoice: params.invoice }] };
    }
  };
  dupStripe.refunds = {
    create: async function (params, opts) {
      refunds.push([params, opts]);
      return { id: 're_first' };
    }
  };
  const dupDb = eventDb({
    billingWrite: function (args) {
      return {
        applied: false,
        duplicate: true,
        kept_subscription_id: 'sub_payer001',
        incoming_subscription_id: args.p_subscription_id
      };
    }
  });
  const dupPaid = await webhook.handleWebhook({
    stripe: dupStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    log: function (fields) { dupLogs.push(fields); },
    constructEvent: function () {
      return {
        id: 'evt_dup_invoice',
        type: 'invoice.paid',
        data: {
          object: {
            customer: 'cus_Existing1',
            period_end: Date.parse('2027-04-01T00:00:00.000Z') / 1000,
            parent: { subscription_details: { subscription: 'sub_duplicate', metadata: { supabase_user_id: USER } } },
            lines: {
              data: [{
                type: 'subscription',
                amount: 999,
                proration: false,
                period: { end: Date.parse('2027-04-01T00:00:00.000Z') / 1000 },
                pricing: { price_details: { price: { id: 'price_1', lookup_key: 'enthusiast_beta_monthly' } } }
              }]
            }
          }
        }
      };
    },
    db: dupDb
  });
  assert.strictEqual(dupPaid.status, 200);
  assert.deepStrictEqual(canceled, ['sub_duplicate']);
  assert.deepStrictEqual(refunds, [[{ payment_intent: 'pi_first' }, { idempotencyKey: 'refund-in_first' }]]);
  assert.ok(names(dupDb.calls).indexOf('apply_stripe_membership') === -1);
  assert.ok(names(dupDb.calls).indexOf('mark_beta_paid') === -1);
  assert.ok(JSON.stringify(dupLogs).indexOf('Refund the duplicate subscription') !== -1);

  const dupDelete = eventDb();
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_dup_delete',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_duplicate',
            customer: 'cus_Existing1',
            status: 'canceled',
            metadata: { user_id: USER }
          }
        }
      };
    },
    db: dupDelete
  });
  assert.ok(names(dupDelete.calls).indexOf('apply_stripe_membership') === -1);

  const cancelFail = stripeMock();
  cancelFail.subscriptions.retrieve = async function (id) {
    return { id: id, status: 'active' };
  };
  cancelFail.subscriptions.cancel = async function () {
    const err = new Error('This subscription could not be canceled');
    err.statusCode = 500;
    throw err;
  };
  await assert.rejects(function () {
    return webhook.handleWebhook({
      stripe: cancelFail,
      secretKey: TEST_KEY,
      testMode: 'true',
      webhookSecret: 'whsec_' + 'example',
      rawBody: '{}',
      signature: 'good',
      constructEvent: function () {
        return {
          id: 'evt_cancel_fail',
          type: 'invoice.paid',
          data: {
            object: {
              customer: 'cus_Existing1',
              parent: { subscription_details: { subscription: 'sub_duplicate', metadata: { supabase_user_id: USER } } },
              lines: {
                data: [{
                  type: 'subscription',
                  amount: 999,
                  proration: false,
                  pricing: { price_details: { price: { id: 'price_1', lookup_key: 'enthusiast_standard_monthly' } } }
                }]
              }
            }
          }
        };
      },
      db: eventDb({
        billingWrite: function (args) {
          return {
            duplicate: true,
            kept_subscription_id: 'sub_payer001',
            incoming_subscription_id: args.p_subscription_id
          };
        }
      })
    });
  }, function (err) {
    assert.ok(err);
    assert.ok(!err.status || err.status >= 400);
    return true;
  });

  const lateDb = eventDb();
  const lateRpc = lateDb.rpc;
  lateDb.rpc = async function (name, args) {
    if (name === 'billing_write') throw new Error('already applied');
    return lateRpc(name, args);
  };
  const late = await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_late_checkout',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_late',
            payment_status: 'paid',
            customer: 'cus_Existing1',
            subscription: 'sub_payer001',
            client_reference_id: USER,
            metadata: { user_id: USER }
          }
        }
      };
    },
    db: lateDb
  });
  assert.strictEqual(late.status, 200);
  assert.ok(names(lateDb.calls).indexOf('stripe_event_begin') !== -1);

  const attachFail = eventDb();
  const attachRpc = attachFail.rpc;
  attachFail.rpc = async function (name, args) {
    if (name === 'billing_write') throw new Error('database down');
    return attachRpc(name, args);
  };
  await assert.rejects(function () {
    return webhook.handleWebhook({
      stripe: stripeMock(),
      secretKey: TEST_KEY,
      testMode: 'true',
      webhookSecret: 'whsec_' + 'example',
      rawBody: '{}',
      signature: 'good',
      constructEvent: function () {
        return {
          id: 'evt_attach_fail',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_attach_fail',
              payment_status: 'paid',
              customer: 'cus_Existing1',
              subscription: 'sub_payer001',
              client_reference_id: USER
            }
          }
        };
      },
      db: attachFail
    });
  }, /database down/);

  const nowMs = Date.parse('2026-11-25T18:00:00Z');
  const nowSec = Math.floor(nowMs / 1000);
  const payingBlocked = dbMock({
    profile: { access_approved: true, billing_status: 'canceled', beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 3
  });
  const payingStripe = stripeMock();
  payingStripe.subscriptions.list = async function () {
    return { data: [{ id: 'sub_live', status: 'active', created: nowSec - 60 }] };
  };
  await assert.rejects(function () {
    return checkout.createCheckoutSession({
      stripe: payingStripe,
      db: payingBlocked,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true',
      now: function () { return nowMs; }
    });
  }, function (err) {
    assert.strictEqual(err.status, 409);
    assert.ok(/Manage billing/.test(err.message));
    return true;
  });
  assert.ok(payingStripe.calls.filter(function (row) { return row[0] === 'sessions.create'; }).length === 0);

  const recentPaid = dbMock({
    profile: { access_approved: true, billing_status: null, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 3
  });
  const recentStripe = stripeMock();
  recentStripe.checkout.sessions.list = async function (params) {
    if (params.status === 'complete') {
      return { data: [{ id: 'cs_just_paid', status: 'complete', created: nowSec - 60 }] };
    }
    return { data: [] };
  };
  await assert.rejects(function () {
    return checkout.createCheckoutSession({
      stripe: recentStripe,
      db: recentPaid,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true',
      now: function () { return nowMs; }
    });
  }, function (err) {
    assert.strictEqual(err.status, 409);
    return true;
  });

  const oldIncomplete = dbMock({
    profile: { access_approved: true, billing_status: null, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 3
  });
  const oldStripe = stripeMock();
  oldStripe.subscriptions.list = async function () {
    return { data: [{ id: 'sub_old_incomplete', status: 'incomplete', created: nowSec - 31 * 60 }] };
  };
  const oldResult = await checkout.createCheckoutSession({
    stripe: oldStripe,
    db: oldIncomplete,
    userId: USER,
    plan: 'enthusiast',
    secretKey: TEST_KEY,
    testMode: 'true',
    now: function () { return nowMs; }
  });
  assert.ok(oldResult.body.url);

  const freshIncomplete = dbMock({
    profile: { access_approved: true, billing_status: null, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 3
  });
  const freshStripe = stripeMock();
  freshStripe.subscriptions.list = async function () {
    return { data: [{ id: 'sub_fresh', status: 'incomplete', created: nowSec - 60 }] };
  };
  await assert.rejects(function () {
    return checkout.createCheckoutSession({
      stripe: freshStripe,
      db: freshIncomplete,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true',
      now: function () { return nowMs; }
    });
  }, function (err) {
    assert.strictEqual(err.status, 409);
    return true;
  });

  const raceState = { session: null, claims: 0, created: 0 };
  let releaseCreate = function () {};
  const createdGate = new Promise(function (resolve) { releaseCreate = resolve; });
  function racePair() {
    const db = dbMock({
      profile: { access_approved: true, billing_status: null, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
      betaCount: 2
    });
    const stripe = stripeMock();
    db.rpc = async function (name) {
      if (name === 'checkout_claim') {
        raceState.claims += 1;
        db.granted = raceState.claims === 1;
        return { granted: db.granted };
      }
      if (name === 'beta_paid_count') return 2;
      return { applied: true };
    };
    stripe.checkout.sessions.list = async function (params) {
      if (params.status !== 'open') return { data: [] };
      if (db.granted === false && !raceState.session) await createdGate;
      return { data: raceState.session ? [raceState.session] : [] };
    };
    stripe.checkout.sessions.create = async function (params) {
      raceState.created += 1;
      raceState.session = {
        id: 'cs_only',
        url: 'https://checkout.stripe.com/c/pay/cs_only',
        status: 'open',
        created: 10,
        metadata: params.metadata
      };
      releaseCreate();
      return raceState.session;
    };
    stripe.checkout.sessions.expire = async function () { throw new Error('must not expire the only session'); };
    return { db: db, stripe: stripe };
  }
  const firstRace = racePair();
  const secondRace = racePair();
  const pair = await Promise.all([
    checkout.createCheckoutSession({
      stripe: firstRace.stripe,
      db: firstRace.db,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true',
      now: function () { return nowMs; }
    }),
    checkout.createCheckoutSession({
      stripe: secondRace.stripe,
      db: secondRace.db,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true',
      now: function () { return nowMs; }
    })
  ]);
  assert.strictEqual(raceState.created, 1);
  assert.strictEqual(pair[0].body.url, 'https://checkout.stripe.com/c/pay/cs_only');
  assert.strictEqual(pair[1].body.url, 'https://checkout.stripe.com/c/pay/cs_only');

  const switched = dbMock({
    profile: { access_approved: true, billing_status: null, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 4
  });
  const switchedStripe = stripeMock();
  const expiredPlans = [];
  switchedStripe.checkout.sessions.list = async function (params) {
    if (params.status !== 'open') return { data: [] };
    if (expiredPlans.indexOf('cs_enthusiast') !== -1) return { data: [] };
    return {
      data: [{
        id: 'cs_enthusiast',
        status: 'open',
        created: 5,
        url: 'https://checkout.stripe.com/c/pay/cs_enthusiast',
        metadata: { plan: 'enthusiast', tier: 'beta' }
      }]
    };
  };
  switchedStripe.checkout.sessions.retrieve = async function (id) {
    return { id: id, status: 'open' };
  };
  switchedStripe.checkout.sessions.expire = async function (id) {
    expiredPlans.push(id);
    return { id: id, status: 'expired' };
  };
  const switchedResult = await checkout.createCheckoutSession({
    stripe: switchedStripe,
    db: switched,
    userId: USER,
    plan: 'trainer',
    secretKey: TEST_KEY,
    testMode: 'true',
    now: function () { return nowMs; }
  });
  assert.deepStrictEqual(expiredPlans, ['cs_enthusiast']);
  assert.strictEqual(switchedResult.body.url, 'https://checkout.stripe.com/c/pay/cs_test_session1');
  assert.strictEqual(switchedStripe.calls.filter(function (row) { return row[0] === 'sessions.create'; })[0][1].metadata.plan, 'trainer');

  const staleStripe = stripeMock();
  const staleCanceled = [];
  const staleRefunds = [];
  const keptIds = [];
  staleStripe.subscriptions.retrieve = async function (id) {
    return { id: id, status: 'active', created: id === 'sub_newer' ? 500 : 100 };
  };
  staleStripe.subscriptions.cancel = async function (id) {
    staleCanceled.push(id);
    return { id: id, status: 'canceled' };
  };
  staleStripe.invoices = { list: async function () { return { data: [{ id: 'in_new', status: 'paid', created: 1 }] }; } };
  staleStripe.invoicePayments = {
    list: async function () {
      return { data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_new' } }] };
    }
  };
  staleStripe.refunds = { create: async function (params, opts) { staleRefunds.push([params, opts]); return { id: 're_new' }; } };
  const stored = { id: null };
  const staleDb = eventDb({
    profiles: {
      cus_Existing1: { id: USER, complimentary: false, billing_status: null, stripe_subscription_id: null, stripe_customer_id: 'cus_Existing1' }
    },
    billingWrite: function (args) {
      if (stored.id && stored.id !== args.p_subscription_id) {
        return {
          duplicate: true,
          kept_subscription_id: stored.id,
          incoming_subscription_id: args.p_subscription_id
        };
      }
      stored.id = args.p_subscription_id;
      return { applied: true, duplicate: false };
    }
  });
  const staleRpc = staleDb.rpc;
  staleDb.rpc = async function (name, args) {
    if (name === 'keep_paid_subscription') {
      keptIds.push(args.p_subscription_id);
      stored.id = args.p_subscription_id;
      return { applied: true };
    }
    return staleRpc(name, args);
  };
  function paidFor(id, sub) {
    return {
      id: id,
      type: 'invoice.paid',
      data: {
        object: {
          customer: 'cus_Existing1',
          parent: { subscription_details: { subscription: sub, metadata: { supabase_user_id: USER } } },
          lines: {
            data: [{
              type: 'subscription',
              amount: 999,
              proration: false,
              period: { end: Date.parse('2027-05-01T00:00:00Z') / 1000 },
              pricing: { price_details: { price: { id: 'price_1', lookup_key: 'enthusiast_beta_monthly' } } }
            }]
          }
        }
      }
    };
  }
  await webhook.handleWebhook({
    stripe: staleStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () { return paidFor('evt_stale_new', 'sub_newer'); },
    db: staleDb
  });
  await webhook.handleWebhook({
    stripe: staleStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () { return paidFor('evt_stale_old', 'sub_older'); },
    db: staleDb
  });
  assert.deepStrictEqual(keptIds, ['sub_older']);
  assert.deepStrictEqual(staleCanceled, ['sub_newer']);
  assert.deepStrictEqual(staleRefunds, [[{ payment_intent: 'pi_new' }, { idempotencyKey: 'refund-in_new' }]]);
  assert.strictEqual(stored.id, 'sub_older');

  const missingPay = stripeMock();
  missingPay.subscriptions.retrieve = async function (id) {
    return { id: id, status: 'active', created: id === 'sub_duplicate' ? 200 : 100 };
  };
  missingPay.subscriptions.cancel = async function (id) {
    return { id: id, status: 'canceled' };
  };
  missingPay.invoices = { list: async function () { return { data: [{ id: 'in_empty', status: 'paid', created: 4 }] }; } };
  missingPay.invoicePayments = { list: async function () { return { data: [] }; } };
  missingPay.refunds = { create: async function () { throw new Error('should not refund'); } };
  await assert.rejects(function () {
    return webhook.handleWebhook({
      stripe: missingPay,
      secretKey: TEST_KEY,
      testMode: 'true',
      webhookSecret: 'whsec_' + 'example',
      rawBody: '{}',
      signature: 'good',
      constructEvent: function () {
        return {
          id: 'evt_missing_pay',
          type: 'invoice.paid',
          data: {
            object: {
              customer: 'cus_Existing1',
              parent: { subscription_details: { subscription: 'sub_duplicate', metadata: { supabase_user_id: USER } } },
              lines: {
                data: [{
                  type: 'subscription',
                  amount: 999,
                  proration: false,
                  pricing: { price_details: { price: { id: 'price_1', lookup_key: 'enthusiast_standard_monthly' } } }
                }]
              }
            }
          }
        };
      },
      db: eventDb({
        billingWrite: function (args) {
          return {
            duplicate: true,
            kept_subscription_id: 'sub_payer001',
            incoming_subscription_id: args.p_subscription_id
          };
        }
      })
    });
  }, function (err) {
    assert.ok(!err.status || err.status >= 400);
    return true;
  });

  const retrySweep = stripeMock();
  const sweepCanceled = [];
  retrySweep.subscriptions.list = async function () {
    return {
      data: [
        { id: 'sub_older', status: 'active', created: 100 },
        { id: 'sub_newer', status: 'active', created: 400 }
      ]
    };
  };
  retrySweep.subscriptions.retrieve = async function (id) {
    return { id: id, status: 'active', created: id === 'sub_newer' ? 400 : 100 };
  };
  retrySweep.subscriptions.cancel = async function (id) {
    sweepCanceled.push(id);
    return { id: id, status: 'canceled' };
  };
  retrySweep.invoices = { list: async function () { return { data: [{ id: 'in_retry', status: 'paid', created: 2 }] }; } };
  retrySweep.invoicePayments = { list: async function () { return { data: [{ payment: { payment_intent: 'pi_retry' } }] }; } };
  retrySweep.refunds = { create: async function () { return { id: 're_retry' }; } };
  const retryPaid = await webhook.handleWebhook({
    stripe: retrySweep,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_retry_older',
        type: 'invoice.paid',
        data: {
          object: {
            customer: 'cus_Existing1',
            parent: { subscription_details: { subscription: 'sub_older', metadata: { supabase_user_id: USER } } },
            lines: {
              data: [{
                type: 'subscription',
                amount: 999,
                proration: false,
                pricing: { price_details: { price: { id: 'price_1', lookup_key: 'enthusiast_beta_monthly' } } }
              }]
            }
          }
        }
      };
    },
    db: eventDb({
      profiles: {
        cus_Existing1: {
          id: USER,
          complimentary: false,
          billing_status: 'active',
          stripe_subscription_id: 'sub_older',
          stripe_customer_id: 'cus_Existing1'
        }
      },
      billingWrite: function () {
        return { applied: true, duplicate: false };
      }
    })
  });
  assert.strictEqual(retryPaid.status, 200);
  assert.deepStrictEqual(sweepCanceled, ['sub_newer']);

  const switchDb = dbMock({
    profile: { access_approved: true, billing_status: null, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 4
  });
  let planClaims = 0;
  switchDb.rpc = async function (name, args) {
    switchDb.calls.push([name, args]);
    if (name === 'beta_paid_count') return 4;
    if (name === 'checkout_claim') {
      planClaims += 1;
      if (planClaims === 1) return { granted: false, plan: 'enthusiast' };
      return { granted: true, plan: args.p_plan };
    }
    if (name === 'checkout_claim_release') return {};
    return { applied: true };
  };
  const switchStripe = stripeMock();
  const replaced = [];
  switchStripe.checkout.sessions.list = async function (params) {
    if (params.status !== 'open') return { data: [] };
    if (replaced.indexOf('cs_old_plan') !== -1) return { data: [] };
    return {
      data: [{
        id: 'cs_old_plan',
        status: 'open',
        created: 3,
        url: 'https://checkout.stripe.com/c/pay/cs_old_plan',
        metadata: { plan: 'enthusiast', tier: 'beta' }
      }]
    };
  };
  switchStripe.checkout.sessions.retrieve = async function (id) {
    return { id: id, status: 'open' };
  };
  switchStripe.checkout.sessions.expire = async function (id) {
    replaced.push(id);
    return { id: id, status: 'expired' };
  };
  const switchedPlan = await checkout.createCheckoutSession({
    stripe: switchStripe,
    db: switchDb,
    userId: USER,
    plan: 'trainer',
    secretKey: TEST_KEY,
    testMode: 'true',
    now: function () { return nowMs; },
    waitMs: 0,
    waitForMs: 1000
  });
  assert.deepStrictEqual(replaced, ['cs_old_plan']);
  assert.strictEqual(switchedPlan.body.url, 'https://checkout.stripe.com/c/pay/cs_test_session1');
  assert.ok(names(switchDb.calls).indexOf('checkout_claim_release') !== -1);

  const waitingDb = dbMock({
    profile: { access_approved: true, billing_status: null, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 1,
    claim: { granted: false, plan: 'enthusiast' }
  });
  await assert.rejects(function () {
    return checkout.createCheckoutSession({
      stripe: stripeMock(),
      db: waitingDb,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true',
      waitMs: 0,
      waitForMs: 0
    });
  }, function (err) {
    assert.strictEqual(err.status, 409);
    assert.strictEqual(err.message, 'Checkout is starting, try again in a moment.');
    return true;
  });

  const failedCreate = dbMock({
    profile: { access_approved: true, billing_status: null, beta_locked: false, stripe_customer_id: 'cus_Existing1' },
    betaCount: 1
  });
  const failedStripe = stripeMock();
  failedStripe.checkout.sessions.create = async function () {
    throw new Error('stripe unavailable');
  };
  await assert.rejects(function () {
    return checkout.createCheckoutSession({
      stripe: failedStripe,
      db: failedCreate,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true',
      now: function () { return nowMs; }
    });
  }, /could not be started/);
  assert.ok(names(failedCreate.calls).indexOf('checkout_claim_release') !== -1);

  const cors = await import(path.join(shared, 'billing-cors.mjs'));
  assert.strictEqual(cors.allowedOrigin('https://coachtrainerapp.com'), 'https://coachtrainerapp.com');
  assert.strictEqual(cors.allowedOrigin('http://localhost:8787'), 'http://localhost:8787');
  assert.strictEqual(cors.allowedOrigin('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.strictEqual(cors.allowedOrigin('https://evil.example'), null);
  assert.strictEqual(cors.allowedOrigin('http://localhost.evil'), null);
  const okHeaders = cors.corsHeaders('http://localhost:8787');
  assert.strictEqual(okHeaders.vary, 'Origin');
  assert.strictEqual(okHeaders['access-control-allow-origin'], 'http://localhost:8787');
  const blocked = cors.corsHeaders('https://evil.example');
  assert.strictEqual(blocked.vary, 'Origin');
  assert.strictEqual(blocked['access-control-allow-origin'], undefined);
  const preflight = cors.preflightResponse('https://coachtrainerapp.com');
  assert.strictEqual(preflight.status, 204);
  assert.strictEqual(preflight.headers.get('access-control-allow-origin'), 'https://coachtrainerapp.com');
  assert.strictEqual(preflight.headers.get('vary'), 'Origin');
  const denied = cors.preflightResponse('https://evil.example');
  assert.strictEqual(denied.status, 403);
  assert.strictEqual(denied.headers.get('access-control-allow-origin'), null);
  const wrapped = cors.applyCors(
    new Request('https://coachtrainerapp.com/fn', { headers: { origin: 'https://coachtrainerapp.com' } }),
    new Response(JSON.stringify({ error: 'Nope' }), { status: 403, headers: { 'content-type': 'application/json' } })
  );
  assert.strictEqual(wrapped.status, 403);
  assert.strictEqual(wrapped.headers.get('access-control-allow-origin'), 'https://coachtrainerapp.com');
  assert.strictEqual(wrapped.headers.get('vary'), 'Origin');

  const checkoutSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/create-checkout-session/index.ts'), 'utf8');
  const portalSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/create-portal-session/index.ts'), 'utf8');
  const webhookSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/stripe-webhook/index.ts'), 'utf8');
  const envSrc = fs.readFileSync(path.join(shared, 'stripe-env.ts'), 'utf8');
  assert.ok(checkoutSrc.indexOf("cors: 'disabled'") !== -1);
  assert.ok(portalSrc.indexOf("cors: 'disabled'") !== -1);
  assert.ok(webhookSrc.indexOf("cors: 'disabled'") !== -1);
  assert.ok(webhookSrc.indexOf('stripe_customer_id') !== -1);
  assert.ok(checkoutSrc.indexOf('billing-cors.mjs') !== -1);
  assert.ok(portalSrc.indexOf('billing-cors.mjs') !== -1);
  assert.ok(webhookSrc.indexOf('billing-cors.mjs') === -1);
  assert.ok(envSrc.indexOf('SUPABASE_ANON_KEY') !== -1);
  assert.ok(envSrc.indexOf('SUPABASE_PUBLISHABLE_KEY') !== -1);

  const tree = path.join(__dirname, '..', 'supabase/functions');
  const files = [];
  (function walk(dir) {
    fs.readdirSync(dir).forEach(function (name) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(mjs|ts|md|toml)$/.test(name) || name.indexOf('README') === 0) files.push(full);
    });
  })(tree);
  const config = fs.readFileSync(path.join(__dirname, '..', 'supabase/config.toml'), 'utf8');
  files.push(path.join(__dirname, '..', 'supabase/config.toml'));
  files.forEach(function (file) {
    const text = file.endsWith('config.toml') ? config : fs.readFileSync(file, 'utf8');
    assert.ok(!/sk_live_[A-Za-z0-9]/.test(text), file);
    assert.ok(!/sk_test_[A-Za-z0-9]/.test(text), file);
    assert.ok(!/rk_(live|test)_[A-Za-z0-9]/.test(text), file);
    assert.ok(!/whsec_[A-Za-z0-9]/.test(text), file);
  });
  assert.ok(config.indexOf('[functions.stripe-webhook]') !== -1);
  assert.ok(/\[functions\.stripe-webhook\][\s\S]*verify_jwt = false/.test(config));
  assert.ok(/\[functions\.create-checkout-session\][\s\S]*verify_jwt = true/.test(config));
  assert.ok(/\[functions\.change-subscription\][\s\S]*verify_jwt = true/.test(config));
  const changeSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/change-subscription/index.ts'), 'utf8');
  const portalMjs = fs.readFileSync(path.join(shared, 'billing-portal.mjs'), 'utf8');
  assert.ok(changeSrc.indexOf("cors: 'disabled'") !== -1);
  assert.ok(changeSrc.indexOf('planFromBody') !== -1);
  assert.ok(changeSrc.indexOf('stripe_customer_id') !== -1);
  assert.ok(!/body\.customer/.test(changeSrc));
  assert.ok(portalSrc.indexOf('STRIPE_PORTAL') === -1);
  assert.ok(portalMjs.indexOf('portalBeta') === -1);
  assert.ok(!/params\.configuration/.test(portalMjs));

  const TOKEN = '11111111-1111-4111-8111-111111111111';
  function subOn(plan, tier, status) {
    return {
      id: 'sub_payer001',
      status: status || 'active',
      customer: 'cus_Existing1',
      items: {
        data: [{
          id: 'si_current',
          quantity: 1,
          price: { id: 'price_current_' + plan, lookup_key: plan + '_' + (tier || 'beta') + '_monthly' }
        }]
      }
    };
  }
  function changeStripe(list, update) {
    const calls = [];
    return {
      calls: calls,
      prices: {
        list: async function (params) {
          calls.push(['prices.list', params]);
          const key = params.lookup_keys[0];
          return { data: [{ id: 'price_from_' + key, lookup_key: key }] };
        },
        retrieve: async function (id) {
          calls.push(['prices.retrieve', id]);
          return { id: id, lookup_key: String(id || '').replace(/^price_from_/, '') };
        }
      },
      invoices: {
        retrieve: async function (id, params) {
          calls.push(['invoices.retrieve', id, params]);
          return { id: id };
        }
      },
      subscriptions: {
        list: async function (params) {
          calls.push(['subscriptions.list', params]);
          return { data: list || [] };
        },
        update: update || async function (id, params, opts) {
          calls.push(['subscriptions.update', id, params, opts]);
          return {
            id: id,
            status: 'active',
            customer: 'cus_Existing1',
            pending_update: null,
            items: { data: [{ id: params.items[0].id, price: { id: params.items[0].price }, current_period_end: 1798329600 }] }
          };
        }
      },
      refunds: {
        create: async function (params) {
          calls.push(['refunds.create', params]);
          return { id: 're_should_not' };
        }
      }
    };
  }
  function changeDb(profile, extra) {
    extra = extra || {};
    return dbMock(Object.assign({
      profile: profile,
      claim: extra.claim || { granted: true, token: TOKEN }
    }, extra));
  }
  const payer = {
    id: USER,
    access_approved: true,
    complimentary: false,
    beta_locked: true,
    stripe_customer_id: 'cus_Existing1'
  };

  const betaSwitch = changeStripe([subOn('trainer', 'beta')]);
  const betaDb = changeDb(payer);
  const upgradedPlan = await change.changeSubscription({
    stripe: betaSwitch,
    db: betaDb,
    userId: USER,
    plan: 'master_trainer',
    customer: 'cus_evil',
    secretKey: TEST_KEY,
    testMode: 'true'
  });
  assert.deepStrictEqual(upgradedPlan.body, { status: 'ok' });
  assert.strictEqual(betaSwitch.calls[0][0], 'subscriptions.list');
  assert.strictEqual(betaSwitch.calls[0][1].customer, 'cus_Existing1');
  assert.ok(JSON.stringify(betaSwitch.calls).indexOf('cus_evil') === -1);
  assert.deepStrictEqual(betaSwitch.calls[1][1].lookup_keys, ['master_trainer_beta_monthly']);
  const update = betaSwitch.calls.filter(function (row) { return row[0] === 'subscriptions.update'; })[0];
  assert.strictEqual(update[1], 'sub_payer001');
  assert.strictEqual(update[2].proration_behavior, 'always_invoice');
  assert.strictEqual(update[2].payment_behavior, 'pending_if_incomplete');
  assert.deepStrictEqual(update[2].expand, ['latest_invoice.confirmation_secret']);
  assert.deepStrictEqual(update[2].items, [{ id: 'si_current', price: 'price_from_master_trainer_beta_monthly', quantity: 1 }]);
  assert.strictEqual(update[3].idempotencyKey, 'change-' + USER + '-' + TOKEN);
  assert.ok(names(betaSwitch.calls).indexOf('refunds.create') === -1);
  assert.ok(names(betaDb.calls).indexOf('beta_paid_count') === -1);
  assert.ok(names(betaDb.calls).indexOf('checkout_claim_release') !== -1);

  const standardSwitch = changeStripe([subOn('trainer', 'standard')]);
  await change.changeSubscription({
    stripe: standardSwitch,
    db: changeDb(Object.assign({}, payer, { beta_locked: false })),
    userId: USER,
    plan: 'enthusiast',
    secretKey: TEST_KEY,
    testMode: 'true'
  });
  assert.deepStrictEqual(standardSwitch.calls[1][1].lookup_keys, ['enthusiast_standard_monthly']);
  assert.strictEqual(standardSwitch.calls[2][2].proration_behavior, 'always_invoice');
  assert.strictEqual(standardSwitch.calls[2][2].payment_behavior, 'pending_if_incomplete');
  assert.ok(names(standardSwitch.calls).indexOf('refunds.create') === -1);

  const sameDb = changeDb(payer);
  const sameStripe = changeStripe([subOn('trainer', 'beta')]);
  await assert.rejects(function () {
    return change.changeSubscription({
      stripe: sameStripe,
      db: sameDb,
      userId: USER,
      plan: 'trainer',
      secretKey: TEST_KEY,
      testMode: 'true'
    });
  }, function (err) {
    assert.strictEqual(err.status, 409);
    assert.strictEqual(err.message, 'You are already on that plan.');
    return true;
  });
  assert.ok(names(sameStripe.calls).indexOf('subscriptions.update') === -1);
  assert.ok(names(sameDb.calls).indexOf('checkout_claim') === -1);

  const noneStripe = changeStripe([]);
  await assert.rejects(function () {
    return change.changeSubscription({
      stripe: noneStripe,
      db: changeDb(payer),
      userId: USER,
      plan: 'trainer',
      secretKey: TEST_KEY,
      testMode: 'true'
    });
  }, function (err) {
    assert.strictEqual(err.status, 409);
    assert.strictEqual(err.message, 'Subscribe to a plan before switching.');
    return true;
  });
  assert.deepStrictEqual(names(noneStripe.calls), ['subscriptions.list']);

  const canceledStripe = changeStripe([Object.assign(subOn('trainer', 'beta'), { status: 'canceled', id: 'sub_old' })]);
  await assert.rejects(function () {
    return change.changeSubscription({
      stripe: canceledStripe,
      db: changeDb(payer),
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true'
    });
  }, function (err) {
    assert.strictEqual(err.status, 409);
    assert.ok(/Subscribe/.test(err.message));
    return true;
  });

  const noCustomer = changeDb(Object.assign({}, payer, { stripe_customer_id: null }));
  const noCustomerStripe = changeStripe([subOn('trainer', 'beta')]);
  await assert.rejects(function () {
    return change.changeSubscription({
      stripe: noCustomerStripe,
      db: noCustomer,
      userId: USER,
      plan: 'enthusiast',
      customer: 'cus_evil',
      secretKey: TEST_KEY,
      testMode: 'true'
    });
  }, function (err) {
    assert.strictEqual(err.status, 409);
    assert.strictEqual(err.message, 'Subscribe to a plan before switching.');
    return true;
  });
  assert.deepStrictEqual(noCustomerStripe.calls, []);

  const failedPay = changeStripe([subOn('enthusiast', 'beta')], async function (id, params, opts) {
    failedPay.calls.push(['subscriptions.update', id, params, opts]);
    return {
      id: id,
      pending_update: { expires_at: 1 },
      latest_invoice: { payment_intent: { status: 'requires_payment_method' }, hosted_invoice_url: 'https://invoice.stripe.com/i/failed' }
    };
  });
  const failedResult = await change.changeSubscription({
    stripe: failedPay,
    db: changeDb(Object.assign({}, payer, { beta_locked: true })),
    userId: USER,
    plan: 'trainer',
    secretKey: TEST_KEY,
    testMode: 'true'
  });
  assert.deepStrictEqual(failedResult.body, { status: 'payment_failed' });
  assert.strictEqual(failedPay.calls.filter(function (row) { return row[0] === 'subscriptions.update'; })[0][2].payment_behavior, 'pending_if_incomplete');

  const actionPay = changeStripe([subOn('trainer', 'beta')], async function (id, params, opts) {
    actionPay.calls.push(['subscriptions.update', id, params, opts]);
    return {
      id: id,
      pending_update: { expires_at: 1 },
      latest_invoice: {
        payment_intent: { status: 'requires_action' },
        hosted_invoice_url: 'https://invoice.stripe.com/i/confirm'
      }
    };
  });
  const actionResult = await change.changeSubscription({
    stripe: actionPay,
    db: changeDb(payer),
    userId: USER,
    plan: 'master_trainer',
    secretKey: TEST_KEY,
    testMode: 'true'
  });
  assert.deepStrictEqual(actionResult.body, { status: 'requires_action', url: 'https://invoice.stripe.com/i/confirm' });

  const scaPay = changeStripe([subOn('trainer', 'beta')], async function (id, params, opts) {
    scaPay.calls.push(['subscriptions.update', id, params, opts]);
    return {
      id: id,
      status: 'active',
      pending_update: { expires_at: 1 },
      latest_invoice: {
        id: 'in_sca',
        status: 'open',
        confirmation_secret: { type: 'payment_intent', client_secret: 'pi_sca_secret' }
      }
    };
  });
  scaPay.invoices.retrieve = async function (id, params) {
    scaPay.calls.push(['invoices.retrieve', id, params]);
    return {
      id: id,
      hosted_invoice_url: 'https://invoice.stripe.com/i/confirm',
      payments: { data: [{ payment: { payment_intent: { status: 'requires_action' } } }] }
    };
  };
  const scaDb = changeDb(payer);
  const scaResult = await change.changeSubscription({
    stripe: scaPay,
    db: scaDb,
    userId: USER,
    plan: 'master_trainer',
    secretKey: TEST_KEY,
    testMode: 'true'
  });
  assert.deepStrictEqual(scaResult.body, { status: 'requires_action', url: 'https://invoice.stripe.com/i/confirm' });
  const scaRetrieve = scaPay.calls.filter(function (row) { return row[0] === 'invoices.retrieve'; })[0];
  assert.strictEqual(scaRetrieve[1], 'in_sca');
  assert.deepStrictEqual(scaRetrieve[2].expand, ['payments.data.payment.payment_intent']);
  assert.ok(names(scaDb.calls).indexOf('billing_write') === -1);
  const expandPaths = [];
  scaPay.calls.forEach(function (row) {
    for (let i = 1; i < row.length; i++) {
      const expand = row[i] && row[i].expand;
      if (!expand) continue;
      (Array.isArray(expand) ? expand : [expand]).forEach(function (path) {
        expandPaths.push(String(path));
      });
    }
  });
  assert.ok(expandPaths.length >= 2);
  expandPaths.forEach(function (path) {
    assert.ok(path.split('.').length <= 4, path);
  });
  assert.ok(expandPaths.indexOf('latest_invoice.payments.data.payment.payment_intent') === -1);

  const declinePay = changeStripe([subOn('enthusiast', 'beta')], async function (id, params, opts) {
    declinePay.calls.push(['subscriptions.update', id, params, opts]);
    return {
      id: id,
      status: 'active',
      pending_update: { expires_at: 1 },
      latest_invoice: {
        id: 'in_decline',
        status: 'open',
        hosted_invoice_url: 'https://invoice.stripe.com/i/failed',
        confirmation_secret: { type: 'payment_intent', client_secret: 'pi_decline_secret' }
      }
    };
  });
  declinePay.invoices.retrieve = async function (id, params) {
    declinePay.calls.push(['invoices.retrieve', id, params]);
    return {
      id: id,
      status: 'open',
      hosted_invoice_url: 'https://invoice.stripe.com/i/failed',
      confirmation_secret: { type: 'payment_intent', client_secret: 'pi_decline_secret' },
      payments: {
        data: [{
          payment: {
            payment_intent: {
              status: 'requires_payment_method',
              last_payment_error: { code: 'card_declined' }
            }
          }
        }]
      }
    };
  };
  const declineDb = changeDb(payer);
  const declineResult = await change.changeSubscription({
    stripe: declinePay,
    db: declineDb,
    userId: USER,
    plan: 'trainer',
    secretKey: TEST_KEY,
    testMode: 'true'
  });
  assert.deepStrictEqual(declineResult.body, { status: 'payment_failed' });
  assert.strictEqual(declinePay.calls.filter(function (row) { return row[0] === 'invoices.retrieve'; })[0][1], 'in_decline');
  assert.ok(names(declineDb.calls).indexOf('billing_write') === -1);
  declinePay.calls.forEach(function (row) {
    for (let i = 1; i < row.length; i++) {
      const expand = row[i] && row[i].expand;
      if (!expand) continue;
      (Array.isArray(expand) ? expand : [expand]).forEach(function (path) {
        assert.ok(String(path).split('.').length <= 4, path);
      });
    }
  });

  const syncedDb = changeDb(payer);
  const syncedStripe = changeStripe([subOn('trainer', 'beta')], async function (id, params, opts) {
    syncedStripe.calls.push(['subscriptions.update', id, params, opts]);
    return {
      id: id,
      status: 'active',
      customer: 'cus_Existing1',
      pending_update: null,
      latest_invoice: {
        id: 'in_paid',
        status: 'paid',
        confirmation_secret: { type: 'payment_intent', client_secret: 'pi_paid_secret' },
        payments: { data: [{ payment: { payment_intent: { status: 'succeeded' } } }] }
      },
      items: {
        data: [{
          id: 'si_current',
          current_period_end: 1798329600,
          price: {
            id: 'price_future',
            lookup_key: 'trainer_standard_monthly_2027',
            product: { id: 'prod_mt', metadata: { plan: 'master_trainer' } }
          }
        }]
      }
    };
  });
  const synced = await change.changeSubscription({
    stripe: syncedStripe,
    db: syncedDb,
    userId: USER,
    plan: 'master_trainer',
    secretKey: TEST_KEY,
    testMode: 'true'
  });
  assert.strictEqual(synced.body.status, 'ok');
  assert.ok(names(syncedStripe.calls).indexOf('invoices.retrieve') === -1);
  const syncedWrite = syncedDb.calls.filter(function (row) { return row[0] === 'billing_write'; })[0][1];
  assert.strictEqual(syncedWrite.p_action, 'sync');
  assert.strictEqual(syncedWrite.p_plan, 'master_trainer');
  assert.strictEqual(syncedWrite.p_billing_status, 'active');
  assert.strictEqual(syncedWrite.p_profile, USER);
  assert.ok(!Object.prototype.hasOwnProperty.call(syncedWrite, 'p_beta'));

  const busy = changeDb(payer, { claim: { granted: false, plan: 'trainer' } });
  const busyStripe = changeStripe([subOn('trainer', 'beta')]);
  await assert.rejects(function () {
    return change.changeSubscription({
      stripe: busyStripe,
      db: busy,
      userId: USER,
      plan: 'enthusiast',
      secretKey: TEST_KEY,
      testMode: 'true'
    });
  }, function (err) {
    assert.strictEqual(err.status, 409);
    assert.strictEqual(err.message, 'That plan change is already in progress.');
    return true;
  });
  assert.ok(names(busyStripe.calls).indexOf('subscriptions.update') === -1);

  const productStripe = stripeMock();
  productStripe.products = {
    retrieve: async function (id) {
      productStripe.calls.push(['products.retrieve', id]);
      return { id: id, metadata: { plan: 'trainer' } };
    }
  };
  const mapped = eventDb();
  await webhook.handleWebhook({
    stripe: productStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_product_plan',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_payer001',
            customer: 'cus_Existing1',
            status: 'active',
            metadata: { supabase_user_id: USER },
            items: {
              data: [{
                price: { id: 'price_future', lookup_key: 'trainer_standard_monthly_2027', product: 'prod_trainer' },
                current_period_end: 1798329600
              }]
            }
          }
        }
      };
    },
    db: mapped
  });
  assert.deepStrictEqual(productStripe.calls[0], ['products.retrieve', 'prod_trainer']);
  const mappedSync = mapped.calls.filter(function (row) { return row[0] === 'billing_write'; })[0][1];
  assert.strictEqual(mappedSync.p_action, 'sync');
  assert.strictEqual(mappedSync.p_plan, 'trainer');
  assert.ok(!Object.prototype.hasOwnProperty.call(mappedSync, 'p_beta'));

  const productWins = eventDb();
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_product_wins',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_payer001',
            customer: 'cus_Existing1',
            status: 'active',
            items: {
              data: [{
                price: {
                  id: 'price_meta',
                  lookup_key: 'enthusiast_beta_monthly',
                  product: { id: 'prod_mt', metadata: { plan: 'master_trainer' } }
                },
                current_period_end: 1798329600
              }]
            }
          }
        }
      };
    },
    db: productWins
  });
  const won = productWins.calls.filter(function (row) { return row[0] === 'billing_write'; })[0][1];
  assert.strictEqual(won.p_plan, 'master_trainer');
  assert.ok(!Object.prototype.hasOwnProperty.call(won, 'p_beta'));

  const pending = eventDb();
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_pending',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_payer001',
            customer: 'cus_Existing1',
            status: 'active',
            pending_update: {
              subscription_items: [{ price: { id: 'price_new', lookup_key: 'master_trainer_beta_monthly' } }]
            },
            items: { data: [{ price: { id: 'price_old', lookup_key: 'enthusiast_beta_monthly' }, current_period_end: 1798329600 }] }
          }
        }
      };
    },
    db: pending
  });
  const heldPlan = pending.calls.filter(function (row) { return row[0] === 'billing_write'; })[0][1];
  assert.strictEqual(heldPlan.p_plan, null);

  const expired = eventDb();
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_pending_expired',
        type: 'customer.subscription.pending_update_expired',
        data: {
          object: {
            id: 'sub_payer001',
            customer: 'cus_Existing1',
            status: 'active',
            items: { data: [{ price: { id: 'price_new', lookup_key: 'master_trainer_beta_monthly' }, current_period_end: 1798329600 }] }
          }
        }
      };
    },
    db: expired
  });
  assert.ok(names(expired.calls).indexOf('billing_write') === -1);
  assert.ok(names(expired.calls).indexOf('apply_stripe_membership') === -1);

  const granted = eventDb();
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_grant_product',
        type: 'invoice.paid',
        data: {
          object: {
            customer: 'cus_Existing1',
            parent: { subscription_details: { subscription: 'sub_payer001', metadata: { user_id: USER } } },
            lines: {
              data: [{
                amount: 1999,
                proration: false,
                type: 'subscription',
                period: { end: Date.parse('2027-02-01T00:00:00Z') / 1000 },
                pricing: {
                  price_details: {
                    price: {
                      id: 'price_future_beta',
                      lookup_key: 'trainer_beta_monthly',
                      product: { id: 'prod_trainer', metadata: { plan: 'trainer' } }
                    }
                  }
                }
              }]
            }
          }
        }
      };
    },
    db: granted
  });
  const grantedCall = granted.calls.filter(function (row) { return row[0] === 'billing_write'; })[0][1];
  assert.strictEqual(grantedCall.p_action, 'grant');
  assert.strictEqual(grantedCall.p_plan, 'trainer');
  assert.strictEqual(grantedCall.p_beta, true);

  const heldUpgrade = eventDb();
  const activeFailStripe = stripeMock();
  activeFailStripe.subscriptions.retrieve = async function (id) {
    activeFailStripe.calls.push(['subscriptions.retrieve', id]);
    return { id: id, status: 'active' };
  };
  await webhook.handleWebhook({
    stripe: activeFailStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_update_fail_active',
        type: 'invoice.payment_failed',
        data: {
          object: {
            customer: 'cus_Existing1',
            billing_reason: 'subscription_update',
            parent: { subscription_details: { subscription: 'sub_payer001', metadata: { user_id: USER } } }
          }
        }
      };
    },
    db: heldUpgrade
  });
  assert.deepStrictEqual(activeFailStripe.calls[0], ['subscriptions.retrieve', 'sub_payer001']);
  assert.ok(names(heldUpgrade.calls).indexOf('apply_stripe_membership') === -1);
  assert.ok(activeFailStripe.calls.filter(function (row) { return row[0] === 'subscriptions.cancel'; }).length === 0);

  const realPastDue = eventDb();
  const pastStripe = stripeMock();
  pastStripe.subscriptions.retrieve = async function (id) {
    pastStripe.calls.push(['subscriptions.retrieve', id]);
    return { id: id, status: 'past_due' };
  };
  await webhook.handleWebhook({
    stripe: pastStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_update_fail_due',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_update_due',
            customer: 'cus_Existing1',
            billing_reason: 'subscription_update',
            parent: { subscription_details: { subscription: 'sub_payer001', metadata: { user_id: USER } } }
          }
        }
      };
    },
    db: realPastDue
  });
  const dueCall = realPastDue.calls.filter(function (row) { return row[0] === 'apply_stripe_membership'; })[0][1];
  assert.strictEqual(dueCall.p_action, 'end');
  assert.strictEqual(dueCall.p_period_end, null);
  assert.ok(pastStripe.calls.some(function (row) {
    return row[0] === 'subscriptions.cancel' && row[1] === 'sub_payer001' && row[2].prorate === false && row[2].invoice_now === false;
  }));

  const reportedDue = eventDb();
  const reportedStripe = stripeMock();
  reportedStripe.subscriptions.retrieve = async function (id) {
    reportedStripe.calls.push(['subscriptions.retrieve', id]);
    return { id: id, status: 'past_due' };
  };
  await webhook.handleWebhook({
    stripe: reportedStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_status_due',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_payer001',
            customer: 'cus_Existing1',
            status: 'past_due',
            metadata: { user_id: USER },
            items: { data: [{ price: { id: 'price_current', lookup_key: 'trainer_beta_monthly' }, current_period_end: 1798329600 }] }
          }
        }
      };
    },
    db: reportedDue
  });
  const reportedEnd = reportedDue.calls.filter(function (row) { return row[0] === 'apply_stripe_membership'; })[0][1];
  assert.strictEqual(reportedEnd.p_action, 'end');
  assert.strictEqual(reportedEnd.p_period_end, null);
  assert.ok(names(reportedDue.calls).indexOf('billing_write') === -1);
  assert.ok(reportedStripe.calls.some(function (row) { return row[0] === 'subscriptions.cancel' && row[1] === 'sub_payer001'; }));

  const staleUpdated = eventDb();
  const staleUpdatedStripe = stripeMock();
  await webhook.handleWebhook({
    stripe: staleUpdatedStripe,
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_status_recovered',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_payer001',
            customer: 'cus_Existing1',
            status: 'past_due',
            metadata: { user_id: USER },
            items: { data: [{ price: { id: 'price_current', lookup_key: 'trainer_beta_monthly' }, current_period_end: 1798329600 }] }
          }
        }
      };
    },
    db: staleUpdated
  });
  assert.ok(names(staleUpdated.calls).indexOf('apply_stripe_membership') === -1);
  assert.ok(names(staleUpdated.calls).indexOf('billing_write') === -1);
  assert.ok(staleUpdatedStripe.calls.filter(function (row) { return row[0] === 'subscriptions.cancel'; }).length === 0);

  const webhookBody = fs.readFileSync(path.join(shared, 'billing-webhook.mjs'), 'utf8');
  assert.ok(webhookBody.indexOf('TODO(email): Send the end-of-plan email once an email service is chosen.') !== -1);
  assert.ok(webhookBody.indexOf("your plan ended; we'll keep your data for 2 weeks so you can rejoin.") !== -1);
  assert.ok(!/pm_card_|tok_visa|card\[number\]/.test(webhookBody));

  console.log('stripe functions ok');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
