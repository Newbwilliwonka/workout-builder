// Rules for a sent copy: one id per try, and a Free Client cannot keep an edit.
const assert = require('assert');
const S = require('../sends.js');

const squat = { id: 'ex_squat', name: 'Squat', sets: 3 };
const workout = { id: 'wo_friday', name: 'Friday full body', items: [squat] };

const snap = S.snapshot(workout);
workout.items[0].name = 'Later';
workout.name = 'Later';
assert.strictEqual(snap.name, 'Friday full body');
assert.strictEqual(snap.items[0].name, 'Squat');
assert.notStrictEqual(snap.items, workout.items);

assert.strictEqual(S.selectionKey('wo_friday', ['b', 'a']), S.selectionKey('wo_friday', ['a', 'b']));
assert.notStrictEqual(S.selectionKey('wo_friday', ['a']), S.selectionKey('wo_other', ['a']));

let n = 0;
function makeId() { n += 1; return 'id-' + n; }
const first = S.prepareDeliveries(null, { id: 'wo_friday', name: 'Friday full body', items: [squat] }, ['c', 'e'], makeId);
assert.deepStrictEqual(Object.keys(first.ids).sort(), ['c', 'e']);
const retry = S.prepareDeliveries(first, { id: 'wo_friday', name: 'Friday full body', items: [squat] }, ['e', 'c'], makeId);
assert.strictEqual(retry.ids.c, first.ids.c);
assert.strictEqual(retry.ids.e, first.ids.e);
assert.strictEqual(n, 2);
const edited = S.prepareDeliveries(first, { id: 'wo_friday', name: 'Friday full body', items: [{ id: 'ex_squat', name: 'Squat', sets: 4 }] }, ['c', 'e'], makeId);
assert.notStrictEqual(edited.ids.c, first.ids.c);
const otherPeople = S.prepareDeliveries(first, { id: 'wo_friday', name: 'Friday full body', items: [squat] }, ['c'], makeId);
assert.ok(otherPeople.ids.c);
assert.notStrictEqual(otherPeople.ids.c, first.ids.c);

assert.strictEqual(S.sendBlocked({ key: first.key }, first.key), true);
assert.strictEqual(S.sendBlocked({ key: first.key }, otherPeople.key), false);
assert.strictEqual(S.sendBlocked(null, first.key), false);

assert.strictEqual(S.canEditCopy({ membership: 'enthusiast' }, { sourceTrainerId: 't' }), true);
assert.strictEqual(S.canEditCopy({ membership: 'none', intended_plan: 'enthusiast' }, { sourceTrainerId: 't' }), true);
assert.strictEqual(S.canEditCopy({ membership: 'free_client' }, { sourceTrainerId: 't' }), false);
assert.strictEqual(S.canEditCopy(null, { sourceTrainerId: 't' }), false);
assert.strictEqual(S.canEditCopy({ membership: 'free_client' }, { id: 'mine' }), true);

const own = { id: 'wo_own', name: 'Saturday', items: [], updatedAt: 5 };
const localCopy = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Local edit',
  items: [{ name: 'Local' }],
  sourceTrainerId: 't',
  updatedAt: Date.parse('2026-06-01T00:00:00.000Z')
};
const remote = {
  id: localCopy.id,
  name: 'Server',
  items: [{ name: 'Server' }],
  sourceTrainerId: 't',
  sourceTrainerEmail: 'coach@example.com',
  updatedAt: '2020-01-01T00:00:00.000Z'
};
const kept = S.mergeCopies([own, localCopy], [remote], { canEdit: true });
assert.strictEqual(kept[0].name, 'Saturday');
assert.strictEqual(kept[1].name, 'Local edit');
const replaced = S.mergeCopies([own, localCopy], [remote], { canEdit: false });
assert.strictEqual(replaced[1].name, 'Server');
assert.strictEqual(replaced[1].items[0].name, 'Server');
remote.items[0].name = 'Mutated';
assert.strictEqual(replaced[1].items[0].name, 'Server');

const fresh = S.mergeCopies([own], [{
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'New',
  items: [],
  sourceTrainerId: 't',
  sourceTrainerEmail: 'coach@example.com',
  updatedAt: '2024-01-01T00:00:00.000Z'
}], { canEdit: false });
assert.deepStrictEqual(fresh.map(function (w) { return w.name; }), ['Saturday', 'New']);
assert.strictEqual(fresh[1].sourceTrainerEmail, undefined);
assert.ok(JSON.stringify(fresh[1]).indexOf('@') === -1);
const emailName = S.mergeCopies([], [{
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  name: 'Named',
  items: [],
  sourceTrainerId: 't',
  sourceTrainerEmail: 'coach@example.com',
  sourceTrainerName: 'coach@example.com',
  updatedAt: '2024-01-01T00:00:00.000Z'
}], { canEdit: false });
assert.strictEqual(emailName[0].sourceTrainerEmail, undefined);
assert.strictEqual(emailName[0].sourceTrainerName, '');
const dropped = S.mergeCopies(fresh, [], { canEdit: true, removed: [fresh[1].id] });
assert.deepStrictEqual(dropped.map(function (w) { return w.id; }), ['wo_own']);
const duplicate = { id: 'wo_dup', name: 'New (copy)', items: [], sourceTrainerId: 't', updatedAt: 9 };
const still = S.mergeCopies([duplicate], [], { canEdit: true });
assert.strictEqual(still.length, 1);
assert.strictEqual(still[0].id, 'wo_dup');

const text = S.confirmation(
  [{ email: 'fan@example.com', plan: 'Enthusiast' }, { name: 'Ada', email: 'ada@example.com', plan: 'Free Client' }],
  'Friday full body'
);
assert.strictEqual(text, 'Enthusiast gets an editable copy of Friday full body. Ada gets a copy of Friday full body they can run. Your workout was not changed.');
assert.ok(text.indexOf('@') === -1);
const unnamed = S.confirmation([{ email: 'ada@example.com', plan: 'Free Client' }], 'Friday full body');
assert.strictEqual(unnamed, 'Client gets a copy of Friday full body they can run. Your workout was not changed.');
const locked = S.lockedHtml({ name: 'Friday', sourceTrainerEmail: 'coach@example.com', items: [] });
assert.ok(locked.indexOf('From Trainer') === -1);
assert.ok(locked.indexOf('Only an Enthusiast') !== -1);
assert.ok(locked.indexOf('@') === -1);
const namedFrom = S.lockedHtml({ name: 'Friday', sourceTrainerName: 'Sam', sourceTrainerEmail: 'coach@example.com', items: [] });
assert.ok(namedFrom.indexOf('From Sam') === -1);
assert.ok(namedFrom.indexOf('Sam') === -1);
assert.ok(namedFrom.indexOf('@') === -1);

assert.strictEqual(S.partialMessage(1, ['Saturday easy']), 'Sent 1 workout. Could not send Saturday easy.');
assert.strictEqual(S.partialMessage(2, ['Legs', 'Core']), 'Sent 2 workouts. Could not send Legs and Core.');
assert.strictEqual(S.partialMessage(3, ['A', 'B', 'C']), 'Sent 3 workouts. Could not send A, B, and C.');
assert.ok(S.partialMessage(1, ['Saturday easy']).indexOf('@') === -1);

assert.strictEqual(S.sendLabel(1, 1), 'Send 1 workout to 1 client');
assert.strictEqual(S.sendLabel(3, 2), 'Send 3 workouts to 2 clients');
assert.strictEqual(S.sendLabel(0, 0), 'Send 0 workouts to 0 clients');
assert.strictEqual(S.selectionKey(['b', 'a'], ['d', 'c']), S.selectionKey(['a', 'b'], ['c', 'd']));

assert.strictEqual(S.isUnavailable(new Error('Sending workouts is not available yet.')), true);
assert.strictEqual(S.isUnavailable(new Error('Failed to fetch')), false);

console.log('SENDS UNIT OK');
