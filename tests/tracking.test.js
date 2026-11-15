// Finished-session payload. Does not touch a database or the network.
const assert = require('assert');
const T = require('../tracking.js');
const P = require('../programs.js');

const ended = new Date(2026, 10, 15, 18, 30, 0).getTime();
const started = ended - 20 * 60 * 1000;
const squat = {
  id: 'ex_squat', name: 'Squat', sets: 2,
  weight: { unit: 'lb', value: 135 },
  mode: 'reps', modeConfig: { repsType: 'number', count: 10, restSec: 60 }
};
const plank = {
  id: 'ex_plank', name: 'Plank', sets: 1,
  weight: { unit: 'bodyweight', value: null },
  mode: 'reps', modeConfig: { repsType: 'static', restSec: 0 }
};
const swing = {
  id: 'ex_swing', name: 'Swing', sets: 1,
  weight: { unit: 'kg', value: 16 },
  mode: 'timer', modeConfig: { workSec: 30, restSec: 15, repsType: 'number', count: 12 },
  media: { kind: 'library', libraryId: '0101', view: '180' }
};
const shuttle = {
  id: 'ex_shuttle', name: 'Shuttle', sets: 1,
  weight: { unit: 'bodyweight', value: null },
  mode: 'stopwatch',
  modeConfig: {
    lapsEnabled: true, lapCount: 2,
    events: [{ lap: 1, name: 'Finish line' }, { lap: 2, name: 'Unused' }]
  }
};
const workout = {
  id: 'wo_am', name: 'Morning', sourceTrainerId: null,
  items: [squat, plank, swing, shuttle]
};
const queue = [
  { exerciseId: 'ex_squat', set: 1, of: 2, groupId: 'ss1' },
  { exerciseId: 'ex_plank', set: 1, of: 1, groupId: 'ss1' },
  { exerciseId: 'ex_swing', set: 1, of: 1, groupId: null },
  { exerciseId: 'ex_shuttle', set: 1, of: 1, groupId: null }
];
// The player keeps one result per step. A redo overwrites it, so only the last attempt is here.
const results = {
  0: { step: 0, name: 'Squat', set: 1, mode: 'reps', unit: 'lb', weight: 140, reps: 11, logged: true },
  1: { step: 1, name: 'Plank', set: 1, mode: 'reps', unit: 'bodyweight', weight: null, holdSec: 42, logged: true },
  2: { step: 2, name: 'Swing', set: 1, mode: 'timer', unit: 'kg', weight: 16, workSec: 12, reps: 9, rounds: 1, logged: true },
  3: {
    step: 3, name: 'Shuttle', set: 1, mode: 'stopwatch', unit: 'bodyweight', logged: true,
    durationMs: 6984,
    laps: [{ lapMs: 3210, totalMs: 3210 }, { lapMs: 3774, totalMs: 6984 }],
    eventResults: { 1: 'pass' }
  }
};

assert.strictEqual(T.toKg(140, 'lb'), 140 * T.LB_TO_KG);
assert.strictEqual(T.toKg(16, 'kg'), 16);
assert.strictEqual(T.toKg(99, 'bodyweight'), null);
assert.strictEqual(T.toKg(-1, 'lb'), null);
assert.strictEqual(T.build({ track: false, id: 'ses_1', workout: workout, queue: queue, results: results, startedAt: started, endedAt: ended }), null);

const early = T.build({
  track: true, id: 'ses_early', workout: workout, queue: queue.slice(0, 2),
  results: { 0: results[0] },
  startedAt: started, endedAt: ended, programId: 'pg1', ownWork: true, timeZone: 'America/New_York'
});
assert.strictEqual(early.session.status, 'ended_early');
assert.strictEqual(early.session.localDate, P.localDay(ended));
assert.strictEqual(early.session.programId, 'pg1');
assert.strictEqual(early.session.origin, 'own');
assert.strictEqual(early.sets.length, 2);
assert.strictEqual(early.sets[0].status, 'completed');
assert.strictEqual(early.sets[0].stableKey, 'ex_squat');
assert.strictEqual(early.sets[0].libraryExerciseId, null);
assert.strictEqual(early.sets[0].groupTag, 'ss1');
assert.strictEqual(early.sets[0].actualReps, 11);
assert.strictEqual(early.sets[0].plannedReps, 10);
assert.strictEqual(early.sets[0].actualWeight, 140);
assert.strictEqual(early.sets[0].displayUnit, 'lb');
assert.strictEqual(early.sets[1].status, 'skipped');
assert.strictEqual(early.sets[1].actualHoldSec, null);
assert.strictEqual(early.sets.filter(function (row) { return row.step === 0; }).length, 1);

const renamed = T.build({
  track: true, id: 'ses_name', workout: Object.assign({}, workout, { items: [Object.assign({}, squat, { name: 'Back squat' })] }),
  queue: [{ exerciseId: 'ex_squat', set: 1, of: 1, groupId: null }],
  results: { 0: Object.assign({}, results[0], { name: 'Back squat' }) },
  startedAt: started, endedAt: ended, ownWork: true, timeZone: 'UTC'
});
assert.strictEqual(renamed.sets[0].stableKey, early.sets[0].stableKey);
assert.strictEqual(renamed.sets[0].exerciseName, 'Back squat');

const full = T.build({
  track: true, id: 'ses_full', workout: workout, queue: queue, results: results,
  startedAt: started, endedAt: ended, ownWork: false, timeZone: 'UTC'
});
assert.strictEqual(full.session.status, 'completed');
assert.strictEqual(full.session.origin, 'trainer');
assert.strictEqual(full.sets[1].mode, 'static_hold');
assert.strictEqual(full.sets[1].actualHoldSec, 42);
assert.strictEqual(full.sets[1].actualBodyweight, true);
assert.strictEqual(full.sets[1].actualWeight, null);
assert.strictEqual(full.sets[1].stableKey, 'ex_plank');
assert.strictEqual(full.sets[2].libraryExerciseId, '0101');
assert.strictEqual(full.sets[2].stableKey, null);
assert.strictEqual(full.sets[2].plannedWorkSec, 30);
assert.strictEqual(full.sets[2].plannedRestSec, 15);
assert.strictEqual(full.sets[2].actualWorkSec, 12);
assert.strictEqual(full.sets[2].actualRestSec, null);
assert.strictEqual(full.sets[2].actualRounds, 1);
assert.strictEqual(full.sets[2].actualReps, 9);
assert.strictEqual(full.sets[3].mode, 'stopwatch');
assert.strictEqual(full.sets[3].actualTotalSec, 6.984);
assert.deepStrictEqual(full.sets[3].actualLaps, [
  { n: 1, lapSec: 3.21, totalSec: 3.21 },
  { n: 2, lapSec: 3.774, totalSec: 6.984 }
]);
assert.deepStrictEqual(full.sets[3].actualEvents, [{ lap: 1, name: 'Finish line', result: 'pass' }]);
assert.deepStrictEqual(full.sets[3].plannedEvents, [
  { lap: 1, name: 'Finish line' },
  { lap: 2, name: 'Unused' }
]);

const day = P.localDay(ended);
const localSession = {
  id: 'ses_full', workoutId: 'wo_am', workoutName: 'Morning', programId: 'pg1',
  startedAt: started, endedAt: ended, ownWork: true,
  results: [{ logged: true, name: 'Squat' }]
};
assert.strictEqual(P.entryDone({ id: 'pg1', workoutId: 'wo_am', date: day }, [localSession]), true);
assert.strictEqual(P.entryDone({ id: 'other', workoutId: 'wo_am', date: day }, [localSession]), true);
assert.strictEqual(P.entryDone({ id: 'other', workoutId: 'wo_am', date: '2026-11-16' }, [localSession]), false);
assert.strictEqual(T.note({ results: [] }, false), 'Nothing was logged.');
assert.strictEqual(T.note({ results: [{ logged: true }] }, true), 'Session saved.');
assert.strictEqual(T.note({ results: [{ logged: true }] }, false), 'Session not saved.');
assert.strictEqual(T.note({ results: [{ logged: true }] }, null), '');

const calls = [];
global.WBAuth = {
  session: function () { calls.push('session'); return Promise.resolve({ user: { id: 'allow-test' } }); },
  saveTrackedSession: function () { calls.push('save'); return Promise.resolve({ ok: true }); }
};
T.save({ track: false, id: 'ses_1', workout: workout, queue: queue, results: results, startedAt: started, endedAt: ended }).then(function (preview) {
  assert.deepStrictEqual(preview, { ok: false });
  assert.deepStrictEqual(calls, []);
  return T.save({
    track: true, id: 'ses_full', workout: workout, queue: queue, results: results,
    startedAt: started, endedAt: ended, ownWork: true, timeZone: 'UTC'
  });
}).then(function (unsigned) {
  assert.deepStrictEqual(unsigned, { ok: false });
  assert.deepStrictEqual(calls, ['session']);
  global.WBAuth.session = function () {
    return Promise.resolve({ user: { id: '11111111-1111-4111-8111-111111111111' } });
  };
  global.WBAuth.saveTrackedSession = function () { return Promise.reject(new Error('schema cache')); };
  return T.save({
    track: true, id: 'ses_full', workout: workout, queue: queue, results: results,
    startedAt: started, endedAt: ended, ownWork: true, timeZone: 'UTC'
  });
}).then(function (missing) {
  assert.deepStrictEqual(missing, { ok: false });
  let seen = null;
  global.WBAuth.saveTrackedSession = function (payload) {
    seen = payload;
    return Promise.resolve({ ok: true, id: 'row-1' });
  };
  return T.save({
    track: true, id: 'ses_full', workout: workout, queue: queue, results: results,
    startedAt: started, endedAt: ended, ownWork: true, timeZone: 'UTC'
  }).then(function (ok) {
    assert.deepStrictEqual(ok, { ok: true, id: 'row-1' });
    assert.strictEqual(seen.sets.length, 4);
    assert.strictEqual(seen.sets[0].actualWeight, 140);
    assert.strictEqual(seen.sets[0].displayUnit, 'lb');
    console.log('TRACKING OK');
  });
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
