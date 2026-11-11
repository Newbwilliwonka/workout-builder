// Rules for a sent copy: one id per try, and a Free Client cannot keep an edit.
const assert = require('assert');
const S = require('../sends.js');
const M = require('../model.js');

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
const dropped = S.mergeCopies(fresh, [], { canEdit: true, removed: [fresh[1].id] });
assert.deepStrictEqual(dropped.map(function (w) { return w.id; }), ['wo_own']);
const duplicate = { id: 'wo_dup', name: 'New (copy)', items: [], sourceTrainerId: 't', updatedAt: 9 };
const still = S.mergeCopies([duplicate], [], { canEdit: true });
assert.strictEqual(still.length, 1);
assert.strictEqual(still[0].id, 'wo_dup');

const text = S.confirmation(
  [{ email: 'fan@example.com', plan: 'Enthusiast' }, { email: 'ada@example.com', plan: 'Free Client' }],
  'Friday full body'
);
assert.strictEqual(text, 'fan@example.com gets an editable copy of Friday full body. ada@example.com gets a copy of Friday full body they can run. Your workout was not changed.');

const received = M.newWorkout('From coach');
received.sourceTrainerId = 't1';
received.sourceTrainerEmail = 'coach@example.com';
received.sourceWorkoutId = 'wo_src';
const copy = M.duplicateWorkout(received);
assert.strictEqual(copy.sourceTrainerId, undefined);
assert.strictEqual(copy.sourceTrainerEmail, undefined);
assert.strictEqual(received.sourceTrainerId, 't1');
assert.ok(copy.name.indexOf('(copy)') > 0);

assert.strictEqual(S.isUnavailable(new Error('Sending workouts is not available yet.')), true);
assert.strictEqual(S.isUnavailable(new Error('Failed to fetch')), false);

console.log('SENDS UNIT OK');
