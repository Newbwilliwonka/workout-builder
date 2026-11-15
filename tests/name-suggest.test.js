// Saved exercise-name matching and de-dupe. node tests/name-suggest.test.js
const assert = require('assert');
const N = require('../names.js');

function wo(id, at, items, extra) {
  var w = { id: id, name: id, updatedAt: at, createdAt: at, items: items };
  if (extra) Object.keys(extra).forEach(function (k) { w[k] = extra[k]; });
  return w;
}
function ex(id, name, extra) {
  var row = { id: id, name: name };
  if (extra) Object.keys(extra).forEach(function (k) { row[k] = extra[k]; });
  return row;
}

const workouts = [
  wo('local-old', 1000, [
    ex('goblet', 'Goblet Squat'),
    ex('press', 'Bench Press'),
    ex('spacey', 'Push   up')
  ]),
  wo('local-new', 3000, [
    ex('slow', 'Slow Goblet'),
    ex('push-a', 'Push-up'),
    ex('photo', 'Goblet photo', { media: { kind: 'custom', imageKey: 'img_1' } })
  ]),
  wo('account', 4000, [
    ex('push-b', 'Push-up'),
    ex('rdl', 'Romanian Deadlift'),
    ex('lib', 'Cable curl', { media: { kind: 'library', libraryId: 'curl', view: '180' } })
  ]),
  wo('trainer', 9000, [ex('secret', 'Secret Goblet')], { sourceTrainerId: 'tr' }),
  wo('client', 9000, [ex('client-ex', 'Client Goblet')], { remoteOwnerId: 'c1' }),
  wo('blank', 8000, [{ name: '   ' }, { id: 'dots', name: '...' }, null])
];

assert.deepStrictEqual(N.suggestNames(workouts, ''), []);
assert.deepStrictEqual(N.suggestNames(workouts, 'g'), []);
assert.deepStrictEqual(N.suggestNames(workouts, ' g '), []);
assert.deepStrictEqual(N.suggestNames(workouts, 'p-'), []);
assert.deepStrictEqual(N.suggestNames(null, 'goblet'), []);
assert.deepStrictEqual(N.suggestNames(workouts, null), []);

assert.deepStrictEqual(N.suggestNames(workouts, 'goblet'), [
  'Goblet photo',
  'Goblet Squat',
  'Slow Goblet'
]);
assert.deepStrictEqual(N.suggestNames(workouts, 'GOBLET'), N.suggestNames(workouts, 'goblet'));
assert.deepStrictEqual(N.suggestNames(workouts, 'squat'), ['Goblet Squat']);
assert.deepStrictEqual(N.suggestNames(workouts, 'gob sq'), ['Goblet Squat']);
assert.deepStrictEqual(N.suggestNames(workouts, 'blet'), []);
assert.deepStrictEqual(N.suggestNames(workouts, 'lift'), []);
assert.deepStrictEqual(N.suggestNames(workouts, 'dead'), ['Romanian Deadlift']);
assert.deepStrictEqual(N.suggestNames(workouts, 'benchpress'), ['Bench Press']);
assert.deepStrictEqual(N.suggestNames(workouts, 'press'), ['Bench Press']);

// Punctuation, hyphens, and extra spaces are one name. Most frequent spelling wins.
assert.deepStrictEqual(N.suggestNames(workouts, 'pushup'), ['Push-up']);
assert.deepStrictEqual(N.suggestNames(workouts, 'push-up'), ['Push-up']);
assert.deepStrictEqual(N.suggestNames(workouts, 'push up'), ['Push-up']);
assert.deepStrictEqual(N.suggestNames(workouts, 'up'), ['Push-up']);

assert.deepStrictEqual(N.suggestNames(workouts, 'secret'), []);
assert.deepStrictEqual(N.suggestNames(workouts, 'client'), []);
assert.ok(N.suggestNames(workouts, 'cable').indexOf('Cable curl') >= 0, 'a name saved from the library still counts');
assert.deepStrictEqual(N.suggestNames(workouts, 'dumbbell'), [], 'ExerciseDB names that were never saved are not invented');

(function frequencyBeatsANewerTypo() {
  const rows = [
    wo('a', 1000, [ex('1', 'Push up')]),
    wo('b', 2000, [ex('2', 'Push up')]),
    wo('c', 3000, [ex('3', 'Push up')]),
    wo('d', 9000, [ex('4', 'Push-up')])
  ];
  assert.deepStrictEqual(N.suggestNames(rows, 'push'), ['Push up']);
})();

(function recentBreaksAFrequencyTie() {
  const rows = [
    wo('a', 1000, [ex('1', 'Push-up')]),
    wo('b', 2000, [ex('2', 'Push up')]),
    wo('c', 4000, [ex('3', 'Push up')]),
    wo('d', 5000, [ex('4', 'Push-up')])
  ];
  assert.deepStrictEqual(N.suggestNames(rows, 'push'), ['Push-up']);
})();

(function laterItemBreaksAnEqualTime() {
  const rows = [wo('a', 1000, [ex('1', 'Push up'), ex('2', 'Push-up')])];
  assert.deepStrictEqual(N.suggestNames(rows, 'push'), ['Push-up']);
})();

(function editingTheOnlySourceHidesThatName() {
  assert.deepStrictEqual(N.suggestNames(workouts, 'rom', { excludeExerciseId: 'rdl' }), []);
  assert.deepStrictEqual(N.suggestNames(workouts, 'rom'), ['Romanian Deadlift']);
  assert.deepStrictEqual(N.suggestNames(workouts, 'gob', { excludeExerciseId: 'brand-new' }), N.suggestNames(workouts, 'gob'));
})();

(function editingKeepsANameThatAlsoLivesElsewhere() {
  const rows = [
    wo('old', 1000, [ex('editing', 'Push-up')]),
    wo('other', 2000, [ex('else', 'Push up')])
  ];
  assert.deepStrictEqual(N.suggestNames(rows, 'push', { excludeExerciseId: 'editing' }), ['Push up']);
  const tied = [
    wo('old', 5000, [ex('editing', 'Push-up')]),
    wo('other', 1000, [ex('else', 'Push up')])
  ];
  assert.deepStrictEqual(N.suggestNames(tied, 'push', { excludeExerciseId: 'editing' }), ['Push-up']);
})();

(function collapsedSpacesShareOneSpelling() {
  const rows = [
    wo('a', 1000, [ex('1', 'Goblet   Squat')]),
    wo('b', 2000, [ex('2', 'Goblet Squat')])
  ];
  assert.deepStrictEqual(N.suggestNames(rows, 'gob'), ['Goblet Squat']);
})();

(function limitAndCloserMatchesFirst() {
  const rows = [];
  for (var i = 0; i < 8; i++) rows.push(wo('w' + i, 1000 + i, [ex('e' + i, 'Move ' + i + ' press')]));
  rows.push(wo('exact', 1, [ex('exact', 'Press')]));
  const all = N.suggestNames(rows, 'press', { limit: 20 });
  assert.strictEqual(all[0], 'Press');
  assert.strictEqual(all.length, 9);
  assert.deepStrictEqual(N.suggestNames(rows, 'press').slice(1), [
    'Move 7 press', 'Move 6 press', 'Move 5 press', 'Move 4 press', 'Move 3 press'
  ]);
  assert.strictEqual(N.suggestNames(rows, 'press').length, 6);
  assert.deepStrictEqual(N.suggestNames(rows, 'press', { limit: 0 }), []);
})();

(function createdAtWhenUpdatedAtIsMissing() {
  const rows = [{ id: 'local', name: 'Home', createdAt: 50, items: [ex('1', 'Farmer carry')] }];
  assert.deepStrictEqual(N.suggestNames(rows, 'farmer'), ['Farmer carry']);
})();

console.log('NAME SUGGEST OK');
