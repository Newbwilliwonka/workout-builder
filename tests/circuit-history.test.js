// Payload, history wording, and the circuit dashboard card. No network.
const assert = require('assert');
const H = require('../circuit-history.js');
const History = require('../history.js');
const Dash = require('../dashboard.js');

const payload = H.payloadFromRecord({
  name: 'coach@example.com',
  circuitId: 'circ 1',
  clock: { workSec: 40, moveSec: 15 },
  stations: [{ id: 'st_squat', name: 'Squat', libraryId: 'squat1' }],
  people: [
    { source: 'linked', id: '22222222-2222-4222-8222-222222222222', name: 'Ada', rounds: [{ stationId: 'st_squat', workSec: 40 }] },
    { source: 'manual', name: 'ada@example.com', rounds: [{ stationId: 'st_squat', workSec: 40 }] }
  ]
}, 'ended_early');
assert.strictEqual(payload.name, 'Group circuit');
assert.strictEqual(payload.status, 'ended_early');
assert.strictEqual(payload.people[1].name, 'Client');
assert.strictEqual(payload.people[1].clientId, '');
assert.ok(JSON.stringify(payload).indexOf('@') === -1);

const sets = [{
  sessionId: 's1',
  localDate: '2026-11-20',
  startedAt: '2026-11-20T15:00:00.000Z',
  workoutName: 'Friday circuit',
  origin: 'circuit',
  exerciseName: 'Squat',
  libraryExerciseId: 'squat1',
  mode: 'timer',
  setNumber: 1,
  status: 'completed',
  displayUnit: 'bodyweight',
  plannedWorkSec: 40,
  actualWorkSec: 40,
  plannedRestSec: 15,
  actualRestSec: 15
}];
const detail = History.sessionDetail(sets, 's1');
assert.strictEqual(detail.origin, 'circuit');
const html = History.sessionHtml(detail);
assert.ok(html.indexOf('Group circuit') !== -1);
assert.ok(html.indexOf('move') !== -1);
assert.ok(html.indexOf(' rest') === -1);
assert.ok(html.indexOf('@') === -1);

const model = Dash.build({
  now: new Date('2026-11-25T12:00:00Z'),
  sessions: [{
    id: 's1',
    localDate: '2026-11-20',
    local_date: '2026-11-20',
    status: 'completed',
    origin: 'circuit',
    startedAt: '2026-11-20T15:00:00.000Z',
    endedAt: '2026-11-20T15:18:00.000Z'
  }],
  sets: sets
});
assert.ok(model.circuit);
assert.strictEqual(model.circuit.sessions, 1);
assert.strictEqual(model.circuit.seconds, 40);
const card = Dash.html(model);
assert.ok(card.indexOf('id="dashboard-circuit"') !== -1);
assert.ok(card.indexOf('0:40') !== -1);
assert.ok(card.indexOf('Latest session') !== -1);
assert.ok(card.indexOf('dashboard-circuit-legend') !== -1);
assert.ok(card.indexOf('Squat') !== -1);
assert.ok(card.indexOf('Strength and Capacity') !== -1);
const frozen = Dash.freeze(model, Dash.STANDARD, { asOf: '2026-11-25', trainerName: 'Coach Lee' });
assert.ok(frozen.cards.some(function (item) { return item.type === 'circuit' && item.circuit.seconds === 40; }));
const trainer = Dash.editorHtml(model, Dash.STANDARD, { self: true });
assert.ok(trainer.indexOf('id="dashboard-circuit"') !== -1);
assert.strictEqual(Dash.build({ now: new Date('2026-11-25T12:00:00Z'), sessions: [], sets: [] }).empty, true);

const store = {};
global.localStorage = {
  getItem: function (key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
  setItem: function (key, value) { store[key] = String(value); }
};
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
function coded(code) {
  var err = new Error('save failed');
  err.code = code;
  return err;
}
const now = Date.now();
const recent = new Date(now - 60 * 1000).toISOString();
const soon = new Date(now + 10 * 60 * 1000).toISOString();
const weekAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
const longEnd = new Date(now - 60 * 1000 + 7 * 60 * 60 * 1000).toISOString();
assert.strictEqual(H.permanentError(coded('22023'), { startedAt: recent, endedAt: recent }), true);
assert.strictEqual(H.permanentError(coded('P0102'), { startedAt: recent, endedAt: recent }), true);
assert.strictEqual(H.permanentError(coded('42501'), { startedAt: recent, endedAt: recent }), true);
assert.strictEqual(H.permanentError(coded('P0101'), { startedAt: weekAgo, endedAt: weekAgo }), true);
assert.strictEqual(H.permanentError(coded('P0101'), { startedAt: recent, endedAt: longEnd }), true);
assert.strictEqual(H.permanentError(coded('P0101'), { startedAt: soon, endedAt: soon }), false);
assert.strictEqual(H.permanentError(new Error('Choose a linked client.'), { startedAt: recent, endedAt: recent }), false);
assert.strictEqual(H.permanentError(new Error('Failed to fetch'), { startedAt: recent, endedAt: recent }), false);
assert.strictEqual(H.permanentError(coded('28000'), { startedAt: recent, endedAt: recent }), false);

const sent = [];
global.WBAuth = {
  circuitSaveRun: function (row) {
    sent.push(row.runId);
    return Promise.resolve({ ok: true });
  }
};
H.saveRecord({ runId: 'run-a', name: 'Friday circuit', startedAt: recent, endedAt: recent }, 'completed', A, A).then(function () {
  assert.deepStrictEqual(sent, ['run-a']);
  assert.strictEqual(H.pendingCount(A), 0);
  sent.length = 0;
  return H.saveRecord({ runId: 'run-b', name: 'Other class', startedAt: recent, endedAt: recent }, 'completed', A, B);
}).then(function () {
  throw new Error('another user sent the run');
}, function (err) {
  assert.ok(!err.permanent);
  assert.deepStrictEqual(sent, []);
  assert.strictEqual(H.pendingCount(A), 1);
  assert.strictEqual(H.readQueue()[0].ownerId, A);
  return H.flush(B);
}).then(function () {
  assert.deepStrictEqual(sent, []);
  assert.strictEqual(H.pendingCount(A), 1);
  H.remember(B, { runId: 'run-c', name: 'Kept class', startedAt: recent, endedAt: recent });
  assert.strictEqual(H.pendingCount(B), 1);
  H.clearFor(A);
  assert.strictEqual(H.pendingCount(A), 0);
  assert.strictEqual(H.pendingCount(B), 1);
  H.clearFor(B);
  assert.strictEqual(H.readQueue().length, 0);
  global.WBAuth.circuitSaveRun = function () { return Promise.reject(coded('22023')); };
  return H.saveRecord({ runId: 'run-bad', name: 'Friday circuit', startedAt: recent, endedAt: recent }, 'completed', A, A);
}).then(function () {
  throw new Error('validation was kept');
}, function (err) {
  assert.strictEqual(err.permanent, true);
  assert.strictEqual(err.circuitName, 'Friday circuit');
  assert.strictEqual(H.pendingCount(A), 0);
  global.WBAuth.circuitSaveRun = function () { return Promise.reject(coded('P0102')); };
  return H.saveRecord({ runId: 'run-link', name: 'Friday circuit', startedAt: recent, endedAt: recent }, 'completed', A, A);
}).then(function () {
  throw new Error('unlinked client was kept');
}, function (err) {
  assert.strictEqual(err.permanent, true);
  assert.strictEqual(H.pendingCount(A), 0);
  global.WBAuth.circuitSaveRun = function () { return Promise.reject(coded('42501')); };
  return H.saveRecord({ runId: 'run-role', name: 'Friday circuit', startedAt: recent, endedAt: recent }, 'completed', A, A);
}).then(function () {
  throw new Error('trainer role was kept');
}, function (err) {
  assert.strictEqual(err.permanent, true);
  assert.strictEqual(H.pendingCount(A), 0);
  global.WBAuth.circuitSaveRun = function () { return Promise.reject(coded('P0101')); };
  return H.saveRecord({ runId: 'run-old', name: 'Friday circuit', startedAt: weekAgo, endedAt: weekAgo }, 'completed', A, A);
}).then(function () {
  throw new Error('old run was kept');
}, function (err) {
  assert.strictEqual(err.permanent, true);
  assert.strictEqual(H.pendingCount(A), 0);
  return H.saveRecord({ runId: 'run-long', name: 'Friday circuit', startedAt: recent, endedAt: longEnd }, 'completed', A, A);
}).then(function () {
  throw new Error('long run was kept');
}, function (err) {
  assert.strictEqual(err.permanent, true);
  assert.strictEqual(H.pendingCount(A), 0);
  return H.saveRecord({ runId: 'run-skew', name: 'Friday circuit', startedAt: soon, endedAt: soon }, 'completed', A, A);
}).then(function () {
  throw new Error('clock skew was dropped');
}, function (err) {
  assert.ok(!err.permanent);
  assert.strictEqual(H.pendingCount(A), 1);
  assert.strictEqual(H.readQueue()[0].payload.runId, 'run-skew');
  H.clearFor(A);
  global.WBAuth.circuitSaveRun = function () { return Promise.reject(new Error('Failed to fetch')); };
  return H.saveRecord({ runId: 'run-net', name: 'Friday circuit', startedAt: recent, endedAt: recent }, 'completed', A, A);
}).then(function () {
  throw new Error('network error was dropped');
}, function (err) {
  assert.ok(!err.permanent);
  assert.strictEqual(H.pendingCount(A), 1);
  global.WBAuth.circuitSaveRun = function (row) {
    sent.push(row.runId);
    return Promise.resolve({ ok: true });
  };
  return H.flush(A);
}).then(function () {
  assert.deepStrictEqual(sent, ['run-net']);
  assert.strictEqual(H.pendingCount(A), 0);
  console.log('CIRCUIT HISTORY UNIT OK');
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
