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
          current_period_end: Date.parse('2027-03-01T00:00:00.000Z') / 1000,
          metadata: { supabase_user_id: USER },
          items: {
            data: [{
              price: { id: 'price_current', lookup_key: 'master_trainer_standard_monthly' },
              current_period_end: Date.parse('2027-03-01T00:00:00.000Z') / 1000
            }]
          }
        };
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
  await webhook.handleWebhook({
    stripe: stripeMock(),
    secretKey: TEST_KEY,
    testMode: 'true',
    webhookSecret: 'whsec_' + 'example',
    rawBody: '{}',
    signature: 'good',
    constructEvent: function () {
      return {
        id: 'evt_fail1',
        type: 'invoice.payment_failed',
        data: {
          object: {
            customer: 'cus_Existing1',
            parent: { subscription_details: { subscription: 'sub_payer001', metadata: { user_id: USER } } },
            lines: { data: [] }
          }
        }
      };
    },
    db: failed
  });
  const pastDue = failed.calls.filter(function (row) { return row[0] === 'apply_stripe_membership'; })[0][1];
  assert.strictEqual(pastDue.p_action, 'past_due');
  assert.ok(names(failed.calls).indexOf('beta_reservation_release') === -1);

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
  assert.strictEqual(portalStripe.calls[0][1].customer, 'cus_Existing1');
  assert.strictEqual(portalStripe.calls[0][1].configuration, 'bpc_beta');
  assert.strictEqual(portalStripe.calls[0][1].return_url, 'https://coachtrainerapp.com/#/account');

  const standardPortal = stripeMock();
  await portal.createPortalSession({
    stripe: standardPortal,
    secretKey: TEST_KEY,
    testMode: 'true',
    userId: USER,
    portalBeta: 'bpc_beta',
    portalStandard: 'bpc_standard',
    db: dbMock({ profile: { stripe_customer_id: 'cus_Existing1', beta_locked: false, access_approved: true } })
  });
  assert.strictEqual(standardPortal.calls[0][1].configuration, 'bpc_standard');

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
      return { data: [{ id: 'in_first', status: 'paid', created: 10, payment_intent: 'pi_first' }] };
    }
  };
  dupStripe.refunds = {
    create: async function (params) {
      refunds.push(params);
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
  assert.deepStrictEqual(refunds, [{ payment_intent: 'pi_first' }]);
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
  staleStripe.invoices = { list: async function () { return { data: [{ id: 'in_new', status: 'paid', created: 1, payment_intent: 'pi_new' }] }; } };
  staleStripe.refunds = { create: async function (params) { staleRefunds.push(params); return { id: 're_new' }; } };
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
  assert.deepStrictEqual(staleRefunds, [{ payment_intent: 'pi_new' }]);
  assert.strictEqual(stored.id, 'sub_older');

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

  console.log('stripe functions ok');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
