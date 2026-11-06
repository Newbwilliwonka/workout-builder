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
assert.strictEqual(Mem.canSelectIntended('free_client'), false);

assert.strictEqual(byId.enthusiast.name, 'Enthusiast');
assert.strictEqual(byId.enthusiast.priceLabel, '$6.99');
assert.strictEqual(byId.enthusiast.priceCents, 699);
assert.strictEqual(byId.enthusiast.workoutCap, 6);
assert.strictEqual(byId.enthusiast.clientCap, null);
assert.strictEqual(Mem.canSelectIntended('enthusiast'), true);

assert.strictEqual(byId.trainer.name, 'Trainer');
assert.strictEqual(byId.trainer.priceLabel, '$14.99');
assert.strictEqual(byId.trainer.priceCents, 1499);
assert.strictEqual(byId.trainer.clientCap, 15);
assert.strictEqual(Mem.canSelectIntended('trainer'), true);

assert.strictEqual(byId.master_trainer.name, 'Master Trainer');
assert.strictEqual(byId.master_trainer.priceLabel, '$29.99');
assert.strictEqual(byId.master_trainer.priceCents, 2999);
assert.strictEqual(byId.master_trainer.clientCap, 30);
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

console.log('MEMBERSHIP OK');
