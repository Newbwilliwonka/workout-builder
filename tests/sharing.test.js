// Sharing choice, local payload, and read-only client view. No network.
const assert = require('assert');
const S = require('../sharing.js');
const Inv = require('../invites.js');

assert.strictEqual(S.parseSetting(null).ok, false);
assert.strictEqual(S.parseSetting({}).ok, false);
assert.strictEqual(S.parseSetting({ on: 'true' }).ok, false);
assert.strictEqual(S.parseSetting({ on: 1 }).ok, false);
assert.strictEqual(S.parseSetting({ on: null }).ok, false);
assert.deepStrictEqual(S.parseSetting({ on: false, enthusiast: true, linked: true }), {
  ok: true, on: false, enthusiast: true, linked: true
});
assert.strictEqual(S.parseSetting({ on: true }).on, true);
assert.strictEqual(S.parseStatus({ shared: false }).ok, false);
assert.strictEqual(S.parseStatus({ shared: 'false', enthusiast: true, linked: true }).ok, false);
assert.strictEqual(S.parseStatus({ shared: false, enthusiast: true, linked: true }).shared, false);
assert.strictEqual(S.isUnavailable(new Error('Sharing workouts is not available yet.')), true);
assert.strictEqual(S.isUnavailable(new Error('Could not find the function public.share_setting')), true);
assert.strictEqual(S.isUnavailable(new Error('Failed to fetch')), false);

var state = S.initialState();
assert.strictEqual(state.confirmed, null);
assert.strictEqual(S.showSwitch(state), false);
assert.strictEqual(S.shouldPush(state), false);

state = S.reduce(state, { type: 'load-error', message: 'Failed to fetch' });
assert.strictEqual(state.confirmed, null);
assert.strictEqual(state.phase, 'error');
assert.strictEqual(S.showSwitch(state), false);
assert.ok(!S.accountCard(state).includes('id="share-account"'));
assert.ok(S.accountCard(state).includes('share-error'));

state = S.reduce(S.initialState(), { type: 'load-unavailable', message: S.UNAVAILABLE });
assert.strictEqual(state.confirmed, null);
assert.strictEqual(state.phase, 'unavailable');
assert.ok(S.accountCard(state).includes('Not available yet'));
assert.ok(!S.accountCard(state).includes('id="share-account"'));

state = S.reduce(S.initialState(), { type: 'load-ok', on: 'yes' });
assert.strictEqual(state.confirmed, null);
assert.strictEqual(state.phase, 'error');

state = S.reduce(S.initialState(), { type: 'load-ok', on: true });
assert.strictEqual(state.confirmed, true);
assert.strictEqual(S.shouldPush(state), true);
assert.strictEqual(S.shouldPush(S.reduce(S.initialState(), { type: 'load-ok', on: true, enthusiast: false })), false);
assert.strictEqual(S.shouldPush(S.reduce(S.initialState(), { type: 'load-ok', on: true, enthusiast: true })), true);
var onCard = S.accountCard(state);
assert.ok(onCard.includes('class="switch on"'));
assert.ok(onCard.includes('aria-checked="true"'));
assert.ok(onCard.includes(S.NOTE));
assert.ok(!onCard.includes(' disabled'));

state = S.reduce(state, { type: 'load-error', message: 'Failed to fetch' });
assert.strictEqual(state.confirmed, true);
assert.strictEqual(state.phase, 'ready');
assert.ok(S.accountCard(state).includes('aria-checked="true"'));

state = S.reduce(state, { type: 'load-ok', on: null });
assert.strictEqual(state.confirmed, true);

var busy = S.reduce(state, { type: 'save-start' });
assert.strictEqual(busy.busy, true);
assert.strictEqual(busy.confirmed, true);
assert.ok(S.accountCard(busy).includes('disabled'));
assert.strictEqual(S.shouldPush(busy), false);
var ignored = S.reduce(busy, { type: 'load-ok', on: false });
assert.strictEqual(ignored.confirmed, true);
assert.strictEqual(ignored.busy, true);

var failed = S.reduce(busy, { type: 'save-fail', message: 'Could not save that choice.' });
assert.strictEqual(failed.busy, false);
assert.strictEqual(failed.confirmed, true);
assert.ok(!S.accountCard(failed).includes('disabled'));

var unknownSave = S.reduce(busy, { type: 'save-ok', on: null });
assert.strictEqual(unknownSave.confirmed, true);
assert.strictEqual(unknownSave.busy, false);

var off = S.reduce(busy, { type: 'save-ok', on: false });
assert.strictEqual(off.confirmed, false);
assert.strictEqual(off.busy, false);
assert.strictEqual(S.shouldPush(off), false);
var offCard = S.accountCard(off);
assert.ok(offCard.includes('aria-checked="false"'));
assert.ok(!offCard.includes('class="switch on"'));

var kept = S.reduce(off, { type: 'redeemed' });
assert.strictEqual(kept.confirmed, false);
var chosen = S.reduce(S.initialState(), { type: 'redeemed', on: false });
assert.strictEqual(chosen.confirmed, false);
assert.strictEqual(chosen.phase, 'ready');

var link = S.linkOption();
assert.ok(link.includes('id="share-link"'));
assert.ok(link.includes(' checked'));
assert.ok(link.includes('Let your trainer view your workouts and tracking'));
assert.ok(link.includes('avoid training conflicts'));
assert.ok(!S.linkOption(false).includes(' checked'));

var hidden = S.clientHtml({ ok: true, shared: false, enthusiast: true, linked: true, plan: 'Enthusiast' }, null, null);
assert.ok(hidden.includes('id="client-private"'));
assert.ok(hidden.includes('Not shared'));
assert.ok(!hidden.includes('Saturday easy'));
assert.ok(!hidden.includes('<button'));
assert.ok(!hidden.includes('<input'));

var free = S.clientHtml({ ok: true, shared: false, enthusiast: false, linked: true, plan: 'Free Client' }, [{ name: 'Saturday easy' }], []);
assert.ok(free.includes('id="client-free"'));
assert.ok(free.includes('Free Clients'));
assert.ok(!free.includes('Saturday easy'));

var unknown = S.clientHtml({ ok: false }, [{ name: 'Saturday easy' }], []);
assert.ok(unknown.includes('id="client-error"'));
assert.ok(!unknown.includes('Saturday easy'));
assert.ok(!unknown.includes('Not shared'));
assert.ok(S.unavailableHtml().includes('Not available yet'));

var view = S.clientHtml(
  { ok: true, shared: true, enthusiast: true, linked: true, plan: 'Enthusiast', email: 'fan@example.com' },
  [{ name: 'Saturday easy', items: [{ name: 'Squat', sets: 3 }, { name: 'Plank', sets: 2 }] }],
  [{ workoutName: 'Saturday easy', endedAt: Date.UTC(2026, 10, 11, 15, 4), results: [
    { name: 'Squat', set: 1, of: 3, reps: 8, weight: 135, unit: 'lb', logged: true }
  ] }]
);
assert.ok(view.includes('id="client-view"'));
assert.ok(view.includes('data-readonly="true"'));
assert.ok(view.includes('Read only'));
assert.ok(view.includes('Saturday easy'));
assert.ok(view.includes('Squat · 3 sets'));
assert.ok(view.includes('Squat · set 1 of 3 · 8 reps · 135 lb'));
assert.ok(!view.includes('<button'));
assert.ok(!view.includes('<input'));
assert.ok(!view.includes('<textarea'));
var broken = S.clientHtml(
  { ok: true, shared: true, enthusiast: true, linked: true, plan: 'Enthusiast' },
  null,
  []
);
assert.ok(broken.includes('id="client-error"'));
assert.ok(!broken.includes('No workouts of their own yet.'));

var data = {
  workouts: [
    { id: 'own', name: 'Saturday easy', items: [{ name: 'Squat' }] },
    { id: 'copy', name: 'Trainer day', sourceTrainerId: 't1', items: [] }
  ],
  sessions: [
    { id: 's-own', workoutId: 'own', workoutName: 'Saturday easy', results: [{ name: 'Squat', reps: 8 }] },
    { id: 's-copy', workoutId: 'copy', workoutName: 'Trainer day', results: [{ name: 'Secret', reps: 1 }] }
  ]
};
var body = S.payload(data, []);
assert.deepStrictEqual(body.workouts.map(function (w) { return w.localId; }), ['own']);
assert.deepStrictEqual(body.sessions.map(function (s) { return s.localId; }), ['s-own']);
assert.strictEqual(S.sessionIsOwn({ id: 's-own', workoutId: 'own' }, data.workouts), true);
assert.strictEqual(S.sessionIsOwn({ id: 's-copy', workoutId: 'copy' }, data.workouts), false);
assert.strictEqual(S.sessionIsOwn({ id: 's-gone', workoutId: 'missing' }, data.workouts), false);
assert.strictEqual(S.sessionIsOwn({ id: 's-blank' }, data.workouts), false);
var dropped = S.payload({
  workouts: [{ id: 'own', name: 'Saturday easy', items: [] }],
  sessions: [{ id: 'gone', workoutId: 'missing', workoutName: 'Ghost', results: [{ name: 'Secret' }] }]
}, []);
assert.deepStrictEqual(dropped.sessions, []);
assert.strictEqual(S.payload(data, null), null);
assert.strictEqual(S.payload(null, []), null);
assert.strictEqual(S.payload({ workouts: [], sessions: 'nope' }, []), null);

var writes = 0;
var badStore = {
  getItem: function () { throw new Error('fail'); },
  setItem: function () { writes++; }
};
assert.strictEqual(S.rememberSession(badStore, { id: 's1', workoutId: 'own' }, data.workouts), false);
assert.strictEqual(writes, 0);
var mem = {};
var store = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = v; }
};
store.setItem(S.LOG_KEY, '{');
assert.strictEqual(S.readLog(store), null);
assert.strictEqual(S.rememberSession(store, { id: 's1', workoutId: 'own' }, data.workouts), false);
assert.strictEqual(store.getItem(S.LOG_KEY), '{');
assert.strictEqual(S.payload(data, S.readLog(store)), null);

(async function () {
var book = Inv.createBook({
  me: 't1', signedIn: true,
  users: {
    t1: { id: 't1', email: 'coach@example.com', membership: 'trainer', intended_plan: null },
    e1: { id: 'e1', email: 'fan@example.com', membership: 'enthusiast', intended_plan: 'enthusiast' },
    n1: { id: 'n1', email: 'new@example.com', membership: 'none', intended_plan: null }
  }
});
var code = (await book.api().createInvite()).code;
book.setMe('e1');
await book.api().redeemInvite(code, false);
assert.strictEqual(book.state.users.e1.share_with_trainer, false);
assert.strictEqual(book.state.users.e1.membership, 'enthusiast');
book.setMe('t1');
var roster = await book.api().roster();
assert.strictEqual(roster.clientCount, 1);
assert.strictEqual(roster.clients[0].plan, 'Enthusiast');
await book.api().endConnection('e1');
var again = (await book.api().createInvite()).code;
book.setMe('n1');
await book.api().redeemInvite(again, true);
assert.strictEqual(book.state.users.n1.membership, 'free_client');
assert.strictEqual(book.state.users.n1.share_with_trainer, undefined);
book.setMe('t1');
assert.strictEqual((await book.api().roster()).clientCount, 1);
assert.strictEqual((await book.api().roster()).clients[0].plan, 'Free Client');

console.log('SHARING OK');
})().catch(function (err) { console.error(err); process.exit(1); });
