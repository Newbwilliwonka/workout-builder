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
assert.ok(/collectPages/.test(authSrc.slice(authSrc.indexOf('mySchedule:'))), 'schedule reads page past 1000 rows');
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
function model(sets, sessions, entries) {
  return D.build({ sets: sets, sessions: sessions, entries: entries || [], now: NOW });
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
assert.ok(page.indexOf('Stopwatch') < 0);
assert.ok(page.indexOf('pass rate') < 0);
assert.ok(page.indexOf('Example data') < 0);
assert.ok(page.indexOf('<button') < 0);
assert.ok(page.indexOf('<input') < 0);
assert.ok(page.indexOf('id="dashboard-sheet"') >= 0);
var order = ['Hit the plan', 'Workouts and streak', 'Total volume', 'Recent personal records', 'Consistency · November 2026'].map(function (label) {
  return page.indexOf(label);
});
assert.ok(order.every(function (at) { return at >= 0; }));
assert.deepStrictEqual(order, order.slice().sort(function (a, b) { return a - b; }));
assert.ok(page.indexOf('id="dashboard-streak"') >= 0);
assert.ok(page.indexOf('Rest days do not break this streak.') >= 0);
assert.ok(page.indexOf('This week\'s goal: 4 workouts') >= 0);
assert.ok(page.indexOf('aria-label="0 workouts this week. Goal is 4."') >= 0);
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

console.log('DASHBOARD OK');
