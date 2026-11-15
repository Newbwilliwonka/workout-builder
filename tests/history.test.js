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

const html = H.listHtml(sets, { stillBase: 'https://cdn.example.test/exercises' });
assert.ok(html.indexOf('Test account') < 0);
assert.ok(html.indexOf('https://cdn.example.test/exercises/still/0101.jpg') >= 0);
assert.ok(html.indexOf('data-history="lib-0101"') >= 0);
assert.ok(html.indexOf('No image') < 0);
const sprintRow = html.slice(html.indexOf('Court sprint') - 200, html.indexOf('Court sprint'));
assert.ok(sprintRow.indexOf('<img') < 0, 'an exercise with no picture has no thumbnail');

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
