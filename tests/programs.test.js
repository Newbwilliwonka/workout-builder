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
const parked = P.place(placed.programs, { id: 'pg9', ownerId: self, workoutId: 'push', date: '2026-11-12' });
const blocked = P.move(parked.programs, 'pg1', '2026-11-12');
assert.strictEqual(blocked.duplicate, true);
assert.strictEqual(blocked.moved, null);
assert.strictEqual(blocked.programs.filter(function (row) { return row.id === 'pg1' && row.date === '2026-11-11'; }).length, 1);
const moved = P.move(placed.programs, 'pg1', '2026-11-12');
assert.strictEqual(moved.moved.date, '2026-11-12');
assert.strictEqual(moved.duplicate, false);
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

assert.strictEqual(P.validTimes('10:00', '09:00').ok, false);
assert.strictEqual(P.validTimes('10:00', '10:00').ok, false);
assert.strictEqual(P.validTimes('9:60', '10:00').ok, false);
assert.strictEqual(P.validTimes('', '10:00').ok, false);
assert.ok(P.validTimes('10:00', '09:00').error.indexOf('after') !== -1);
const okTimes = P.validTimes('9:00', '10:30');
assert.strictEqual(okTimes.ok, true);
assert.strictEqual(okTimes.start, '09:00');
assert.strictEqual(okTimes.end, '10:30');
assert.strictEqual(P.formatRange('09:00', '10:30'), '9:00–10:30 AM');
assert.strictEqual(P.formatRange('09:00', '13:00'), '9:00 AM–1:00 PM');
assert.strictEqual(P.formatRange('13:15', '14:45'), '1:15–2:45 PM');

const badTime = P.place([], { id: 'bad', ownerId: self, workoutId: 'push', date: '2026-11-11', start: '18:00', end: '17:00' });
assert.strictEqual(badTime.created, null);
assert.strictEqual(badTime.programs.length, 0);
assert.ok(badTime.error);
const timed = P.place(placed.programs, {
  id: 'pg3', ownerId: self, workoutId: 'legs', workoutName: 'Legs', date: '2026-11-11', start: '14:00', end: '15:00'
});
assert.strictEqual(timed.created.start, '14:00');
assert.strictEqual(timed.created.end, '15:00');
const early = P.place(timed.programs, {
  id: 'pg4', ownerId: self, workoutId: 'core', workoutName: 'Core', date: '2026-11-11', start: '07:30', end: '08:00'
});
const ordered = P.byStart(early.programs.filter(function (row) { return row.date === '2026-11-11'; }));
assert.deepStrictEqual(ordered.map(function (row) { return row.id; }), ['pg4', 'pg3', 'pg1']);
const shifted = P.setTimes(early.programs, 'pg3', '6:00', '7:00');
assert.strictEqual(shifted.changed.start, '06:00');
assert.strictEqual(shifted.changed.end, '07:00');
assert.deepStrictEqual(P.byStart(shifted.programs.filter(function (row) { return row.date === '2026-11-11'; })).map(function (row) { return row.id; }), ['pg3', 'pg4', 'pg1']);
const rejected = P.setTimes(shifted.programs, 'pg3', '12:00', '11:00');
assert.strictEqual(rejected.changed, null);
assert.strictEqual(rejected.programs.filter(function (row) { return row.id === 'pg3'; })[0].start, '06:00');
const sameTimes = P.setTimes(shifted.programs, 'pg3', '06:00', '07:00');
assert.strictEqual(sameTimes.changed, null);
assert.strictEqual(sameTimes.error, '');
const removed = P.remove(shifted.programs, 'pg4');
assert.strictEqual(removed.removed.id, 'pg4');
assert.strictEqual(removed.programs.some(function (row) { return row.id === 'pg4'; }), false);

assert.deepStrictEqual(P.entryMenu({ role: 'free_client', self: self, ownerId: self }), ['run', 'view']);
assert.ok(P.entryMenu({ role: 'free_client', self: self, ownerId: self }).indexOf('remove') < 0);
assert.ok(P.entryMenu({ role: 'free_client', self: self, ownerId: self }).indexOf('add') < 0);
assert.deepStrictEqual(P.entryMenu({ role: 'enthusiast', self: self, ownerId: self }), ['run', 'view', 'remove', 'add']);
assert.deepStrictEqual(P.entryMenu({ role: 'trainer', self: 't', ownerId: 'ada', ownerPlan: 'free_client', linked: true }), ['run', 'view', 'remove', 'add']);
assert.deepStrictEqual(P.entryMenu({ role: 'master_trainer', self: 'm', ownerId: 'ada', ownerPlan: 'free_client', linked: true }), ['run', 'view', 'remove', 'add']);
assert.deepStrictEqual(P.entryMenu({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: true }), ['run', 'view', 'remove', 'add']);
assert.deepStrictEqual(P.entryMenu({ role: 'master_trainer', self: 'm', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: true }), ['run', 'view', 'remove', 'add']);
assert.deepStrictEqual(P.entryMenu({ role: 'trainer', self: 't', ownerId: 'jo', ownerPlan: 'enthusiast', linked: true, shareOn: false }), []);
assert.deepStrictEqual(P.entryMenu({ role: 'enthusiast', self: self, ownerId: 'ada', linked: true }), []);
assert.deepStrictEqual(P.entryMenu({ role: 'trainer', self: 't', ownerId: 't' }), []);

const keptTimes = P.merge(shifted.programs, [{
  local_id: 'pg3', owner_id: self, workout_local_id: 'legs', workout_name: 'Legs', items: [], day: '2026-11-20', presence: 'solo', updated_at: new Date(Date.now() + 120000).toISOString()
}], self, { keepLocalTimes: true });
const keptRow = keptTimes.filter(function (row) { return row.id === 'pg3'; })[0];
assert.strictEqual(keptRow.date, '2026-11-20');
assert.strictEqual(keptRow.start, '06:00');
assert.strictEqual(keptRow.end, '07:00');
const remoteTimes = P.merge(shifted.programs, [{
  local_id: 'pg3', owner_id: self, workout_local_id: 'legs', workout_name: 'Legs', items: [], day: '2026-11-21', presence: 'solo', starts_at: '11:00:00', ends_at: '12:15:00', updated_at: new Date(Date.now() + 180000).toISOString()
}], self);
const remoteRow = remoteTimes.filter(function (row) { return row.id === 'pg3'; })[0];
assert.strictEqual(remoteRow.start, '11:00');
assert.strictEqual(remoteRow.end, '12:15');

const remote = P.merge(marked.programs, [{
  local_id: 'pg1', owner_id: self, workout_local_id: 'push', workout_name: 'Push', items: [], day: '2026-11-13', presence: 'solo', updated_at: new Date(Date.now() + 60000).toISOString()
}], self);
assert.strictEqual(remote[0].date, '2026-11-13');
assert.strictEqual(P.isUuid('11111111-1111-4111-8111-111111111111'), true);
assert.strictEqual(P.isUuid('allow-test'), false);

const syncedOnly = [{ id: 'pg1', ownerId: self, workoutId: 'push', workoutName: 'Push', date: '2026-11-11', start: '09:00', end: '10:00', presence: 'solo', synced: true, updatedAt: 10 }];
const pendingOnly = [{ id: 'pg2', ownerId: self, workoutId: 'legs', workoutName: 'Legs', date: '2026-11-12', presence: 'solo', pending: true, updatedAt: 20 }];
const someoneElse = [{ id: 'pgX', ownerId: 'ada', workoutId: 'push', workoutName: 'Push', date: '2026-11-11', presence: 'solo', synced: true, updatedAt: 10 }];
const afterDelete = P.merge(syncedOnly.concat(pendingOnly).concat(someoneElse), [], self, {});
assert.strictEqual(afterDelete.some(function (row) { return row.id === 'pg1'; }), false);
assert.strictEqual(afterDelete.some(function (row) { return row.id === 'pg2'; }), true);
assert.strictEqual(afterDelete.some(function (row) { return row.id === 'pgX'; }), true);
const tombstoned = P.merge(syncedOnly, [{
  local_id: 'pg1', owner_id: self, workout_local_id: 'push', workout_name: 'Push', items: [], day: '2026-11-11', presence: 'solo', updated_at: new Date(5).toISOString()
}], self, { dropped: { pg1: 50 } });
assert.strictEqual(tombstoned.some(function (row) { return row.id === 'pg1'; }), false);
const revived = P.merge([], [{
  local_id: 'pg1', owner_id: self, workout_local_id: 'push', workout_name: 'Push', items: [], day: '2026-11-11', presence: 'solo', updated_at: new Date(80).toISOString()
}], self, { dropped: { pg1: 50 } });
assert.strictEqual(revived.some(function (row) { return row.id === 'pg1' && row.synced === true; }), true);
const legacy = P.merge([{ id: 'old', ownerId: self, workoutId: 'push', workoutName: 'Push', date: '2026-11-11', presence: 'solo', updatedAt: 1 }], [], self, {});
assert.strictEqual(legacy.length, 1);
assert.strictEqual(legacy[0].pending, true);
assert.deepStrictEqual(P.settleDrops({ pg1: 50 }, [{ local_id: 'pg1' }], [], self), { pg1: 50 });
assert.deepStrictEqual(P.settleDrops({ pg1: 50 }, [], [], self), {});

const stored = M.emptyData();
assert.ok(Array.isArray(stored.programs));
const mem = { s: {}, getItem: function (k) { return this.s[k] || null; }, setItem: function (k, v) { this.s[k] = v; } };
mem.setItem(M.STORAGE_KEY, JSON.stringify({ version: 1, workouts: stored.workouts }));
const loaded = M.load(mem);
assert.ok(Array.isArray(loaded.programs));
assert.strictEqual(loaded.programs.length, 0);

console.log('PROGRAMS OK');
