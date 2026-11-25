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
const H2 = require('../circuit-history.js');
H2.remember('trainer-1', { runId: 'run-a', name: 'Friday circuit' });
H2.remember('trainer-2', { runId: 'run-b', name: 'Other' });
assert.strictEqual(H2.readQueue().length, 2);
assert.strictEqual(H.permanentError(new Error('Choose a linked client.')), true);
assert.strictEqual(H.permanentError(new Error('That circuit could not be saved.')), true);
assert.strictEqual(H.permanentError(new Error('Only a trainer can save a circuit.')), false);
assert.strictEqual(H.permanentError(new Error('That circuit is outside the save window.')), false);
assert.strictEqual(H.permanentError(new Error('Saving a circuit is not available yet.')), false);
assert.strictEqual(H.permanentError(new Error('Sign in first.')), false);
assert.strictEqual(H.permanentError(new Error('Failed to fetch')), false);
assert.strictEqual(H.permanentError(new Error('null value in column "manual" of relation "circuit_runs"')), false);
H2.forget('trainer-1', 'run-a');
assert.strictEqual(H2.readQueue().length, 1);
H2.clearQueue();
assert.strictEqual(H2.readQueue().length, 0);

console.log('CIRCUIT HISTORY UNIT OK');
