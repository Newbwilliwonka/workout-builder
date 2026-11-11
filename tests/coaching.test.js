// Rules for received copies. No browser.
const assert = require('assert');
const Inv = require('../invites.js');
const C = require('../coaching.js');
global.WBInvites = Inv;

const enthusiast = { membership: 'none', intended_plan: 'enthusiast' };
const free = { membership: 'free_client', intended_plan: null };
const trainer = { membership: 'trainer', intended_plan: null };
const own = { id: 'own', name: 'Mine', items: [] };
const copy = { id: 'copy', name: 'From coach', sourceTrainerId: 't1', items: [{ name: 'Squat' }], updatedAt: 10 };

assert.strictEqual(C.canEditCopy(enthusiast, own), true);
assert.strictEqual(C.canEditCopy(free, own), true);
assert.strictEqual(C.canEditCopy(null, own), true);
assert.strictEqual(C.canEditCopy(enthusiast, copy), true);
assert.strictEqual(C.canEditCopy(free, copy), false);
assert.strictEqual(C.canEditCopy(null, copy), false);
assert.strictEqual(C.canEditCopy(trainer, copy), true);

const src = { id: 'w1', name: ' Lower ', items: [{ name: 'Squat' }], sourceTrainerId: 'nope' };
const snap = C.snapshot(src);
assert.strictEqual(snap.sourceWorkoutId, 'w1');
assert.strictEqual(snap.name, 'Lower');
assert.strictEqual(snap.items[0].name, 'Squat');
assert.strictEqual(snap.sourceTrainerId, undefined);
snap.items[0].name = 'Changed';
assert.strictEqual(src.items[0].name, 'Squat');

const local = [
  { id: 'own', name: 'Mine', items: [] },
  { id: 'old', name: 'Gone', sourceTrainerId: 't1', items: [], updatedAt: 1 },
  { id: 'copy', name: 'Local newer', sourceTrainerId: 't1', items: [{ name: 'Mine' }], updatedAt: 50 }
];
const remote = [
  { id: 'copy', name: 'Server older', sourceTrainerId: 't1', sourceTrainerEmail: 'alex@example.com', items: [{ name: 'Server' }], updatedAt: '1970-01-01T00:00:00.000Z' },
  { id: 'new', name: 'Friday', sourceTrainerId: 't1', sourceTrainerEmail: 'alex@example.com', items: [{ name: 'Squat' }], updatedAt: '2026-11-10T00:00:00.000Z' }
];
const merged = C.mergeCopies(local, remote);
assert.deepStrictEqual(merged.map(function (w) { return w.id; }), ['own', 'copy', 'new']);
assert.strictEqual(merged[0].name, 'Mine');
assert.strictEqual(merged[0].sourceTrainerId, undefined);
assert.strictEqual(merged[1].name, 'Local newer');
assert.strictEqual(merged[2].sourceTrainerEmail, 'alex@example.com');
assert.strictEqual(C.cleanBody('  Friday   still  '), 'Friday still');
assert.strictEqual(C.unread([{ mine: false, readAt: null }, { mine: true, readAt: null }, { mine: false, readAt: 'x' }]), 1);

console.log('COACHING OK');
