// Program permissions, scheduling, and completion. No browser, no database.
const assert = require('assert');
const P = require('../programs.js');
const M = require('../model.js');

assert.strictEqual(P.roleOf({ membership: 'master_trainer' }), 'master_trainer');
assert.strictEqual(P.roleOf({ membership: 'trainer' }), 'trainer');
assert.strictEqual(P.roleOf({ membership: 'none', intended_plan: 'trainer' }), 'trainer');
assert.strictEqual(P.roleOf({ membership: 'enthusiast', intended_plan: 'trainer' }), 'enthusiast');
assert.strictEqual(P.roleOf({ membership: 'free_client' }), 'free_client');
assert.strictEqual(P.roleOf(null), 'none');

assert.deepStrictEqual(P.buttons('free_client'), ['run', 'view']);
assert.deepStrictEqual(P.buttons('enthusiast'), ['run', 'view', 'open']);
assert.deepStrictEqual(P.buttons('none'), ['run', 'view', 'open']);
assert.deepStrictEqual(P.buttons('trainer'), ['run', 'view', 'open', 'send']);
assert.deepStrictEqual(P.buttons('master_trainer'), ['run', 'view', 'open', 'send']);
assert.ok(P.buttons('enthusiast').indexOf('send') < 0);

const self = 'me';
assert.strictEqual(P.canEdit({ role: 'enthusiast', self: self, ownerId: self }), true);
assert.strictEqual(P.canEdit({ role: 'free_client', self: self, ownerId: self }), false);
assert.strictEqual(P.canEdit({ role: 'none', self: self, ownerId: self }), true);
assert.strictEqual(P.canSee({ role: 'free_client', self: self, ownerId: self }), true);
assert.strictEqual(P.canEdit({ role: 'trainer', self: 't', ownerId: 'ada', ownerPlan: 'free_client', linked: true }), true);
assert.strictEqual(P.canEdit({ role: 'master_trainer', self: 'm', ownerId: 'ada', ownerPlan: 'free_client', linked: true }), true);
assert.strictEqual(P.canEdit({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: true }), true);
assert.strictEqual(P.canSee({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: true }), true);
assert.strictEqual(P.canEdit({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: false }), false);
assert.strictEqual(P.canSee({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: false }), false);
assert.strictEqual(P.canEdit({ role: 'trainer', self: 't', ownerId: 'ada', ownerPlan: 'free_client', linked: false }), false);
assert.strictEqual(P.canEdit({ role: 'enthusiast', self: self, ownerId: 'ada', ownerPlan: 'free_client', linked: true }), false);
assert.strictEqual(P.canEdit({ role: 'trainer', self: 't', ownerId: 't' }), false);

const placed = P.place([], {
  id: 'pg1', ownerId: self, workoutId: 'push', workoutName: 'Push', items: [{ name: 'Press' }], date: '2026-11-11', presence: 'solo'
});
assert.strictEqual(placed.created.presence, 'solo');
assert.strictEqual(placed.programs.length, 1);
const again = P.place(placed.programs, { id: 'pg2', ownerId: self, workoutId: 'push', date: '2026-11-11' });
assert.strictEqual(again.duplicate, true);
assert.strictEqual(again.programs.length, 1);
const moved = P.move(placed.programs, 'pg1', '2026-11-12');
assert.strictEqual(moved.moved.date, '2026-11-12');
const marked = P.setPresence(moved.programs, 'pg1', 'trainer');
assert.strictEqual(marked.changed.presence, 'trainer');

const entry = marked.programs[0];
const day = new Date(2026, 10, 12, 15, 0, 0).getTime();
assert.strictEqual(P.entryDone(entry, []), false);
assert.strictEqual(P.entryDone(entry, [{ workoutId: 'push', endedAt: day, results: [] }]), false);
assert.strictEqual(P.entryDone(entry, [{ workoutId: 'push', endedAt: day, results: [{ logged: true }] }]), true);
assert.strictEqual(P.entryDone(entry, [{ workoutId: 'other', programId: 'pg1', endedAt: day, results: [{ logged: true }] }]), true);
assert.strictEqual(P.entryDone(entry, [{ workoutId: 'push', endedAt: new Date(2026, 10, 13).getTime(), results: [{ logged: true }] }]), false);
assert.strictEqual(P.dayDone(marked.programs, [{ workoutId: 'push', endedAt: day, results: [{ logged: true }] }]), true);

const remote = P.merge(marked.programs, [{
  local_id: 'pg1', owner_id: self, workout_local_id: 'push', workout_name: 'Push', items: [], day: '2026-11-13', presence: 'solo', updated_at: new Date(Date.now() + 60000).toISOString()
}], self);
assert.strictEqual(remote[0].date, '2026-11-13');
assert.strictEqual(P.isUuid('11111111-1111-4111-8111-111111111111'), true);
assert.strictEqual(P.isUuid('allow-test'), false);

const stored = M.emptyData();
assert.ok(Array.isArray(stored.programs));
const mem = { s: {}, getItem: function (k) { return this.s[k] || null; }, setItem: function (k, v) { this.s[k] = v; } };
mem.setItem(M.STORAGE_KEY, JSON.stringify({ version: 1, workouts: stored.workouts }));
const loaded = M.load(mem);
assert.ok(Array.isArray(loaded.programs));
assert.strictEqual(loaded.programs.length, 0);

console.log('PROGRAMS OK');
