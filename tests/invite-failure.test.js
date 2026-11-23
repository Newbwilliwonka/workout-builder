// A PostgREST rpc result carries HTTP status beside error, not on it.
// node tests/invite-failure.test.js
const assert = require('assert');
const Inv = require('../invites.js');

var rpc500 = {
  data: null,
  error: { message: 'Internal Server Error', code: 'PGRST000' },
  status: 500,
  statusText: 'Internal Server Error'
};
var wrapped500 = Inv.redeemResponseError(rpc500);
assert.strictEqual(wrapped500.status, 500);
assert.strictEqual(wrapped500.code, 'PGRST000');
assert.ok(!wrapped500.error, 'status stays off the PostgREST error object');
assert.strictEqual(Inv.inviteFailureKind(wrapped500), 'retry');

var rpc503 = {
  data: null,
  error: { message: 'Service Unavailable', code: 'PGRST000' },
  status: 503,
  statusText: 'Service Unavailable'
};
assert.strictEqual(Inv.redeemResponseError(rpc503).status, 503);
assert.strictEqual(Inv.inviteFailureKind(Inv.redeemResponseError(rpc503)), 'retry');

var dropped = new TypeError('Failed to fetch');
var wrappedDrop = Inv.redeemResponseError({
  error: dropped,
  status: 0,
  statusText: dropped.message
});
assert.strictEqual(wrappedDrop.name, 'TypeError');
assert.strictEqual(wrappedDrop.offline, true);
assert.strictEqual(wrappedDrop.status, 0);
assert.strictEqual(wrappedDrop.cause, dropped);
assert.strictEqual(Inv.inviteFailureKind(wrappedDrop), 'retry');

var offlineOnly = Inv.redeemResponseError({ data: null, error: null, status: 0, statusText: '' });
assert.strictEqual(offlineOnly.offline, true);
assert.strictEqual(Inv.inviteFailureKind(offlineOnly), 'retry');

var waiting = Inv.redeemResponseError({
  data: null,
  error: { message: 'Your account is waiting for approval.', code: 'P0001' },
  status: 400,
  statusText: 'Bad Request'
});
assert.strictEqual(Inv.inviteFailureKind(waiting), 'retry');

var connected = Inv.redeemResponseError({
  data: null,
  error: {
    message: 'You are already connected to a trainer. End that connection before using a new invite.',
    code: 'P0001',
    hint: 'invite_connected'
  },
  status: 400,
  statusText: 'Bad Request'
});
assert.strictEqual(connected.inviteOutcome, 'invite_connected');
assert.strictEqual(connected.status, 400);
assert.strictEqual(Inv.inviteFailureKind(connected), 'terminal');

var expired = Inv.redeemResponseError({
  data: null,
  error: { message: 'That invite could not be used.', code: 'P0001', hint: 'invite_expired' },
  status: 400,
  statusText: 'Bad Request'
});
assert.strictEqual(Inv.inviteFailureKind(expired), 'terminal');

var unknown = Inv.redeemResponseError({
  data: null,
  error: { message: 'That check expired. Please try again.', code: 'P0001' },
  status: 400,
  statusText: 'Bad Request'
});
assert.strictEqual(Inv.inviteFailureKind(unknown), 'retry');

assert.strictEqual(Inv.redeemResponseError({ data: { ok: true }, error: null, status: 200, statusText: 'OK' }), null);

console.log('invite failure ok');
