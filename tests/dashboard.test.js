// Standard dashboard math. Sample rows stay in this test. No database.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const D = require('../dashboard.js');
const H = require('../history.js');
const sample = require('./history-fixture').sampleSets;

const NOW = new Date(2026, 10, 16, 12, 0, 0);
const dashSrc = fs.readFileSync(path.join(__dirname, '../dashboard.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const authSrc = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');

assert.ok(!/Example data|Goblet Squat|Coach Ana|sampleSets|Alex Rivera/.test(dashSrc), 'the dashboard has no sample account');
assert.ok(/Stopwatch pass rate is intentionally not rendered/.test(dashSrc));
assert.ok(/WBDashboard\.allowed/.test(appSrc));
assert.ok(/mySchedule/.test(appSrc));
assert.ok(/dropped:\s*data\.programDrops/.test(appSrc), 'a workout removed on this device stays off the streak');
assert.ok(/collectPages/.test(authSrc.slice(authSrc.indexOf('mySchedule:'), authSrc.indexOf('gifBase:'))), 'schedule reads page past 1000 rows');
assert.ok(/updated_at/.test(authSrc.slice(authSrc.indexOf('mySchedule:'), authSrc.indexOf('gifBase:'))), 'schedule rows carry updated_at so a newer server copy can return');
assert.ok(/program_entries/.test(authSrc));
assert.ok(/workout_id,program_id/.test(authSrc));
assert.strictEqual(D.allowed({ membership: 'enthusiast' }), true);
assert.strictEqual(D.allowed({ membership: 'trainer' }), true);
assert.strictEqual(D.allowed({ membership: 'master_trainer' }), true);
assert.strictEqual(D.allowed({ membership: 'free_client' }), false);
assert.strictEqual(D.allowed({ membership: null, intended_plan: 'enthusiast' }), false);
assert.strictEqual(D.allowed(null), false);
assert.deepStrictEqual(D.RATINGS.map(function (row) { return row.label; }), [
  'Elite', 'Excellent', 'Good', 'Keep trying', 'On vacation?'
]);
assert.strictEqual(new Set(D.RATINGS.map(function (row) { return row.color; })).size, 5);

function set(over) {
  return Object.assign({
    sessionId: 's1', localDate: '2026-11-10', startedAt: 1, workoutName: 'Day',
    exerciseName: 'Squat', libraryExerciseId: '0101', mode: 'reps', displayUnit: 'kg',
    setNumber: 1, status: 'completed', removed: false,
    plannedReps: 5, plannedWeightKg: 20, actualReps: 5, actualWeightKg: 20,
    actualLaps: [], actualEvents: [], plannedEvents: []
  }, over);
}
function session(id, date, over) {
  return Object.assign({ id: id, local_date: date, status: 'completed', workout_name: 'Day' }, over);
}
function model(sets, sessions, entries, workouts, schemaVersion) {
  var input = { sets: sets, sessions: sessions, entries: entries || [], workouts: workouts || [], now: NOW };
  if (schemaVersion != null) input.schemaVersion = schemaVersion;
  return D.build(input);
}

assert.strictEqual(D.hitPlan(set()), true);
assert.strictEqual(D.hitPlan(set({ actualReps: 8, actualWeightKg: 25 })), true, 'more reps and more weight beat the plan');
assert.strictEqual(D.hitPlan(set({ actualReps: 4 })), false, 'fewer reps miss');
assert.strictEqual(D.hitPlan(set({ actualWeightKg: 18 })), false, 'a lighter bar misses');
assert.strictEqual(D.hitPlan(set({ status: 'skipped', actualReps: null, actualWeightKg: null })), false);
assert.strictEqual(D.hitPlan(set({
  plannedReps: null, plannedRepsMin: 8, plannedRepsMax: 12, actualReps: 13
})), true, 'above the top of a range still beats the plan');
assert.strictEqual(D.hitPlan(set({
  plannedReps: null, plannedRepsMin: 8, plannedRepsMax: 12, actualReps: 7
})), false);
assert.strictEqual(D.hitPlan(set({
  mode: 'static_hold', plannedReps: null, plannedWeightKg: null, plannedBodyweight: true,
  actualBodyweight: true, displayUnit: 'bodyweight', plannedHoldSec: 60, actualHoldSec: 60
})), true);
assert.strictEqual(D.hitPlan(set({
  mode: 'static_hold', plannedReps: null, plannedWeightKg: null, plannedBodyweight: true,
  actualBodyweight: true, displayUnit: 'bodyweight', plannedHoldSec: 60, actualHoldSec: 45
})), false);
assert.strictEqual(D.hitPlan(set({
  mode: 'stopwatch', displayUnit: 'bodyweight', plannedBodyweight: true, actualBodyweight: true,
  plannedReps: null, plannedWeightKg: null, plannedLapCount: 4,
  actualLaps: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }],
  actualEvents: [{ lap: 1, name: 'Finish', result: 'fail' }]
})), false, 'a failed event mark misses');
assert.strictEqual(D.hitPlan(set({
  mode: 'intervals', plannedReps: null, plannedWeightKg: null, plannedBodyweight: true,
  actualBodyweight: true, displayUnit: 'bodyweight', plannedWorkSec: 30, actualWorkSec: 30,
  plannedRounds: 10, actualRounds: 8
})), false);
assert.strictEqual(D.hitPlan(set({
  mode: 'timer', plannedWorkSec: 40, actualWorkSec: 40, plannedRestSec: 15, actualRestSec: 20
})), true, 'a longer rest does not miss the plan');
assert.strictEqual(D.hitPlan(set({ removed: true })), false);

const even = model(
  [set({ sessionId: 'a' }), set({ sessionId: 'b', status: 'skipped', actualReps: null, actualWeightKg: null })],
  [session('a', '2026-11-10'), session('b', '2026-11-11')]
);
assert.strictEqual(even.plan.hits, 1);
assert.strictEqual(even.plan.total, 2);
assert.strictEqual(even.plan.pct, 50);
assert.strictEqual(even.plan.rating.label, 'Keep trying');

function rated(hits, total) {
  var sets = [];
  var sessions = [];
  var i;
  for (i = 0; i < total; i++) {
    var id = 'r' + i;
    sets.push(set({
      sessionId: id, setNumber: 1, libraryExerciseId: 'e' + i, exerciseName: 'Lift ' + i,
      actualReps: i < hits ? 5 : 1
    }));
    sessions.push(session(id, '2026-11-02'));
  }
  return model(sets, sessions).plan;
}
assert.strictEqual(rated(10, 11).pct, 91);
assert.strictEqual(rated(10, 11).rating.label, 'Elite');
assert.strictEqual(rated(17, 20).pct, 85);
assert.strictEqual(rated(17, 20).rating.label, 'Excellent');
assert.strictEqual(rated(3, 4).pct, 75);
assert.strictEqual(rated(3, 4).rating.label, 'Good');
assert.strictEqual(rated(3, 5).pct, 60);
assert.strictEqual(rated(3, 5).rating.label, 'Keep trying');
assert.strictEqual(rated(2, 5).pct, 40);
assert.strictEqual(rated(2, 5).rating.label, 'On vacation?');
assert.strictEqual(rated(9, 10).pct, 90);
assert.strictEqual(rated(8, 10).pct, 80);
assert.strictEqual(rated(7, 10).pct, 70);
assert.strictEqual(rated(5, 10).pct, 50);
assert.strictEqual(rated(49, 100).rating.label, 'On vacation?');

const outside = model(
  [set({ localDate: '2026-10-22', actualReps: 1 })],
  [session('s1', '2026-10-22')]
);
assert.strictEqual(outside.plan.total, 0);
assert.strictEqual(outside.plan.pct, null);

const removed = model(
  [set({ sessionId: 'keep' }), set({ sessionId: 'drop', removed: true, actualReps: 1, libraryExerciseId: '9999' })],
  [session('keep', '2026-11-10'), session('drop', '2026-11-10')]
);
assert.strictEqual(removed.plan.total, 1);
assert.strictEqual(removed.plan.pct, 100);

const early = model(
  [set({ sessionId: 'early', localDate: '2026-11-16' })],
  [session('early', '2026-11-16', { status: 'ended_early' }), session('open', '2026-11-16', { status: 'in_progress' })]
);
assert.strictEqual(early.workouts.week, 1, 'an ended-early workout counts, an open one does not');
assert.strictEqual(early.workouts.month, 1);
assert.strictEqual(early.calendar.count, 1);

const body = model(
  [
    set({ sessionId: 'w', localDate: '2026-11-16', actualWeightKg: 10, actualReps: 4 }),
    set({
      sessionId: 'bw', libraryExerciseId: '1001', exerciseName: 'Push-up', displayUnit: 'bodyweight',
      plannedBodyweight: true, actualBodyweight: true, plannedWeightKg: null, actualWeightKg: null, actualReps: 20
    })
  ],
  [session('w', '2026-11-16'), session('bw', '2026-11-16')]
);
assert.strictEqual(body.volume.weekKg, 40);
assert.strictEqual(body.volume.weeks.length, 8);
assert.strictEqual(body.volume.weeks[7].label, 'Nov 16');
assert.strictEqual(body.volume.weeks[0].start, '2026-09-28');

const many = [];
const manySessions = [];
for (var n = 0; n < 1001; n++) {
  many.push(set({ sessionId: 'm' + n, libraryExerciseId: 'm' + n, exerciseName: 'Move ' + n }));
  manySessions.push(session('m' + n, '2026-11-03'));
}
assert.strictEqual(model(many, manySessions).plan.total, 1001, 'no 1000-row cutoff in the view');

const sched = model(
  [set({ sessionId: 'd14', localDate: '2026-11-14' }), set({ sessionId: 'd12', localDate: '2026-11-12' })],
  [
    session('d14', '2026-11-14', { program_id: 'pg14', status: 'ended_early' }),
    session('d12', '2026-11-12', { program_id: 'pg12' })
  ],
  [
    { id: 'pg14', date: '2026-11-14', workoutId: 'wo' },
    { id: 'pg13', date: '2026-11-13', workoutId: 'wo' },
    { id: 'pg12', date: '2026-11-12', workoutId: 'wo' }
  ]
);
assert.strictEqual(sched.workouts.streak, 1, 'Nov 12 is before the miss, so only Nov 14 counts');
const missedLatest = model(
  [set({ sessionId: 'old', localDate: '2026-11-12' })],
  [session('old', '2026-11-12', { program_id: 'pg12' })],
  [
    { id: 'pg15', date: '2026-11-15', workoutId: 'wo' },
    { id: 'pg12', date: '2026-11-12', workoutId: 'wo' }
  ]
);
assert.strictEqual(missedLatest.workouts.streak, 0, 'a missed scheduled day breaks the streak');

const rest = model(
  [set({ sessionId: 'a', localDate: '2026-11-14' }), set({ sessionId: 'b', localDate: '2026-11-12' })],
  [session('a', '2026-11-14', { workout_id: 'wo' }), session('b', '2026-11-12', { workout_id: 'wo' })],
  [
    { id: 'pg14', date: '2026-11-14', workoutId: 'wo' },
    { id: 'pg12', date: '2026-11-12', workoutId: 'wo' }
  ]
);
assert.strictEqual(rest.workouts.streak, 2, 'the empty day between them is rest and does not break it');

const openToday = model(
  [set({ sessionId: 'y', localDate: '2026-11-14' })],
  [session('y', '2026-11-14', { program_id: 'pg14' })],
  [
    { id: 'pg16', date: '2026-11-16', workoutId: 'wo' },
    { id: 'pg14', date: '2026-11-14', workoutId: 'wo' }
  ]
);
assert.strictEqual(openToday.workouts.streak, 1, 'today is not a miss until the day is over');

const none = model([set()], [session('s1', '2026-11-10')], []);
assert.strictEqual(none.workouts.streak, null);

const futureOnly = model(
  [set()],
  [session('s1', '2026-11-10')],
  [{ id: 'later', date: '2026-11-20', workoutId: 'wo' }]
);
assert.strictEqual(futureOnly.workouts.streak, 0);

const empty = D.build({ sets: [], sessions: [], now: NOW });
assert.strictEqual(empty.empty, true);
const emptyHtml = D.html(empty);
assert.ok(emptyHtml.indexOf('Finish a workout and your dashboard will fill in.') >= 0);
assert.ok(emptyHtml.indexOf('Hit the plan') < 0);
assert.ok(emptyHtml.indexOf('Example data') < 0);

const page = D.html(rest);
assert.ok(page.indexOf('pass rate') < 0);
assert.ok(page.indexOf('id="dashboard-pass"') < 0);
assert.ok(page.indexOf('No holds yet.') >= 0);
assert.ok(page.indexOf('No times yet.') < 0);
assert.ok(page.indexOf('Recent personal records') < 0);
assert.ok(page.indexOf('id="dashboard-stopwatch"') < 0);
assert.ok(page.indexOf('id="dashboard-records"') < 0);
assert.ok(page.indexOf('Example data') < 0);
assert.ok(page.indexOf('<button') < 0);
assert.ok(page.indexOf('<input') < 0);
assert.ok(page.indexOf('id="dashboard-sheet"') >= 0);
var order = ['Hit the plan', 'Workouts and streak', 'Total volume', 'Strength and Capacity', 'Consistency · November 2026', 'Static holds'].map(function (label) {
  return page.indexOf(label);
});
assert.ok(order.every(function (at) { return at >= 0; }));
assert.deepStrictEqual(order, order.slice().sort(function (a, b) { return a - b; }));
assert.ok(page.indexOf('id="dashboard-streak"') >= 0);
assert.ok(page.indexOf('Rest days do not break this streak.') >= 0);
assert.strictEqual(rest.workouts.goal, 0, 'last week\'s calendar days are not this week\'s goal');
assert.ok(page.indexOf('id="dashboard-goal"') < 0);
assert.ok(page.indexOf('db-bar') < 0);
assert.ok(page.indexOf('Kilograms lifted, last eight weeks') >= 0);
assert.ok(page.indexOf('Kilograms lifted by week, last eight weeks') >= 0);
const hidden = D.html(none);
assert.ok(hidden.indexOf('id="dashboard-streak"') < 0);
assert.ok(hidden.indexOf('Rest days do not break') < 0);
assert.ok(hidden.indexOf('This week') >= 0);

const colors = D.html(model(
  [set(), set({ sessionId: 'b', actualReps: 1 })],
  [session('s1', '2026-11-10'), session('b', '2026-11-11')]
));
assert.ok(colors.indexOf('Keep trying') >= 0);
assert.ok(colors.indexOf('#D97706') >= 0);
D.RATINGS.forEach(function (row) { assert.ok(colors.indexOf(row.color) >= 0, row.label); });

const cleaned = H.fromRows(
  [{ id: 's1', local_date: '2026-11-12', started_at: '2026-11-12T18:00:00.000Z', workout_name: 'Lower', status: 'completed' }],
  [{
    session_id: 's1', library_exercise_id: '0101', exercise_name: 'Barbell squat', mode: 'reps',
    set_number: 1, status: 'completed', removed: false, display_unit: 'lb',
    planned_reps: 5, planned_weight_kg: 90, actual_reps: 5, actual_weight_kg: 100
  }],
  []
);
const fromHistory = D.build({ sets: cleaned, sessions: [{ id: 's1', local_date: '2026-11-12', status: 'completed' }], now: NOW });
assert.strictEqual(fromHistory.plan.pct, 100);
assert.strictEqual(fromHistory.records[0].badge, 'Heaviest');
assert.ok(/lb$/.test(fromHistory.records[0].value));

const fixtureSets = H.fromRows(
  require('./history-fixture').remoteHistory().sessions,
  require('./history-fixture').remoteHistory().sets,
  require('./history-fixture').remoteHistory().exercises
);
const fixtureSessions = require('./history-fixture').remoteHistory().sessions;
const fixture = D.build({ sets: fixtureSets, sessions: fixtureSessions, now: NOW });
assert.strictEqual(fixture.empty, false);
assert.deepStrictEqual({ hits: fixture.plan.hits, total: fixture.plan.total, pct: fixture.plan.pct, label: fixture.plan.rating.label }, {
  hits: 11, total: 17, pct: 65, label: 'Keep trying'
});
assert.strictEqual(fixture.workouts.week, 0);
assert.strictEqual(fixture.workouts.month, 13);
assert.strictEqual(fixture.calendar.count, 12);
assert.strictEqual(fixture.workouts.streak, null);
assert.ok(fixture.records.some(function (row) { return row.badge === 'Heaviest'; }));
assert.ok(fixture.records.some(function (row) { return row.badge === 'Best lap'; }));
assert.ok(fixture.records.some(function (row) { return row.badge === 'Fastest'; }));
assert.ok(fixture.records.some(function (row) { return row.badge === 'Most passes'; }));
assert.ok(!fixture.records.some(function (row) { return row.value.indexOf('300') >= 0; }), 'a removed set is not a record');
assert.ok(fixture.calendar.count >= 1);

const nine = [];
const nineSessions = [];
for (var r = 0; r < 9; r++) {
  var day = '2026-11-' + (r < 9 ? '0' : '') + (r + 1);
  nine.push(set({
    sessionId: 'rec' + r, localDate: day, libraryExerciseId: 'rec' + r,
    exerciseName: 'Record ' + r, actualWeightKg: 30 + r, startedAt: r
  }));
  nineSessions.push(session('rec' + r, day));
}
const recent = model(nine, nineSessions);
assert.strictEqual(recent.records.length, 8);
assert.strictEqual(recent.records[0].name, 'Record 8');
assert.ok(!recent.records.some(function (row) { return row.name === 'Record 0'; }));

const LB = 0.45359237;
const weekGoal = model(
  [set({ sessionId: 'd16', localDate: '2026-11-16' })],
  [session('d16', '2026-11-16')],
  [
    { id: 'a', date: '2026-11-16', workoutId: 'wo' },
    { id: 'b', date: '2026-11-18', workoutId: 'wo' },
    { id: 'c', date: '2026-11-18', workoutId: 'wo2' },
    { id: 'old', date: '2026-11-12', workoutId: 'wo' },
    { id: 'next', date: '2026-11-23', workoutId: 'wo' },
    { id: 'a', date: '2026-11-16', workoutId: 'wo' }
  ]
);
assert.strictEqual(weekGoal.workouts.goal, 3, 'two on Wednesday count, a duplicate and other weeks do not');
assert.strictEqual(weekGoal.workouts.week, 1);
const goalHtml = D.html(weekGoal);
assert.ok(goalHtml.indexOf("This week's goal: 3 workouts") >= 0);
assert.strictEqual((goalHtml.match(/class="db-bar(?: on)?"/g) || []).length, 3);
assert.strictEqual((goalHtml.match(/class="db-bar on"/g) || []).length, 1);
const droppedGoal = model(
  [set({ sessionId: 'd16', localDate: '2026-11-16' })],
  [session('d16', '2026-11-16')],
  [
    { id: 'keep', date: '2026-11-16', workoutId: 'wo' },
    { id: 'keep2', date: '2026-11-19', workoutId: 'wo' }
  ]
);
assert.strictEqual(droppedGoal.workouts.goal, 2, 'a removed calendar day is not in the entries the streak uses');
const frozenGoal = D.freeze(weekGoal, ['workouts'], { asOf: '2026-11-16', trainerName: 'Coach Lee' });
weekGoal.workouts.goal = 9;
assert.strictEqual(frozenGoal.cards[0].workouts.goal, 3);
assert.ok(D.snapshotHtml(frozenGoal).indexOf("This week's goal: 3 workouts") >= 0);
const hiddenGoal = D.freeze(rest, ['workouts'], { asOf: '2026-11-16', trainerName: 'Coach Lee' });
assert.strictEqual(hiddenGoal.cards[0].workouts.goal, 0);
assert.ok(D.snapshotHtml(hiddenGoal).indexOf('id="dashboard-goal"') < 0);

assert.strictEqual(D.gainRating(0.1).label, 'Good');
assert.strictEqual(D.gainRating(1).label, 'Good');
assert.strictEqual(D.gainRating(1).color, '#2563EB');
assert.strictEqual(D.gainRating(1.0001).label, 'Excellent');
assert.strictEqual(D.gainRating(5).label, 'Excellent');
assert.strictEqual(D.gainRating(5).color, '#16A34A');
assert.strictEqual(D.gainRating(5.0001).label, 'Elite');
assert.strictEqual(D.gainRating(10).label, 'Elite');
assert.strictEqual(D.gainRating(10).color, '#0F766E');
assert.strictEqual(D.gainRating(10.0001).label, 'Alien');
assert.strictEqual(D.gainRating(10.0001).color, D.gainRating(10).color);
assert.strictEqual(D.gainRating(0), null);
assert.strictEqual(D.gainRating(-3), null);

function reps(over) {
  return set(Object.assign({ mode: 'reps', status: 'completed', actualReps: 5, actualWeightKg: 100 }, over));
}
function fillWidths(html) {
  var out = [];
  var re = /class="db-gain-fill" style="width:([0-9.]+)%/g;
  var match;
  while ((match = re.exec(html))) out.push(match[1]);
  return out;
}
function beat(over) {
  return reps(Object.assign({
    plannedWeightKg: 100, plannedReps: 10, actualWeightKg: 100, actualReps: 10
  }, over));
}
const movers = model([
  beat({ sessionId: 'sq', libraryExerciseId: 'sq', exerciseName: 'Back squat', actualWeightKg: 110 }),
  beat({ sessionId: 'fs', libraryExerciseId: 'fs', exerciseName: 'Front squat', displayUnit: 'lb', plannedWeightKg: 200 * LB, actualWeightKg: 220 * LB }),
  beat({ sessionId: 'curl', libraryExerciseId: 'cap', exerciseName: 'Curl', actualReps: 12 }),
  beat({ sessionId: 'flat', libraryExerciseId: 'flat', exerciseName: 'Flat bench' }),
  beat({ sessionId: 'dl', libraryExerciseId: 'dl', exerciseName: 'Deadlift', actualWeightKg: 90, actualReps: 8 }),
  beat({ sessionId: 'row', libraryExerciseId: 'row', exerciseName: 'Row', actualWeightKg: 110, actualReps: 12 }),
  beat({ sessionId: 'bp-light', libraryExerciseId: 'bp', exerciseName: 'Bench press', setNumber: 1, plannedWeightKg: 50, actualWeightKg: 80 }),
  beat({ sessionId: 'bp-heavy', libraryExerciseId: 'bp', exerciseName: 'Bench press', setNumber: 2, plannedWeightKg: 100, actualWeightKg: 110 }),
  beat({ sessionId: 'miss-light', libraryExerciseId: 'miss', exerciseName: 'Miss', setNumber: 1, plannedWeightKg: 40, actualWeightKg: 80 }),
  beat({ sessionId: 'miss-heavy', libraryExerciseId: 'miss', exerciseName: 'Miss', setNumber: 2, plannedWeightKg: 100, actualWeightKg: 100 }),
  beat({ sessionId: 'tm', libraryExerciseId: 'tm', exerciseName: 'Timer press', mode: 'timer', actualWeightKg: 120 }),
  beat({ sessionId: 'old', localDate: '2026-10-02', libraryExerciseId: 'old', exerciseName: 'October lift', actualWeightKg: 180 }),
  beat({
    sessionId: 'pu', libraryExerciseId: 'pu', exerciseName: 'Push-up', displayUnit: 'bodyweight',
    plannedBodyweight: true, actualBodyweight: true, plannedWeightKg: null, actualWeightKg: null, actualReps: 12
  })
], [
  session('sq', '2026-11-02'), session('fs', '2026-11-03'), session('curl', '2026-11-04'),
  session('flat', '2026-11-05'), session('dl', '2026-11-05'), session('row', '2026-11-06'),
  session('bp-heavy', '2026-11-07'), session('tm', '2026-11-08'), session('old', '2026-10-02'),
  session('pu', '2026-11-09')
]);
assert.deepStrictEqual(movers.strength.weight.map(function (row) { return [row.name, row.detail, row.pct, row.rating.label]; }), [
  ['Timer press', '+20 kg', 20, 'Alien'],
  ['Back squat', '+10 kg', 10, 'Elite'],
  ['Bench press', '+10 kg', 10, 'Elite'],
  ['Front squat', '+20 lb', 10, 'Elite'],
  ['Row', '+10 kg', 10, 'Elite']
]);
assert.ok(!movers.strength.weight.some(function (row) {
  return row.name === 'Curl' || row.name === 'Flat bench' || row.name === 'Deadlift' || row.name === 'Miss' || row.name === 'October lift' || row.name === 'Push-up';
}), 'equal, below, outside the month, and a lighter set do not add a strength line');
assert.deepStrictEqual(movers.strength.reps.map(function (row) { return [row.name, row.detail, row.pct, row.rating.label]; }), [
  ['Curl', '+2 reps', 20, 'Alien'],
  ['Push-up', '+2 reps', 20, 'Alien'],
  ['Row', '+2 reps', 20, 'Alien']
]);
assert.strictEqual(movers.strength.reps[0].rating.color, '#0F766E');
assert.ok(!movers.strength.reps.some(function (row) { return row.name === 'Back squat' || row.name === 'Flat bench' || row.name === 'Deadlift'; }));
const moveHtml = D.html(movers);
assert.strictEqual((moveHtml.match(/class="db-gain"/g) || []).length, 8, 'each gain is its own line');
assert.deepStrictEqual(fillWidths(moveHtml), ['100', '100', '100', '100', '100', '100', '100', '100'], '10% fills the bar, and a gain past 10% stays full');
assert.ok(moveHtml.indexOf('width:50%') < 0);
assert.ok(moveHtml.indexOf('>10% · Elite<') >= 0);
assert.ok(moveHtml.indexOf('>20% · Alien<') >= 0);
assert.ok(moveHtml.indexOf('+20 lb') >= 0);
assert.ok(moveHtml.indexOf('+2 reps') >= 0);
assert.ok(moveHtml.indexOf('No gains yet this month') < 0);
const weightList = moveHtml.slice(moveHtml.indexOf('id="dashboard-strength-weight-list"'), moveHtml.indexOf('id="dashboard-strength-reps-title"'));
const repsList = moveHtml.slice(moveHtml.indexOf('id="dashboard-strength-reps-list"'));
assert.ok(weightList.indexOf('Back squat') >= 0 && weightList.indexOf('Front squat') >= 0);
assert.ok(weightList.indexOf('Curl') < 0, 'a reps-only gain stays under Capacity');
assert.ok(repsList.indexOf('Curl') >= 0 && repsList.indexOf('+2 reps') >= 0);
const quietGains = model([
  reps({ sessionId: 'flat-new', localDate: '2026-11-02', libraryExerciseId: 'flat', actualWeightKg: 20, actualReps: 5 }),
  reps({ sessionId: 'under', localDate: '2026-11-03', libraryExerciseId: 'under', exerciseName: 'Under', actualWeightKg: 18, actualReps: 4 })
], [session('flat', '2026-11-02'), session('under', '2026-11-03')]);
const quietHtml = D.html(quietGains);
assert.ok(quietHtml.indexOf('id="dashboard-strength-weight-empty"') >= 0);
assert.ok(quietHtml.indexOf('id="dashboard-strength-reps-empty"') >= 0);
assert.strictEqual((quietHtml.match(/No gains yet this month/g) || []).length, 2);
const ranged = model([
  reps({
    sessionId: 'over', libraryExerciseId: 'rg', exerciseName: 'Range curl',
    plannedReps: null, plannedRepsMin: 8, plannedRepsMax: 12, actualReps: 14,
    plannedWeightKg: 20, actualWeightKg: 20
  }),
  reps({
    sessionId: 'top', libraryExerciseId: 'top', exerciseName: 'At the top',
    plannedReps: null, plannedRepsMin: 8, plannedRepsMax: 12, actualReps: 12,
    plannedWeightKg: 20, actualWeightKg: 20
  }),
  reps({
    sessionId: 'inside', libraryExerciseId: 'in', exerciseName: 'Inside',
    plannedReps: null, plannedRepsMin: 8, plannedRepsMax: 12, actualReps: 10,
    plannedWeightKg: 20, actualWeightKg: 20
  }),
  reps({
    sessionId: 'floor', libraryExerciseId: 'fl', exerciseName: 'Floor',
    plannedReps: null, plannedRepsMin: 8, plannedRepsMax: null, actualReps: 10,
    plannedWeightKg: 20, actualWeightKg: 20
  })
], [session('over', '2026-11-04'), session('top', '2026-11-04'), session('inside', '2026-11-04'), session('floor', '2026-11-04')]);
assert.deepStrictEqual(ranged.strength.reps.map(function (row) { return [row.name, row.detail, row.pct]; }), [
  ['Floor', '+2 reps', 25],
  ['Range curl', '+2 reps', Math.round((2 / 12) * 100 * 10000) / 10000]
]);
assert.deepStrictEqual(ranged.strength.weight, []);
assert.ok(ranged.strength.reps.every(function (row) { return row.name !== 'At the top' && row.name !== 'Inside'; }));
const onePct = model([
  reps({
    sessionId: 'g-new', localDate: '2026-11-01', libraryExerciseId: 'g', exerciseName: 'Good lift',
    plannedWeightKg: 100, actualWeightKg: 101, plannedReps: 100, actualReps: 101
  })
], [session('g', '2026-11-01')]);
assert.strictEqual(onePct.strength.weight[0].pct, 1);
assert.strictEqual(onePct.strength.weight[0].detail, '+1 kg');
assert.strictEqual(onePct.strength.weight[0].rating.label, 'Good');
assert.strictEqual(onePct.strength.reps[0].detail, '+1 rep');
assert.strictEqual(onePct.strength.reps[0].rating.label, 'Good');
assert.deepStrictEqual(fillWidths(D.html(onePct)), ['10', '10'], '1% is one tenth of the bar');
const fivePct = model([
  reps({
    sessionId: 'e-new', localDate: '2026-11-01', libraryExerciseId: 'e', exerciseName: 'Excellent lift',
    plannedWeightKg: 200, actualWeightKg: 210, plannedReps: 20, actualReps: 21
  })
], [session('e', '2026-11-01')]);
assert.strictEqual(fivePct.strength.weight[0].pct, 5);
assert.strictEqual(fivePct.strength.weight[0].detail, '+10 kg');
assert.strictEqual(fivePct.strength.weight[0].rating.label, 'Excellent');
assert.strictEqual(fivePct.strength.reps[0].rating.label, 'Excellent');
assert.deepStrictEqual(fillWidths(D.html(fivePct)), ['50', '50'], '5% is half the bar');
const ownKey = model([
  reps({
    sessionId: 'p-new', localDate: '2026-11-01', personalExerciseId: 'pex', exerciseName: 'My row',
    plannedWeightKg: 40, actualWeightKg: 44, plannedReps: 10, actualReps: 10, libraryExerciseId: ''
  })
], [session('p', '2026-11-01')]);
assert.strictEqual(ownKey.strength.weight[0].name, 'My row');
assert.strictEqual(ownKey.strength.weight[0].pct, 10);
assert.strictEqual(ownKey.strength.weight[0].detail, '+4 kg');
assert.deepStrictEqual(ownKey.strength.reps, []);
const frozenMoves = D.freeze(movers, ['strength'], { asOf: '2026-11-16', trainerName: 'Coach Lee' });
movers.strength.weight = [];
assert.strictEqual(frozenMoves.cards[0].strength.weight.length, 5);
const frozenMoveHtml = D.snapshotHtml(frozenMoves);
assert.ok(frozenMoveHtml.indexOf('Front squat') >= 0);
assert.ok(frozenMoveHtml.indexOf('+20 lb') >= 0);
assert.deepStrictEqual(fillWidths(frozenMoveHtml), ['100', '100', '100', '100', '100', '100', '100', '100'], 'a saved snapshot scales its bars when it is drawn');
assert.ok(frozenMoveHtml.indexOf('>20% · Alien<') >= 0);
const stored = {
  asOf: '2026-11-16',
  trainerName: 'Coach Lee',
  cards: [{
    type: 'strength',
    strength: {
      weight: [
        { name: 'Bench press', pct: 5, rating: { label: 'Excellent', color: '#16A34A' }, detail: '100 kg to 105 kg' },
        { name: 'Back squat', pct: 10, rating: { label: 'Elite', color: '#0F766E' }, detail: '100 kg to 110 kg' },
        { name: 'Deadlift', pct: 15, rating: { label: 'Alien', color: '#0F766E' }, detail: '100 kg to 115 kg' }
      ],
      reps: []
    }
  }]
};
const storedHtml = D.snapshotHtml(stored);
assert.deepStrictEqual(fillWidths(storedHtml), ['50', '100', '100']);
assert.ok(storedHtml.indexOf('>5% · Excellent<') >= 0);
assert.ok(storedHtml.indexOf('>10% · Elite<') >= 0);
assert.ok(storedHtml.indexOf('>15% · Alien<') >= 0);
assert.strictEqual((storedHtml.match(/background:#0F766E/g) || []).length, 2);
const editorHtml = D.editorHtml({ strength: stored.cards[0].strength, workouts: { streak: 1 } }, ['strength'], { self: true });
assert.deepStrictEqual(fillWidths(editorHtml), ['50', '100', '100']);
assert.ok(editorHtml.indexOf('>15% · Alien<') >= 0);

assert.deepStrictEqual(D.STANDARD, ['plan', 'workouts', 'volume', 'strength', 'calendar', 'holds', 'circuit']);
assert.deepStrictEqual(D.CARDS, ['plan', 'workouts', 'volume', 'strength', 'records', 'calendar', 'holds', 'stopwatch', 'pass', 'circuit']);
assert.strictEqual(D.CARDS.length, 10);
assert.strictEqual(D.CARD_LABEL.circuit, 'Circuit');
['records', 'stopwatch', 'pass'].forEach(function (id) {
  assert.ok(D.CARDS.indexOf(id) >= 0);
  assert.ok(D.STANDARD.indexOf(id) < 0);
});

function hold(over) {
  return set(Object.assign({
    mode: 'static_hold', exerciseName: 'Plank', libraryExerciseId: 'plank',
    plannedReps: null, plannedWeightKg: null, actualReps: null, actualWeightKg: null,
    plannedBodyweight: true, actualBodyweight: true, displayUnit: 'bodyweight',
    plannedHoldSec: 30, actualHoldSec: 30
  }, over));
}
function watch(over) {
  return set(Object.assign({
    mode: 'stopwatch', exerciseName: 'Sprint', libraryExerciseId: 'sprint',
    plannedReps: null, plannedWeightKg: null, actualReps: null, actualWeightKg: null,
    plannedBodyweight: true, actualBodyweight: true, displayUnit: 'bodyweight',
    actualTotalSec: 90, actualLaps: [{ n: 1, lapSec: 10, totalSec: 10 }]
  }, over));
}
const bests = model([
  hold({ sessionId: 'h1', localDate: '2026-11-02', actualHoldSec: 40, startedAt: 1 }),
  hold({ sessionId: 'h2', localDate: '2026-11-05', actualHoldSec: 75, startedAt: 2 }),
  hold({ sessionId: 'h3', localDate: '2026-11-10', actualHoldSec: 75, startedAt: 3 }),
  hold({ sessionId: 'h4', localDate: '2026-10-28', actualHoldSec: 90, libraryExerciseId: 'wall', exerciseName: 'Wall sit', startedAt: 4 }),
  hold({ sessionId: 'h5', localDate: '2025-11-01', actualHoldSec: 20, libraryExerciseId: 'dead', exerciseName: 'Dead hang', startedAt: 5 }),
  hold({ sessionId: 'skip', localDate: '2026-11-12', actualHoldSec: 200, status: 'skipped', libraryExerciseId: 'skip', exerciseName: 'Skipped hold' }),
  hold({ sessionId: 'zero', localDate: '2026-11-12', actualHoldSec: 0, libraryExerciseId: 'zero-hold', exerciseName: 'Zero hold' }),
  hold({ sessionId: 'gone', removed: true, actualHoldSec: 500, libraryExerciseId: 'gone', exerciseName: 'Removed hold' }),
  set({ sessionId: 'reps', actualReps: 10 }),
  watch({ sessionId: 's1', localDate: '2026-11-01', actualTotalSec: 90, startedAt: 10 }),
  watch({ sessionId: 's2', localDate: '2026-11-14', actualTotalSec: 72.4, startedAt: 11 }),
  watch({ sessionId: 's3', localDate: '2026-11-07', actualTotalSec: 72.4, startedAt: 9, setNumber: 2 }),
  watch({ sessionId: 's4', localDate: '2026-11-14', actualTotalSec: 80, startedAt: 12, setNumber: 2 }),
  watch({ sessionId: 'lap', localDate: '2026-11-15', libraryExerciseId: 'lap', exerciseName: 'Shuttle', actualTotalSec: 40, startedAt: 13, actualLaps: [{ n: 1, lapSec: 5, totalSec: 5 }] }),
  watch({ sessionId: 'slow', status: 'skipped', actualTotalSec: 1, libraryExerciseId: 'slow', exerciseName: 'Skipped sprint' }),
  watch({ sessionId: 'none', actualTotalSec: 0, libraryExerciseId: 'none', exerciseName: 'Zero sprint' })
], [session('bests', '2026-11-14')]);
assert.deepStrictEqual(bests.holds.map(function (row) { return [row.name, row.value, row.date, row.dateLabel]; }), [
  ['Plank', '1:15', '2026-11-05', 'Nov 5'],
  ['Wall sit', '1:30', '2026-10-28', 'Oct 28'],
  ['Dead hang', '0:20', '2025-11-01', 'Nov 1, 2025']
]);
assert.deepStrictEqual(bests.stopwatch.map(function (row) { return [row.name, row.value, row.date, row.dateLabel]; }), [
  ['Shuttle', '00:40.00', '2026-11-15', 'Nov 15'],
  ['Sprint', '01:12.40', '2026-11-07', 'Nov 7']
]);
assert.ok(!bests.holds.some(function (row) { return row.name === 'Skipped hold' || row.name === 'Zero hold' || row.name === 'Removed hold' || row.name === 'Squat'; }));
assert.ok(!bests.stopwatch.some(function (row) { return row.name === 'Skipped sprint' || row.name === 'Zero sprint' || row.value === '00:05.00'; }));
const bestsHtml = D.html(bests);
assert.ok(bestsHtml.indexOf('No holds yet.') < 0);
assert.ok(bestsHtml.indexOf('No times yet.') < 0);
assert.ok(bestsHtml.indexOf('id="dashboard-stopwatch"') < 0);
assert.ok(bestsHtml.indexOf('id="dashboard-records"') < 0);
assert.ok(bestsHtml.indexOf('id="dashboard-calendar"') < bestsHtml.indexOf('id="dashboard-holds"'));
assert.ok(bestsHtml.indexOf('pass rate') < 0);
const pickedTimes = D.editorHtml(bests, ['holds', 'stopwatch', 'records', 'pass'], { self: true });
assert.ok(pickedTimes.indexOf('No times yet.') < 0);
assert.ok(pickedTimes.indexOf('id="dashboard-holds"') < pickedTimes.indexOf('id="dashboard-stopwatch"'));
assert.ok(pickedTimes.indexOf('id="dashboard-records"') >= 0);
assert.ok(pickedTimes.indexOf('id="dashboard-pass"') >= 0);
const quietTimes = model([set()], [session('s1', '2026-11-10')]);
assert.deepStrictEqual(quietTimes.holds, []);
assert.deepStrictEqual(quietTimes.stopwatch, []);
assert.strictEqual((D.html(quietTimes).match(/No holds yet\./g) || []).length, 1);
assert.strictEqual((D.html(quietTimes).match(/No times yet\./g) || []).length, 0);
assert.strictEqual((D.editorHtml(quietTimes, ['stopwatch'], { self: true }).match(/No times yet\./g) || []).length, 1);
assert.deepStrictEqual(fixture.holds.map(function (row) { return [row.name, row.value, row.dateLabel]; }), [['Plank', '1:15', 'Nov 5']]);
assert.deepStrictEqual(fixture.stopwatch.map(function (row) { return [row.name, row.value, row.dateLabel]; }), [['Court sprint', '01:12.40', 'Nov 14']]);
const frozenBests = D.freeze(bests, ['holds', 'stopwatch'], { asOf: '2026-11-16', trainerName: 'coach@example.com' });
bests.holds = [];
bests.stopwatch = [];
assert.strictEqual(frozenBests.trainerName, 'Trainer');
assert.strictEqual(frozenBests.cards[0].holds[0].value, '1:15');
assert.strictEqual(frozenBests.cards[0].holds[0].date, '2026-11-05');
assert.strictEqual(frozenBests.cards[1].stopwatch[0].name, 'Shuttle');
assert.ok(!Object.prototype.hasOwnProperty.call(frozenBests.cards[0].holds[0], 'startedAt'));
const frozenBestHtml = D.snapshotHtml(frozenBests);
assert.ok(frozenBestHtml.indexOf('Wall sit') >= 0);
assert.ok(frozenBestHtml.indexOf('01:12.40') >= 0);
assert.ok(frozenBestHtml.indexOf('Nov 1, 2025') >= 0);
assert.ok(frozenBestHtml.indexOf('@') < 0);
const addTimes = D.editorHtml(bests, ['plan'], { self: true, editing: true });
assert.ok(addTimes.indexOf('data-card-add="holds"') >= 0);
assert.ok(addTimes.indexOf('data-card-add="stopwatch"') >= 0);
assert.ok(addTimes.indexOf('>Static holds<') >= 0);
assert.ok(addTimes.indexOf('>Stopwatch<') >= 0);
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261117120000_dashboard_holds_stopwatch.sql'), 'utf8');
assert.ok(/jsonb_array_length\(cards\) <= 9/.test(migration));
assert.ok(/jsonb_array_length\(cards\) between 1 and 9/.test(migration));
assert.ok(/jsonb_array_length\(new\.cards\) > 9/.test(migration));
assert.ok(/'holds', 'stopwatch'/.test(migration));
assert.ok(/private\.shown_name/.test(migration));
assert.ok(/position\('@' in new\.trainer_name\)/.test(migration));
assert.ok(/drop constraint if exists dashboard_layouts_cards_array/.test(migration));
assert.ok(/drop constraint if exists shared_dashboards_cards_array/.test(migration));
assert.ok(!/create policy/i.test(migration));
assert.ok(!/enable row level security/i.test(migration));
assert.ok(/input\.cards\.length > 10/.test(authSrc));
const circuitMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261125130000_circuit_history.sql'), 'utf8');
assert.ok(/jsonb_array_length\(cards\) <= 10/.test(circuitMigration));
assert.ok(/jsonb_array_length\(cards\) between 1 and 10/.test(circuitMigration));
assert.ok(/jsonb_array_length\(new\.cards\) > 10/.test(circuitMigration));
assert.ok(/'pass', 'circuit'/.test(circuitMigration));
assert.ok(!/cards\.length > 7/.test(authSrc));
assert.strictEqual((appSrc.match(/workouts: dashboardWorkouts\(\)/g) || []).length, 2);
assert.strictEqual((appSrc.match(/schemaVersion: data && data.version/g) || []).length, 2);
assert.ok(/schemaVersion: window\.WB && WB\.SCHEMA_VERSION/.test(appSrc));
assert.ok(/workouts: pair\[2\] \|\| \[\]/.test(appSrc));
assert.ok(/function clientDashboardWorkouts\(/.test(appSrc));
assert.ok(/clientAccountWorkouts/.test(appSrc));
assert.ok(/actual_hold_sec/.test(dashSrc));
assert.ok(!/plannedWorkSec/.test(dashSrc.slice(dashSrc.indexOf('function holdSeconds'), dashSrc.indexOf('function speedSeconds'))), 'a missing logged time is not filled in from the plan');

function timed(over) {
  return set(Object.assign({
    mode: 'timer', exerciseName: 'Handstand', libraryExerciseId: '', personalExerciseId: 'hs-1',
    stableKey: 'ex_handstand', plannedReps: null, plannedRepsMin: null, plannedRepsMax: null,
    actualReps: null, plannedWeightKg: null, actualWeightKg: null,
    plannedBodyweight: true, actualBodyweight: true, displayUnit: 'bodyweight',
    plannedHoldSec: null, actualHoldSec: null, plannedWorkSec: 45, actualWorkSec: 45, plannedRestSec: 15
  }, over));
}
function defs() {
  return [{
    id: 'wo_skill',
    name: 'Skill',
    items: [
      { id: 'ex_handstand', name: 'Handstand', mode: 'timer', modeConfig: { workSec: 45, restSec: 15, repsType: 'static' }, media: null },
      { id: 'ex_hollow', name: 'Hollow', mode: 'timer', modeConfig: { workSec: 20, restSec: 10, repsType: null }, media: null },
      { id: 'ex_hang', name: 'Dead hang', mode: 'intervals', modeConfig: { workSec: 20, repsType: 'static' }, media: null },
      { id: 'ex_swing', name: 'Swing', mode: 'timer', modeConfig: { workSec: 30, restSec: 15, repsType: 'number', count: 12 }, media: { kind: 'library', libraryId: '0101', view: '180' } },
      { id: 'ex_pike', name: 'Pike', mode: 'timer', modeConfig: { workSec: 20, restSec: 10, repsType: null }, media: { kind: 'library', libraryId: 'hold', view: '180' } },
      { id: 'ex_lib_hs', name: 'Handstand', mode: 'timer', modeConfig: { workSec: 30, restSec: 10, repsType: 'static' }, media: { kind: 'library', libraryId: 'hold', view: '180' } }
    ]
  }];
}
const handstandDay = model([
  timed({ sessionId: 'hs-short', localDate: '2026-11-18', actualWorkSec: 38, startedAt: 20, setNumber: 1 }),
  timed({ sessionId: 'hs-long', localDate: '2026-11-17', actualWorkSec: 50, startedAt: 19, setNumber: 1 }),
  timed({ sessionId: 'hs-tie-new', localDate: '2026-11-12', actualWorkSec: 40, startedAt: 12, setNumber: 2 }),
  timed({ sessionId: 'hs-tie-old', localDate: '2026-11-01', actualWorkSec: 40, startedAt: 2, setNumber: 1 }),
  timed({ sessionId: 'hs-skip', localDate: '2026-11-18', actualWorkSec: 90, status: 'skipped' }),
  timed({ sessionId: 'hs-zero', localDate: '2026-11-18', actualWorkSec: 0 }),
  timed({ sessionId: 'hs-plan', localDate: '2026-11-18', actualWorkSec: null, plannedWorkSec: 90 }),
  timed({
    sessionId: 'hollow', localDate: '2026-11-18', exerciseName: 'Hollow', personalExerciseId: 'hol-1',
    stableKey: 'ex_hollow', actualWorkSec: 40, plannedWorkSec: 20, startedAt: 21
  }),
  timed({
    sessionId: 'hang', localDate: '2026-11-16', exerciseName: 'Dead hang', personalExerciseId: 'hang-1',
    stableKey: 'ex_hang', mode: 'intervals', actualWorkSec: 22, plannedWorkSec: 20, plannedRestSec: null, startedAt: 16
  }),
  timed({
    sessionId: 'swing', localDate: '2026-11-18', exerciseName: 'Swing', libraryExerciseId: '0101',
    personalExerciseId: '', stableKey: '', plannedReps: 12, actualReps: 12, actualWorkSec: 30, startedAt: 22
  }),
  hold({ sessionId: 'plank', localDate: '2026-11-05', actualHoldSec: 75, startedAt: 5 })
], [session('hs-long', '2026-11-17')], [], defs());
assert.deepStrictEqual(handstandDay.holds.map(function (row) { return [row.name, row.value, row.date, row.dateLabel]; }), [
  ['Handstand', '0:50', '2026-11-17', 'Nov 17'],
  ['Dead hang', '0:22', '2026-11-16', 'Nov 16'],
  ['Plank', '1:15', '2026-11-05', 'Nov 5']
]);
assert.ok(!handstandDay.holds.some(function (row) { return row.name === 'Hollow' || row.name === 'Swing'; }));
assert.deepStrictEqual(handstandDay.strength, { weight: [], reps: [] });
assert.deepStrictEqual(handstandDay.records.map(function (row) { return [row.name, row.badge, row.value]; }), [
  ['Plank', 'Longest hold', '1:15 hold']
]);
assert.deepStrictEqual(handstandDay.stopwatch, []);
assert.strictEqual(handstandDay.volume.weekKg, 0);
assert.strictEqual(handstandDay.plan.total, 11);
assert.strictEqual(handstandDay.plan.hits, 4, 'the plan still scores work time, and a time-only timer still counts');
assert.strictEqual(D.hitPlan(timed({ actualWorkSec: 12, actualHoldSec: 12 })), D.hitPlan(timed({ actualWorkSec: 12, actualHoldSec: null })));
assert.strictEqual(D.hitPlan(timed({ actualWorkSec: 45, actualHoldSec: 45 })), true);

const marked = model([
  timed({ sessionId: 'marked', localDate: '2026-11-18', actualWorkSec: 50, actualHoldSec: 10, startedAt: 3 }),
  timed({ sessionId: 'copied', localDate: '2026-11-10', actualWorkSec: null, actualHoldSec: 16, plannedWorkSec: 45, stableKey: 'ex_missing', personalExerciseId: 'gone', startedAt: 2 }),
  timed({ sessionId: 'was-reps', localDate: '2026-11-18', actualWorkSec: 60, plannedReps: 8, actualReps: 8, actualHoldSec: 60, stableKey: 'ex_handstand' })
], [session('marked', '2026-11-18')]);
assert.deepStrictEqual(marked.holds.map(function (row) { return [row.name, row.value, row.date]; }), [
  ['Handstand', '0:50', '2026-11-18'],
  ['Handstand', '0:16', '2026-11-10']
]);
const tied = model([
  timed({ sessionId: 'tie-new', localDate: '2026-11-10', actualWorkSec: 40, actualHoldSec: 40, startedAt: 5, setNumber: 2 }),
  timed({ sessionId: 'tie-old', localDate: '2026-11-02', actualWorkSec: 40, actualHoldSec: 40, startedAt: 4, setNumber: 1 })
], [session('tie-new', '2026-11-10')]);
assert.deepStrictEqual(tied.holds.map(function (row) { return [row.value, row.date]; }), [['0:40', '2026-11-02']]);

const renamed = model([
  timed({
    sessionId: 'lib-hs', localDate: '2026-11-18', exerciseName: 'Handstand', libraryExerciseId: 'hold',
    personalExerciseId: '', stableKey: '', actualWorkSec: 33, startedAt: 4
  }),
  timed({
    sessionId: 'lib-pike', localDate: '2026-11-18', exerciseName: 'Pike', libraryExerciseId: 'hold',
    personalExerciseId: '', stableKey: '', actualWorkSec: 80, startedAt: 5
  }),
  timed({
    sessionId: 'lib-renamed', localDate: '2026-11-09', exerciseName: 'HS', libraryExerciseId: 'only',
    personalExerciseId: '', stableKey: '', actualWorkSec: 27, startedAt: 1
  }),
  timed({
    sessionId: 'conflict', localDate: '2026-11-18', exerciseName: 'Handstand', libraryExerciseId: '',
    personalExerciseId: 'conflict', stableKey: 'ex_handstand', actualWorkSec: 99, startedAt: 9
  })
], [session('lib', '2026-11-18')], [], [{
  items: [
    { id: 'ex_lib_hs', name: 'Handstand', mode: 'timer', modeConfig: { repsType: 'static', workSec: 30, restSec: 10 }, media: { kind: 'library', libraryId: 'hold' } },
    { id: 'ex_pike', name: 'Pike', mode: 'timer', modeConfig: { repsType: null, workSec: 20, restSec: 10 }, media: { kind: 'library', libraryId: 'hold' } },
    { id: 'ex_only', name: 'Handstand', mode: 'timer', modeConfig: { repsType: 'static', workSec: 30, restSec: 10 }, media: { kind: 'library', libraryId: 'only' } }
  ]
}, {
  items: JSON.stringify([{ id: 'ex_handstand', name: 'Handstand', mode: 'timer', modeConfig: { repsType: null } }, { id: 'ex_handstand', name: 'Handstand', mode: 'timer', modeConfig: { repsType: 'static' } }])
}]);
assert.deepStrictEqual(renamed.holds.map(function (row) { return [row.name, row.value]; }), [
  ['Handstand', '0:33'],
  ['HS', '0:27']
]);
assert.ok(!renamed.holds.some(function (row) { return row.name === 'Pike'; }));

const stillStatic = model([
  timed({ sessionId: 'kept', localDate: '2026-11-18', actualWorkSec: 41, actualHoldSec: 41 })
], [session('kept', '2026-11-18')], [], [{ items: [{ id: 'ex_handstand', name: 'Handstand', mode: 'timer', modeConfig: { repsType: null, workSec: 45, restSec: 15 } }] }]);
assert.deepStrictEqual(stillStatic.holds.map(function (row) { return row.value; }), ['0:41']);

const piped = H.fromRows(
  [
    { id: 'ses-hs', local_date: '2026-11-18', started_at: '2026-11-18T15:00:00.000Z', status: 'completed', workout_name: 'Skill' },
    { id: 'ses-hol', local_date: '2026-11-18', started_at: '2026-11-18T15:10:00.000Z', status: 'completed', workout_name: 'Skill' }
  ],
  [
    {
      session_id: 'ses-hs', personal_exercise_id: '11111111-1111-4111-8111-111111111111',
      exercise_name: 'Handstand', mode: 'timer', set_number: 1, status: 'completed',
      display_unit: 'bodyweight', planned_bodyweight: true, actual_bodyweight: true,
      planned_reps: null, actual_reps: null, planned_hold_sec: null, actual_hold_sec: null,
      planned_work_sec: 45, actual_work_sec: 38, planned_rest_sec: 15
    },
    {
      session_id: 'ses-hol', personal_exercise_id: '22222222-2222-4222-8222-222222222222',
      exercise_name: 'Hollow', mode: 'timer', set_number: 1, status: 'completed',
      display_unit: 'bodyweight', planned_bodyweight: true, actual_bodyweight: true,
      planned_work_sec: 20, actual_work_sec: 40, planned_rest_sec: 10
    }
  ],
  [
    { id: '11111111-1111-4111-8111-111111111111', stable_key: 'ex_handstand' },
    { id: '22222222-2222-4222-8222-222222222222', stable_key: 'ex_hollow' }
  ]
);
const pipedModel = D.build({
  sets: piped,
  sessions: [
    { id: 'ses-hs', local_date: '2026-11-18', status: 'completed' },
    { id: 'ses-hol', local_date: '2026-11-18', status: 'completed' }
  ],
  workouts: defs(),
  now: new Date(2026, 10, 18, 16, 0, 0)
});
assert.strictEqual(piped[0].stableKey, 'ex_handstand');
assert.strictEqual(piped[0].actualHoldSec, null);
assert.strictEqual(piped[0].actualWorkSec, 38);
assert.deepStrictEqual(pipedModel.holds.map(function (row) { return [row.name, row.value, row.dateLabel]; }), [
  ['Handstand', '0:38', 'Nov 18']
]);

const frozenHandstand = D.freeze(handstandDay, ['holds'], { asOf: '2026-11-18', trainerName: 'coach@example.com' });
handstandDay.holds = [];
assert.strictEqual(frozenHandstand.trainerName, 'Trainer');
assert.deepStrictEqual(frozenHandstand.cards[0].holds.map(function (row) { return [row.name, row.value, row.date, row.dateLabel]; }), [
  ['Handstand', '0:50', '2026-11-17', 'Nov 17'],
  ['Dead hang', '0:22', '2026-11-16', 'Nov 16'],
  ['Plank', '1:15', '2026-11-05', 'Nov 5']
]);
assert.ok(!Object.prototype.hasOwnProperty.call(frozenHandstand.cards[0].holds[0], 'startedAt'));
const frozenHandstandHtml = D.snapshotHtml(frozenHandstand);
assert.ok(frozenHandstandHtml.indexOf('Handstand') >= 0);
assert.ok(frozenHandstandHtml.indexOf('0:50') >= 0);
assert.ok(frozenHandstandHtml.indexOf('Hollow') < 0);
assert.ok(frozenHandstandHtml.indexOf('@') < 0);

const legacyDoc = model([
  timed({ sessionId: 'old-doc', localDate: '2026-11-18', actualWorkSec: 38 }),
  hold({ sessionId: 'pl', localDate: '2026-11-05', actualHoldSec: 75 })
], [session('old-doc', '2026-11-18')], [], defs(), 3);
assert.deepStrictEqual(legacyDoc.holds.map(function (row) { return row.name; }), ['Plank']);
const mixedSchema = model([
  timed({
    sessionId: 'legacy-ex', localDate: '2026-11-18', exerciseName: 'Old plank',
    personalExerciseId: 'old', stableKey: 'ex_old', actualWorkSec: 30
  }),
  timed({ sessionId: 'chosen', localDate: '2026-11-18', actualWorkSec: 38 })
], [session('legacy-ex', '2026-11-18')], [], [
  { version: 3, items: [{ id: 'ex_old', name: 'Old plank', mode: 'timer', modeConfig: { workSec: 30, restSec: 0, repsType: 'static' } }] },
  { items: [{ id: 'ex_handstand', name: 'Handstand', mode: 'timer', modeConfig: { workSec: 45, restSec: 15, repsType: 'static' } }] }
], 4);
assert.deepStrictEqual(mixedSchema.holds.map(function (row) { return row.name; }), ['Handstand']);
const sharedLegacy = model([
  timed({ sessionId: 'same', localDate: '2026-11-18', actualWorkSec: 38 }),
  timed({
    sessionId: 'same-lib', localDate: '2026-11-18', exerciseName: 'Handstand',
    libraryExerciseId: 'hold', personalExerciseId: '', stableKey: '', actualWorkSec: 33
  })
], [session('same', '2026-11-18')], [], [
  { version: 3, items: [
    { id: 'ex_handstand', name: 'Handstand', mode: 'timer', modeConfig: { workSec: 45, restSec: 15, repsType: 'static' } },
    { id: 'old-lib', name: 'Handstand', mode: 'timer', modeConfig: { repsType: 'static', workSec: 30, restSec: 10 }, media: { kind: 'library', libraryId: 'hold' } }
  ] },
  { items: [
    { id: 'ex_handstand', name: 'Handstand', mode: 'timer', modeConfig: { workSec: 45, restSec: 15, repsType: 'static' } },
    { id: 'new-lib', name: 'Handstand', mode: 'timer', modeConfig: { repsType: 'static', workSec: 30, restSec: 10 }, media: { kind: 'library', libraryId: 'hold' } }
  ] }
], 4);
assert.deepStrictEqual(sharedLegacy.holds.map(function (row) { return [row.name, row.value]; }), [
  ['Handstand', '0:38'],
  ['Handstand', '0:33']
]);

console.log('DASHBOARD OK');
