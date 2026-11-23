// Exercise history: own sets, newest first, records. Sample rows stay in this test. No database.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const H = require('../history.js');
const sets = require('./history-fixture').sampleSets();

const appSrc = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const historySrc = fs.readFileSync(path.join(__dirname, '../history.js'), 'utf8');
assert.ok(!/Test account|Alex Rivera|sampleSets|FARMER_PHOTO/.test(historySrc), 'the app history file has no sample account');
assert.ok(!/historySample|sample=1|preview=history|WBHistory\.sampleSets/.test(appSrc), 'the app cannot open a sample history');
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
assert.ok(/id="tracking-open"[^>]*>Tracking</.test(indexHtml), 'the link row opens Tracking');
assert.ok(!/id="history-open"|data-a="history">History</.test(appSrc), 'History is no longer a workout-list button');
assert.ok(/id="dashboard-count"/.test(appSrc), 'Dashboard keeps a spot for a future count');
assert.ok(/Your trainer can share a dashboard with you\./.test(appSrc), 'a Free Client still sees a dashboard note');
assert.ok(!/Dashboard coming soon/.test(appSrc), 'the coming-soon note is replaced');
const list = H.list(sets);

assert.deepStrictEqual(list.map(function (row) { return row.name; }), [
  'Court sprint',
  'Barbell squat',
  'Farmer carry',
  'Face pull',
  'Bulgarian split squat',
  'Crunch',
  'Plank'
]);
assert.strictEqual(list[1].sessions, 4);
assert.strictEqual(list[1].lastLabel, 'Nov 12, 2026');
assert.strictEqual(list[1].libraryExerciseId, '0101');
assert.strictEqual(list[0].libraryExerciseId, '');
assert.ok(list[2].imageUrl.indexOf('data:image/png') === 0);
assert.strictEqual(list[0].imageUrl, '');
assert.deepStrictEqual(H.filter(list, '  SQUAT ').map(function (row) { return row.name; }), [
  'Barbell squat',
  'Bulgarian split squat'
]);
assert.strictEqual(H.filter(list, 'nope').length, 0);

const squat = H.detail(sets, 'lib-0101');
assert.strictEqual(squat.name, 'Barbell squat');
assert.deepStrictEqual(squat.days.map(function (day) { return day.label; }), [
  'Nov 12, 2026', 'Nov 8, 2026', 'Nov 1, 2026', 'Oct 22, 2026'
]);
const first = squat.days[0].sessions[0];
assert.strictEqual(first.name, 'Lower strength');
assert.strictEqual(first.sets.length, 3, 'removed set stays hidden');
assert.deepStrictEqual(first.sets.map(function (set) { return set.actual; }), [
  '3 × 225 lb',
  '8 × 185 lb',
  'Skipped'
]);
assert.deepStrictEqual(first.sets[0].badges, ['Heaviest']);
assert.strictEqual(first.sets[0].planned, '5 × 205 lb');
assert.deepStrictEqual(first.sets[1].badges, ['Most reps']);
assert.strictEqual(first.sets[1].planned, '6 × 185 lb');
assert.strictEqual(first.sets[2].skipped, true);
assert.strictEqual(first.sets[2].planned, '5 × 225 lb');
assert.ok(!/300/.test(JSON.stringify(squat)), 'removed weight is not a record');
assert.strictEqual(squat.days[1].sessions[0].sets[0].planned, '');
assert.strictEqual(squat.days[1].sessions[0].sets[1].actual, '5 × 205 lb');
assert.strictEqual(squat.days[1].sessions[0].sets[1].planned, '5 × 185 lb');

const sprint = H.detail(sets, 'own-c0ffee00-0000-4000-8000-000000000002');
const run = sprint.days[0].sessions[0].sets[0];
assert.strictEqual(run.actual, '01:12.40');
assert.ok(run.badges.indexOf('Fastest') >= 0);
assert.ok(run.badges.indexOf('Most passes') >= 0);
assert.strictEqual(run.planned, '5 laps');
assert.strictEqual(run.counts, '3 passes · 1 fail');
assert.strictEqual(run.laps[3].time, '00:17.35');
assert.strictEqual(run.laps[3].badge, 'Best lap');
assert.strictEqual(run.laps[1].badge, '');
assert.strictEqual(run.events[2], 'Lap 3 · Drop · Fail');
assert.strictEqual(sprint.days[1].sessions[0].sets[0].planned, '');
assert.ok(sprint.days[1].sessions[0].sets[0].badges.indexOf('Fastest') < 0);

const split = H.detail(sets, 'lib-1001');
assert.strictEqual(split.days[0].sessions[0].sets[0].actual, '12 × Bodyweight');
assert.deepStrictEqual(split.days[0].sessions[0].sets[0].badges, ['Most reps']);
assert.strictEqual(split.days[1].sessions[0].sets[0].planned, '');

const face = H.detail(sets, 'lib-0201');
assert.strictEqual(face.days[0].sessions[0].sets[0].actual, '0:40 work / 0:20 rest · 12 reps · 15 kg');
assert.strictEqual(face.days[0].sessions[0].sets[0].planned, '0:40 work / 0:15 rest · 12 reps · 15 kg');

const crunch = H.detail(sets, 'lib-0001');
assert.strictEqual(crunch.days[0].sessions[0].sets[0].actual, '0:30 work · 8 rounds · Bodyweight');
assert.strictEqual(crunch.days[0].sessions[0].sets[0].planned, '0:30 work · 10 rounds · Bodyweight');
assert.strictEqual(crunch.days[1].sessions[0].sets[0].planned, '');

const plank = H.detail(sets, 'own-c0ffee00-0000-4000-8000-000000000003');
assert.strictEqual(plank.days[0].sessions[0].sets[0].actual, '1:15 hold');
assert.deepStrictEqual(plank.days[0].sessions[0].sets[0].badges, ['Longest hold']);
assert.strictEqual(plank.days[0].sessions[0].sets[0].planned, '1:00 hold');
assert.strictEqual(plank.days[1].sessions[0].sets[0].actual, '0:45 hold');

function timerSet(over) {
  return Object.assign({
    sessionId: 't1', localDate: '2026-11-10', startedAt: 1, workoutName: 'Upper',
    exerciseName: 'Face pull', libraryExerciseId: '0201', mode: 'timer', displayUnit: 'kg',
    setNumber: 1, status: 'completed', removed: false,
    plannedWorkSec: 40, plannedRestSec: 15, plannedReps: 12, plannedWeightKg: 15,
    actualWorkSec: 40, actualReps: 12, actualWeightKg: 15, actualRestSec: null
  }, over);
}
const loggedRest = H.detail([timerSet()], 'lib-0201');
assert.strictEqual(loggedRest.days[0].sessions[0].sets[0].actual, '0:40 work / 0:15 rest · 12 reps · 15 kg');
assert.strictEqual(loggedRest.days[0].sessions[0].sets[0].planned, '');
const shortWork = H.detail([timerSet({ actualWorkSec: 30 })], 'lib-0201');
assert.strictEqual(shortWork.days[0].sessions[0].sets[0].actual, '0:30 work / 0:15 rest · 12 reps · 15 kg');
assert.strictEqual(shortWork.days[0].sessions[0].sets[0].planned, '0:40 work / 0:15 rest · 12 reps · 15 kg');
const rangedWork = H.detail([timerSet({
  plannedReps: null, plannedRepsMin: 8, plannedRepsMax: 12, actualReps: 10, actualWorkSec: 28
})], 'lib-0201');
assert.strictEqual(rangedWork.days[0].sessions[0].sets[0].planned, '0:40 work / 0:15 rest · 8–12 reps · 15 kg');
const rangedSame = H.detail([timerSet({
  plannedReps: null, plannedRepsMin: 8, plannedRepsMax: 12, actualReps: 10
})], 'lib-0201');
assert.strictEqual(rangedSame.days[0].sessions[0].sets[0].planned, '');
const rangedRounds = H.detail([timerSet({
  mode: 'intervals', libraryExerciseId: '0001', exerciseName: 'Crunch', displayUnit: 'bodyweight',
  plannedBodyweight: true, actualBodyweight: true, plannedWeightKg: null, actualWeightKg: null,
  plannedRestSec: null, actualRestSec: null, plannedWorkSec: 30, actualWorkSec: 30,
  plannedReps: null, plannedRepsMin: 8, plannedRepsMax: 12, actualReps: 10,
  plannedRounds: 10, actualRounds: 8
})], 'lib-0001');
assert.strictEqual(rangedRounds.days[0].sessions[0].sets[0].actual, '0:30 work · 8 rounds · 10 reps · Bodyweight');
assert.strictEqual(rangedRounds.days[0].sessions[0].sets[0].planned, '0:30 work · 10 rounds · 8–12 reps · Bodyweight');
const rangedReps = H.detail([{
  sessionId: 'r1', localDate: '2026-11-02', startedAt: 1, workoutName: 'Day',
  exerciseName: 'Row', libraryExerciseId: '0301', mode: 'reps', displayUnit: 'lb',
  setNumber: 1, status: 'completed', plannedRepsMin: 8, plannedRepsMax: 12, plannedWeightKg: 20,
  actualReps: 10, actualWeightKg: 20
}], 'lib-0301');
assert.strictEqual(rangedReps.days[0].sessions[0].sets[0].planned, '');

function ids(after, size, n) {
  var rows = [];
  var start = after == null ? 1 : after + 1;
  for (var i = 0; i < n; i++) rows.push({ id: start + i });
  return rows;
}
H.collectPages(function (after, size) {
  assert.strictEqual(after, null);
  assert.strictEqual(size, 2);
  return Promise.resolve({ data: [{ id: 1 }] });
}, 2).then(function (first) {
  assert.deepStrictEqual(first.data.map(function (row) { return row.id; }), [1]);
  return H.collectPages(function (after, size) {
    var n = after == null ? 2 : after === 2 ? 2 : 1;
    return Promise.resolve({ data: ids(after, size, n) });
  }, 2);
}).then(function (paged) {
  assert.deepStrictEqual(paged.data.map(function (row) { return row.id; }), [1, 2, 3, 4, 5]);
  return H.collectPages(function (after) {
    return Promise.resolve({ data: [{ id: 1 }, { id: 2 }] });
  }, 2);
}).then(function (stuck) {
  assert.strictEqual(stuck.data, null);
  assert.ok(stuck.error);
  return H.collectPages(function () {
    return Promise.resolve({ error: { message: 'relation workout_sets does not exist' } });
  }, 2);
}).then(function (failed) {
  assert.strictEqual(failed.data, null);
  assert.ok(/workout_sets/.test(failed.error.message));
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});

const html = H.listHtml(sets, { view: 'exercise', stillBase: 'https://cdn.example.test/exercises' });
assert.ok(html.indexOf('Test account') < 0);
assert.ok(html.indexOf('https://cdn.example.test/exercises/still2/0101.jpg') >= 0);
assert.ok(html.indexOf('data-history="lib-0101"') >= 0);
assert.ok(html.indexOf('No image') < 0);
assert.ok(html.indexOf('id="history-by-exercise" data-history-view="exercise" class="on"') >= 0);
const sprintRow = html.slice(html.indexOf('Court sprint') - 200, html.indexOf('Court sprint'));
assert.ok(sprintRow.indexOf('<img') < 0, 'an exercise with no picture has no thumbnail');

function powerLegs(id, date, started, n) {
  var rows = [];
  var i;
  for (i = 1; i <= n; i++) {
    rows.push({
      sessionId: id, localDate: date, startedAt: started, workoutName: 'Power Legs',
      exerciseName: i === 1 ? 'Squat' : 'Lunge', libraryExerciseId: i === 1 ? '0101' : '1001',
      mode: 'reps', displayUnit: 'lb', setNumber: i, status: 'completed', removed: false,
      plannedReps: 5, plannedWeightKg: 100, actualReps: 5, actualWeightKg: 100
    });
  }
  return rows;
}
const runs = powerLegs('leg-16', '2026-11-16', 1, 3).concat(powerLegs('leg-18', '2026-11-18', 2, 1));
const workoutRows = H.workouts(runs);
assert.deepStrictEqual(workoutRows.map(function (row) { return row.label; }), [
  'Wed Nov 18 · Power Legs',
  'Mon Nov 16 · Power Legs'
]);
assert.deepStrictEqual(workoutRows.map(function (row) { return row.sets; }), [1, 3]);
assert.notStrictEqual(workoutRows[0].id, workoutRows[1].id);
const workoutHtml = H.listHtml(runs);
assert.ok(workoutHtml.indexOf('id="history-by-workout" data-history-view="workout" class="on"') >= 0);
assert.ok(workoutHtml.indexOf('By exercise') >= 0);
assert.ok(workoutHtml.indexOf('Mon Nov 16 · Power Legs') >= 0);
assert.ok(workoutHtml.indexOf('Wed Nov 18 · Power Legs') >= 0);
assert.strictEqual((workoutHtml.match(/data-session="/g) || []).length, 2);
assert.ok(workoutHtml.indexOf('>3 sets<') >= 0);
assert.ok(workoutHtml.indexOf('>1 set<') >= 0);
assert.ok(workoutHtml.indexOf('data-history=') < 0);
const opened = H.sessionDetail(runs, 'leg-16');
assert.strictEqual(opened.label, 'Mon Nov 16 · Power Legs');
assert.deepStrictEqual(opened.exercises.map(function (exercise) { return exercise.name; }), ['Squat', 'Lunge']);
assert.strictEqual(opened.exercises[0].sets.length, 1);
assert.ok(H.sessionHtml(opened).indexOf('Squat') >= 0);
assert.ok(H.sessionHtml(opened).indexOf('Lunge') >= 0);
const squatSession = H.workouts(sets).filter(function (row) { return row.id === 'sq-1112'; })[0];
assert.strictEqual(squatSession.sets, 2, 'a skipped set is not a set that was done');
assert.strictEqual(squatSession.label, 'Thu Nov 12 · Lower strength');
const squatOpen = H.sessionDetail(sets, 'sq-1112');
assert.strictEqual(squatOpen.exercises[0].sets.length, 3, 'the opened session still shows the skipped set');
assert.strictEqual(H.listHtml(sets).indexOf('data-session="sp-1114"') >= 0, true);
assert.ok(H.listHtml(sets).indexOf('Sat Nov 14 · Conditioning') >= 0);

const empty = H.emptyHtml();
assert.ok(empty.indexOf('No history yet') >= 0);
assert.ok(empty.indexOf('Finish a workout and your sets will show up here.') >= 0);
assert.ok(empty.indexOf('Test account') < 0);
assert.ok(H.listHtml([]).indexOf('id="history-empty"') >= 0);

const remote = require('./history-fixture').remoteHistory(sets);
assert.ok(remote.sets.every(function (row) { return row.removed === false; }));
assert.strictEqual(H.list(H.fromRows(remote.sessions, remote.sets, remote.exercises)).length, list.length);

const joined = H.fromRows(
  [
    { id: 's1', local_date: '2026-11-02', started_at: '2026-11-02T15:00:00.000Z', workout_name: 'Day', status: 'completed' },
    { id: 's2', local_date: '2026-11-02', started_at: '2026-11-02T16:00:00.000Z', workout_name: 'Open', status: 'in_progress' }
  ],
  [
    { session_id: 's1', library_exercise_id: '0101', exercise_name: 'Barbell squat', mode: 'reps', set_number: 1, status: 'completed', display_unit: 'lb', actual_reps: 5, actual_weight_kg: 61.23497, planned_reps: 5, planned_weight_kg: 61.23497, removed: false },
    { session_id: 's1', library_exercise_id: '0101', exercise_name: 'Barbell squat', mode: 'reps', set_number: 2, status: 'completed', display_unit: 'lb', actual_reps: 1, actual_weight_kg: 136.077711, removed: true },
    { session_id: 's2', library_exercise_id: '0101', exercise_name: 'Barbell squat', mode: 'reps', set_number: 1, status: 'completed', display_unit: 'lb', actual_reps: 9, actual_weight_kg: 200, removed: false }
  ],
  []
);
assert.strictEqual(joined.length, 1);
assert.strictEqual(H.detail(joined, 'lib-0101').days[0].sessions[0].sets[0].actual, '5 × 135 lb');

console.log('HISTORY OK');
