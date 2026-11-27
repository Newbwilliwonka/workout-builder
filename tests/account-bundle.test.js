// One active account on a device. No network.
const assert = require('assert');
const L = require('../library.js');

function bundle(name, sessionName) {
  return {
    workouts: [{ id: 'wo_' + name, name: name, items: [] }],
    sessions: [{ id: 'ses_' + name, workoutName: sessionName || name, ownWork: true }],
    programs: [{ id: 'pg_' + name, ownerId: name }],
    log: [{ id: 'log_' + name, workoutName: sessionName || name, ownWork: true }]
  };
}

const a = L.activateAccount({ lastId: '', live: bundle('Saturday easy'), parked: {}, deviceAfterSignOut: false }, 'account-a');
assert.strictEqual(a.lastId, 'account-a');
assert.deepStrictEqual(a.live.workouts, []);
assert.strictEqual(a.parked[L.UNKNOWN_ACCOUNT].workouts[0].name, 'Saturday easy');

const WILLIAM = '11111111-1111-4111-8111-111111111111';
const upgrade = L.activateAccount({
  lastId: '',
  ownerId: WILLIAM,
  live: {
    workouts: [
      { id: 'wo_lsit', name: 'LSit hold', items: [] },
      { id: 'wo_hollow', name: 'Hollow Body', items: [] }
    ],
    sessions: [{ id: 'ses_lsit', workoutId: 'wo_lsit', workoutName: 'LSit hold', ownWork: true }],
    programs: [{ id: 'pg_lsit', ownerId: WILLIAM, workoutId: 'wo_lsit', workoutName: 'LSit hold' }],
    log: [{ id: 'log_hollow', workoutId: 'wo_hollow', workoutName: 'Hollow Body', ownWork: true }]
  },
  parked: {},
  deviceAfterSignOut: false
}, WILLIAM);
assert.strictEqual(upgrade.lastId, WILLIAM);
assert.strictEqual(upgrade.switched, false);
assert.deepStrictEqual(upgrade.live.workouts.map(function (w) { return w.name; }), ['LSit hold', 'Hollow Body']);
assert.strictEqual(upgrade.live.sessions[0].workoutName, 'LSit hold');
assert.strictEqual(upgrade.live.programs[0].workoutName, 'LSit hold');
assert.strictEqual(upgrade.live.log[0].workoutName, 'Hollow Body');
assert.strictEqual(upgrade.parked[L.UNKNOWN_ACCOUNT], undefined);

const other = L.activateAccount({
  lastId: '',
  ownerId: WILLIAM,
  live: upgrade.live,
  parked: {},
  deviceAfterSignOut: false
}, 'account-b');
assert.strictEqual(other.lastId, 'account-b');
assert.deepStrictEqual(other.live.workouts, []);
assert.strictEqual(other.parked[WILLIAM].workouts[0].name, 'LSit hold');
assert.strictEqual(other.parked[L.UNKNOWN_ACCOUNT], undefined);
assert.strictEqual(L.activateAccount(other, WILLIAM).live.workouts[1].name, 'Hollow Body');
const withA = {
  lastId: 'account-a',
  live: bundle('Saturday easy'),
  parked: { 'account-a': bundle('Saturday easy') },
  deviceAfterSignOut: false
};
const asB = L.activateAccount(withA, 'account-b');
assert.strictEqual(asB.lastId, 'account-b');
assert.deepStrictEqual(asB.live.workouts, []);
assert.deepStrictEqual(asB.live.sessions, []);
assert.deepStrictEqual(asB.live.log, []);
assert.strictEqual(asB.parked['account-a'].workouts[0].name, 'Saturday easy');
assert.notStrictEqual(asB.parked['account-b'].workouts.length, 1);

const back = L.activateAccount(asB, 'account-a');
assert.strictEqual(back.lastId, 'account-a');
assert.strictEqual(back.live.workouts[0].name, 'Saturday easy');
assert.strictEqual(back.live.sessions[0].workoutName, 'Saturday easy');
assert.strictEqual(back.live.log[0].workoutName, 'Saturday easy');
assert.deepStrictEqual(back.live.workouts.filter(function (w) { return w.name === 'Saturday easy'; }).length, 1);
assert.ok(!back.parked[L.UNKNOWN_ACCOUNT] || back.parked[L.UNKNOWN_ACCOUNT] === asB.parked[L.UNKNOWN_ACCOUNT]);

const device = L.activateAccount({
  lastId: '',
  live: bundle('After sign out'),
  parked: { 'account-a': bundle('Saturday easy') },
  deviceAfterSignOut: true
}, 'account-a');
assert.strictEqual(device.live.workouts.some(function (w) { return w.name === 'Saturday easy'; }), true);
assert.strictEqual(device.live.workouts.some(function (w) { return w.name === 'After sign out'; }), true);

console.log('ACCOUNT BUNDLE OK');
