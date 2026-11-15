// Saved stopwatch event-name matching. node tests/event-suggest.test.js
const assert = require('assert');
const N = require('../names.js');

function wo(id, at, items, extra) {
  var w = { id: id, name: id, updatedAt: at, createdAt: at, items: items };
  if (extra) Object.keys(extra).forEach(function (k) { w[k] = extra[k]; });
  return w;
}
function sw(id, name, events, extra) {
  var row = {
    id: id,
    name: name,
    mode: 'stopwatch',
    modeConfig: {
      lapsEnabled: true,
      lapCount: Math.max(1, events.length),
      events: events
    }
  };
  if (extra) Object.keys(extra).forEach(function (k) { row[k] = extra[k]; });
  return row;
}

const workouts = [
  wo('recent', 5000, [
    sw('shuttle', 'Shuttle', [
      { lap: 1, name: 'Score a goal' },
      { lap: 2, name: 'Defend a pass' }
    ]),
    { id: 'gob', name: 'Goblet Squat', mode: 'reps', modeConfig: { repsType: 'number', count: 10 } }
  ]),
  wo('mid', 4000, [
    sw('again', 'Again', [
      { lap: 1, name: 'Score a goal' },
      { lap: 2, name: 'Score a try' }
    ])
  ]),
  wo('kick', 3000, [
    sw('kick-ex', 'Finisher', [{ lap: 1, name: 'Goal kick' }])
  ]),
  wo('old', 2000, [
    sw('lower', 'Lower', [{ lap: 1, name: 'score a goal' }])
  ]),
  wo('trainer', 9000, [
    sw('secret', 'Secret', [{ lap: 1, name: 'Score a header' }])
  ], { sourceTrainerId: 'tr' }),
  wo('client', 9000, [
    sw('client-ex', 'Client', [{ lap: 1, name: 'Client goal' }])
  ], { remoteOwnerId: 'c1' }),
  wo('off', 8000, [
    {
      id: 'off-ex',
      name: 'Laps off',
      mode: 'stopwatch',
      modeConfig: { lapsEnabled: false, lapCount: 1, events: [{ lap: 1, name: 'Hidden goal' }] }
    }
  ]),
  wo('reps-ev', 7000, [
    { id: 'weird', name: 'Not an event', mode: 'reps', modeConfig: { events: [{ lap: 1, name: 'Reps goal' }] } }
  ]),
  wo('library', 3500, [
    sw('lib-ex', 'Cable finish', [{ lap: 1, name: 'Library finish' }], { media: { kind: 'library', libraryId: 'curl' } })
  ]),
  wo('blank', 1000, [
    sw('blank-ex', 'Blank', [{ lap: 1, name: '   ' }, { name: '...' }, null])
  ])
];

assert.deepStrictEqual(N.suggestEventNames(workouts, ''), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'g'), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, ' s '), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'p-'), []);
assert.deepStrictEqual(N.suggestEventNames(null, 'score'), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, null), []);

assert.deepStrictEqual(N.suggestEventNames(workouts, 'sco'), ['Score a goal', 'Score a try']);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'SCO'), N.suggestEventNames(workouts, 'sco'));
assert.deepStrictEqual(N.suggestEventNames(workouts, 'go'), ['Goal kick', 'Score a goal']);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'goal'), ['Goal kick', 'Score a goal']);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'pass'), ['Defend a pass']);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'def'), ['Defend a pass']);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'fend'), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'header'), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'client'), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'hidden'), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'reps'), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'gob'), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'dumbbell'), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'lib'), ['Library finish']);

// The spelling already in the field is not offered. A different case still is,
// so the saved spelling can replace what was typed.
assert.deepStrictEqual(N.suggestEventNames(workouts, 'Score a goal'), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'Score  a goal'), []);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'score a goal'), ['Score a goal']);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'defend-a-pass'), ['Defend a pass']);
assert.deepStrictEqual(N.suggestEventNames(workouts, 'Defend a pass'), []);

// Exercise names stay on suggestNames. Event names stay on suggestEventNames.
assert.deepStrictEqual(N.suggestNames(workouts, 'gob'), ['Goblet Squat']);
assert.deepStrictEqual(N.suggestNames(workouts, 'sco'), []);
assert.ok(N.suggestEventNames(workouts, 'goal').indexOf('Goblet Squat') < 0);

// New and edit read the same saved events. Nothing drops the open exercise.
assert.deepStrictEqual(
  N.suggestEventNames(workouts, 'sco', { excludeExerciseId: 'shuttle' }),
  N.suggestEventNames(workouts, 'sco')
);

(function frequencyBeatsANewerTypo() {
  const rows = [
    wo('a', 1000, [sw('1', 'A', [{ lap: 1, name: 'Push up' }])]),
    wo('b', 2000, [sw('2', 'B', [{ lap: 1, name: 'Push up' }])]),
    wo('c', 3000, [sw('3', 'C', [{ lap: 1, name: 'Push up' }])]),
    wo('d', 9000, [sw('4', 'D', [{ lap: 1, name: 'Push-up' }])])
  ];
  assert.deepStrictEqual(N.suggestEventNames(rows, 'push'), ['Push up']);
})();

(function recentBreaksAFrequencyTie() {
  const rows = [
    wo('a', 1000, [sw('1', 'A', [{ lap: 1, name: 'Push-up' }])]),
    wo('b', 2000, [sw('2', 'B', [{ lap: 1, name: 'Push up' }])]),
    wo('c', 4000, [sw('3', 'C', [{ lap: 1, name: 'Push up' }])]),
    wo('d', 5000, [sw('4', 'D', [{ lap: 1, name: 'Push-up' }])])
  ];
  assert.deepStrictEqual(N.suggestEventNames(rows, 'push'), ['Push-up']);
})();

(function laterEventBreaksAnEqualTime() {
  const rows = [wo('a', 1000, [sw('1', 'A', [
    { lap: 1, name: 'Push up' },
    { lap: 2, name: 'Push-up' }
  ])])];
  assert.deepStrictEqual(N.suggestEventNames(rows, 'push'), ['Push-up']);
})();

(function collapsedSpacesShareOneSpelling() {
  const rows = [
    wo('a', 1000, [sw('1', 'A', [{ lap: 1, name: 'Goal   kick' }])]),
    wo('b', 2000, [sw('2', 'B', [{ lap: 1, name: 'Goal kick' }])])
  ];
  assert.deepStrictEqual(N.suggestEventNames(rows, 'goal'), ['Goal kick']);
})();

(function limitAndCloserMatchesFirst() {
  const rows = [];
  for (var i = 0; i < 8; i++) rows.push(wo('w' + i, 1000 + i, [sw('e' + i, 'Move', [{ lap: 1, name: 'Move ' + i + ' goal' }])]));
  rows.push(wo('exact', 1, [sw('exact', 'Exact', [{ lap: 1, name: 'Goal' }])]));
  const all = N.suggestEventNames(rows, 'goal', { limit: 20 });
  assert.strictEqual(all[0], 'Goal');
  assert.strictEqual(all.length, 9);
  assert.deepStrictEqual(N.suggestEventNames(rows, 'goal').slice(1), [
    'Move 7 goal', 'Move 6 goal', 'Move 5 goal', 'Move 4 goal', 'Move 3 goal'
  ]);
  assert.strictEqual(N.suggestEventNames(rows, 'goal').length, 6);
  assert.deepStrictEqual(N.suggestEventNames(rows, 'goal', { limit: 0 }), []);
  assert.deepStrictEqual(
    N.suggestEventNames(rows, 'Goal', { limit: 20 }),
    N.suggestEventNames(rows, 'goal', { limit: 20 }).slice(1)
  );
})();

(function createdAtWhenUpdatedAtIsMissing() {
  const rows = [{ id: 'local', name: 'Home', createdAt: 50, items: [sw('1', 'Carry', [{ lap: 1, name: 'Farmer mark' }])] }];
  assert.deepStrictEqual(N.suggestEventNames(rows, 'farmer'), ['Farmer mark']);
})();

console.log('EVENT SUGGEST OK');
