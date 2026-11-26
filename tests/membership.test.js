// Membership rules without a network: node tests/membership.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Mem = require('../membership.js');

const byId = {};
Mem.TIERS.forEach(function (t) { byId[t.id] = t; });
assert.deepStrictEqual(Object.keys(byId).sort(), ['enthusiast', 'free_client', 'master_trainer', 'trainer']);

assert.strictEqual(byId.free_client.name, 'Free Client');
assert.strictEqual(byId.free_client.priceLabel, 'Free');
assert.strictEqual(byId.free_client.priceCents, 0);
assert.strictEqual(byId.free_client.inviteOnly, true);
assert.strictEqual(byId.free_client.paysInApp, false);
assert.strictEqual(byId.free_client.value, 'Join with an invite from your trainer.');
assert.deepStrictEqual(byId.free_client.available, [
  'Get personalized workouts and programs from your trainer',
  'Run your sessions from your program calendar, solo or with your trainer',
  'Message your trainer',
  'Keep all your data if you switch trainers',
  'View your workout history',
  'Follow custom tracking dashboards set up by your trainer',
  'Find a trainer near you or online in the Trainer Hub, and send a message request',
  'Join the Trainer Hub forum'
]);
assert.deepStrictEqual(byId.free_client.comingSoon, []);
byId.free_client.available.forEach(function (line) {
  assert.strictEqual(byId.free_client.comingSoon.indexOf(line), -1);
});
assert.strictEqual(byId.free_client.cta, undefined);
assert.strictEqual(byId.free_client.available.indexOf(byId.free_client.value), -1);
assert.strictEqual(byId.free_client.recommended, false);
assert.strictEqual(Mem.canSelectIntended('free_client'), false);

assert.strictEqual(byId.enthusiast.name, 'Enthusiast');
assert.strictEqual(byId.enthusiast.priceLabel, '$9.99');
assert.strictEqual(byId.enthusiast.priceCents, 999);
assert.strictEqual(byId.enthusiast.oldPriceLabel, '$19.99');
assert.strictEqual(byId.enthusiast.oldPriceCents, 1999);
assert.strictEqual(byId.enthusiast.beta, true);
assert.strictEqual(byId.enthusiast.workoutCap, 6);
assert.strictEqual(byId.enthusiast.clientCap, null);
assert.strictEqual(byId.enthusiast.value, 'Build your own training, and still work with a coach if you have one.');
assert.strictEqual(byId.enthusiast.includes, 'Everything in the Free Client subscription, plus:');
assert.strictEqual(byId.enthusiast.available.indexOf(byId.enthusiast.includes), -1);
assert.deepStrictEqual(byId.enthusiast.available, [
  'Build workouts with sets and reps, intervals, timers, stopwatch, and supersets',
  'Create your own exercises, rename them, and add a photo',
  'Search 1,300+ exercises',
  'Save up to 6 of your own workouts',
  'Plan your training on a program calendar',
  'Track solo sessions and sessions with your trainer',
  'See your progress on a live tracking dashboard',
  'Share your workouts and tracking with your trainer',
  'Add a photo and bio to your profile',
  'Follow custom tracking dashboards from your trainer',
  'Find a trainer near you or online in the Trainer Hub, and send a message request',
  'Join the Trainer Hub forum'
]);
assert.deepStrictEqual(byId.enthusiast.comingSoon, []);
assert.strictEqual(byId.enthusiast.highlight, undefined);
assert.strictEqual(byId.enthusiast.cta, 'Choose Enthusiast');
assert.strictEqual(Mem.priceLine(byId.enthusiast), '$9.99 / month');
assert.strictEqual(Mem.canSelectIntended('enthusiast'), true);

assert.strictEqual(byId.trainer.name, 'Trainer');
assert.strictEqual(byId.trainer.priceLabel, '$19.99');
assert.strictEqual(byId.trainer.priceCents, 1999);
assert.strictEqual(byId.trainer.oldPriceLabel, '$39.99');
assert.strictEqual(byId.trainer.oldPriceCents, 3999);
assert.strictEqual(byId.trainer.beta, true);
assert.strictEqual(byId.trainer.clientCap, 15);
assert.strictEqual(byId.trainer.recommended, true);
assert.strictEqual(byId.trainer.value, 'Coach your clients from the workout to the calendar.');
assert.strictEqual(byId.trainer.cta, 'Choose Trainer');
assert.deepStrictEqual(byId.trainer.available, [
  'Build workouts with sets and reps, intervals, timers, stopwatch, and supersets',
  'Create your own exercises, rename them, and add a photo',
  'Search 1,300+ exercises',
  'Send workouts and programs to clients and enthusiasts',
  'Plan solo sessions and sessions you attend on a shared calendar',
  'Review the sessions an enthusiast shares with you',
  'Build and share custom tracking dashboards for each client',
  'Message your clients',
  'Invite up to 15 clients and enthusiasts',
  'Keep your workouts if either of you ends the connection',
  'Add a photo, bio, and a private service-location pin. Only your city and state are shown.',
  'Get found in Trainer Hub search for in-person training, online training, or both',
  'Accept message requests from new clients and enthusiasts',
  'Join the Trainer Hub forum'
]);
assert.deepStrictEqual(byId.trainer.comingSoon, []);
assert.strictEqual(byId.trainer.highlight, 'Get found in the Trainer Hub by clients who have trained with a coach');
byId.trainer.comingSoon.forEach(function (line) { assert.strictEqual(byId.trainer.available.indexOf(line), -1); });
assert.strictEqual(byId.trainer.available.indexOf(byId.trainer.highlight), -1);
assert.strictEqual(Mem.canSelectIntended('trainer'), true);
assert.strictEqual(Mem.priceLine(byId.trainer), '$19.99 / month');

assert.strictEqual(byId.master_trainer.name, 'Master Trainer');
assert.strictEqual(byId.master_trainer.priceLabel, '$29.99');
assert.strictEqual(byId.master_trainer.priceCents, 2999);
assert.strictEqual(byId.master_trainer.oldPriceLabel, '$59.99');
assert.strictEqual(byId.master_trainer.oldPriceCents, 5999);
assert.strictEqual(byId.master_trainer.beta, true);
assert.strictEqual(byId.master_trainer.clientCap, 30);
assert.strictEqual(byId.master_trainer.value, 'Coach a larger roster.');
assert.strictEqual(byId.master_trainer.cta, 'Choose Master Trainer');
assert.strictEqual(byId.master_trainer.includes, 'Everything in the Trainer subscription, plus:');
assert.strictEqual(byId.master_trainer.available.indexOf(byId.master_trainer.includes), -1);
assert.strictEqual(byId.master_trainer.comingSoon.indexOf(byId.master_trainer.includes), -1);
assert.deepStrictEqual(byId.master_trainer.available, [
  'Invite up to 30 clients and enthusiasts',
  'Show a verified certification on your profile',
  'Group circuit training with tracking'
]);
assert.deepStrictEqual(byId.master_trainer.comingSoon, []);
assert.strictEqual(byId.master_trainer.highlight, 'Get found in the Trainer Hub by clients who have trained with a coach');
assert.strictEqual(byId.master_trainer.recommended, false);
assert.strictEqual(Mem.priceLine(byId.master_trainer), '$29.99 / month');
assert.strictEqual(Mem.canSelectIntended('master_trainer'), true);

['enthusiast', 'trainer', 'master_trainer'].forEach(function (id) {
  var tier = byId[id];
  var seen = {};
  tier.available.concat(tier.comingSoon).forEach(function (line) {
    assert.ok(line && /^[A-Z]/.test(line), id + ' line starts plainly: ' + line);
    assert.strictEqual(seen[line], undefined, id + ' repeats: ' + line);
    seen[line] = true;
  });
  if (tier.highlight) {
    assert.strictEqual(seen[tier.highlight], undefined);
    assert.strictEqual(tier.comingSoon.indexOf(tier.highlight), -1);
  }
});
assert.ok(byId.master_trainer.available.indexOf('Invite up to 15 clients and enthusiasts') === -1);
assert.strictEqual(byId.free_client.beta, undefined);
assert.strictEqual(byId.free_client.oldPriceLabel, undefined);
assert.strictEqual(byId.free_client.includes, undefined);
assert.strictEqual(byId.trainer.includes, undefined);

assert.strictEqual(Mem.canSelectIntended('none'), false);
assert.strictEqual(Mem.canSelectIntended(''), false);

var picked = { membership: Mem.NONE, intended_plan: 'enthusiast' };
assert.deepStrictEqual(Mem.entitlements(picked), { active: false, tier: null, workoutCap: null, clientCap: null });
assert.strictEqual(Mem.isActive(picked, 'enthusiast'), false);

var paid = { membership: 'enthusiast', intended_plan: 'enthusiast' };
assert.strictEqual(Mem.entitlements(paid).active, true);
assert.strictEqual(Mem.entitlements(paid).workoutCap, 6);
assert.strictEqual(Mem.entitlements(paid).clientCap, null);

assert.strictEqual(Mem.entitlements({ membership: 'trainer' }).clientCap, 15);
assert.strictEqual(Mem.entitlements({ membership: 'master_trainer' }).clientCap, 30);
assert.strictEqual(Mem.entitlements({ membership: 'free_client' }).active, true);
assert.strictEqual(Mem.entitlements({ membership: 'free_client' }).workoutCap, null);
assert.strictEqual(Mem.entitlements({ membership: 'free_client' }).tier.inviteOnly, true);

assert.strictEqual(Mem.hasDesignated(null), false);
assert.strictEqual(Mem.hasDesignated({ membership: 'none', intended_plan: null }), false);
assert.strictEqual(Mem.hasDesignated({ membership: 'none', intended_plan: 'free_client' }), false);
assert.strictEqual(Mem.hasDesignated({ membership: 'none', intended_plan: 'enthusiast' }), true);
assert.strictEqual(Mem.hasDesignated({ membership: 'free_client', intended_plan: null }), true);
assert.strictEqual(Mem.hasDesignated({ membership: 'trainer' }), true);

assert.strictEqual(Mem.activePaidPlan(null), null);
assert.strictEqual(Mem.activePaidPlan({ membership: 'none', billing_status: 'active' }), null);
assert.strictEqual(Mem.activePaidPlan({ membership: 'free_client', billing_status: 'active' }), null);
assert.strictEqual(Mem.activePaidPlan({ membership: 'trainer' }), null);
assert.strictEqual(Mem.activePaidPlan({ membership: 'trainer', billing_status: null }), null);
assert.strictEqual(Mem.activePaidPlan({ membership: 'trainer', billing_status: 'canceled' }), null);
assert.strictEqual(Mem.activePaidPlan({ membership: 'trainer', billing_status: 'incomplete' }), null);
assert.strictEqual(Mem.activePaidPlan({ membership: 'trainer', billing_status: 'unpaid' }), null);
assert.strictEqual(Mem.activePaidPlan({ membership: 'enthusiast', billing_status: 'active' }), 'enthusiast');
assert.strictEqual(Mem.activePaidPlan({ membership: 'trainer', billing_status: 'past_due' }), 'trainer');
assert.strictEqual(Mem.activePaidPlan({ membership: 'master_trainer', billing_status: 'trialing' }), 'master_trainer');

// Card order lives in drawSubscriptions: highlight with the available list, then Coming soon.
(function () {
  var src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  var start = src.indexOf('function drawSubscriptions(');
  var end = src.indexOf('function renderSimpleAccount(');
  assert.ok(start > 0 && end > start);
  var body = src.slice(start, end);
  var listAt = body.indexOf('t.available.forEach');
  var hubAt = body.indexOf("'<div class=\"hub\">");
  var soonAt = body.indexOf('>Coming soon<');
  assert.ok(listAt > 0 && hubAt > listAt && soonAt > hubAt);
  assert.strictEqual(body.indexOf("if (t.inviteOnly) h += '<p class=\"invite\">'"), -1);
  var inviteOnlyAt = body.lastIndexOf('if (t.inviteOnly)');
  var inviteAt = body.indexOf("'<p class=\"invite\">'");
  assert.ok(inviteOnlyAt > soonAt && inviteAt > inviteOnlyAt);
  assert.ok(body.slice(inviteOnlyAt, inviteAt).indexOf('if (t.cta)') !== -1);
})();

console.log('MEMBERSHIP OK');
