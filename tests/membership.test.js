// Membership rules without a network: node tests/membership.test.js
const assert = require('assert');
const Mem = require('../membership.js');

const byId = {};
Mem.TIERS.forEach(function (t) { byId[t.id] = t; });
assert.deepStrictEqual(Object.keys(byId).sort(), ['enthusiast', 'free_client', 'master_trainer', 'trainer']);

assert.strictEqual(byId.free_client.name, 'Free Client');
assert.strictEqual(byId.free_client.priceLabel, 'Free');
assert.strictEqual(byId.free_client.priceCents, 0);
assert.strictEqual(byId.free_client.inviteOnly, true);
assert.strictEqual(byId.free_client.paysInApp, false);
assert.strictEqual(byId.free_client.value, 'Train with your coach.');
assert.deepStrictEqual(byId.free_client.available, ['Run the workouts your trainer sends you']);
assert.ok(byId.free_client.comingSoon.indexOf('Message your trainer') >= 0);
assert.strictEqual(byId.free_client.cta, 'Join with an invite from your trainer');
assert.strictEqual(byId.free_client.recommended, false);
assert.strictEqual(Mem.canSelectIntended('free_client'), false);

assert.strictEqual(byId.enthusiast.name, 'Enthusiast');
assert.strictEqual(byId.enthusiast.priceLabel, '$6.99');
assert.strictEqual(byId.enthusiast.priceCents, 699);
assert.strictEqual(byId.enthusiast.workoutCap, 6);
assert.strictEqual(byId.enthusiast.clientCap, null);
assert.strictEqual(byId.enthusiast.value, 'Build your own training, and still work with a coach if you have one.');
assert.strictEqual(byId.enthusiast.available.length, 3);
assert.strictEqual(byId.enthusiast.cta, 'Choose Enthusiast');
assert.strictEqual(Mem.priceLine(byId.enthusiast), '$6.99 / month');
assert.strictEqual(Mem.canSelectIntended('enthusiast'), true);

assert.strictEqual(byId.trainer.name, 'Trainer');
assert.strictEqual(byId.trainer.priceLabel, '$14.99');
assert.strictEqual(byId.trainer.priceCents, 1499);
assert.strictEqual(byId.trainer.clientCap, 15);
assert.strictEqual(byId.trainer.recommended, true);
assert.strictEqual(byId.trainer.value, 'Coach your clients from workout to tracking.');
assert.strictEqual(byId.trainer.cta, 'Choose Trainer');
assert.ok(byId.trainer.comingSoon.indexOf('Send workouts to your clients') >= 0);
byId.trainer.comingSoon.forEach(function (line) { assert.strictEqual(byId.trainer.available.indexOf(line), -1); });
assert.strictEqual(Mem.canSelectIntended('trainer'), true);

assert.strictEqual(byId.master_trainer.name, 'Master Trainer');
assert.strictEqual(byId.master_trainer.priceLabel, '$29.99');
assert.strictEqual(byId.master_trainer.priceCents, 2999);
assert.strictEqual(byId.master_trainer.clientCap, 30);
assert.strictEqual(byId.master_trainer.value, 'A larger roster, with a verified credential.');
assert.strictEqual(byId.master_trainer.cta, 'Choose Master Trainer');
assert.strictEqual(byId.master_trainer.recommended, false);
assert.strictEqual(Mem.priceLine(byId.master_trainer), '$29.99 / month');
assert.strictEqual(Mem.canSelectIntended('master_trainer'), true);

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

console.log('MEMBERSHIP OK');
