// Redeem failures keep their status so a 500 or a network error can be retried.
// node tests/invite-failure.test.js
const assert = require('assert');
const Inv = require('../invites.js');

function serverError(status) {
  var err = new Error('Internal Server Error');
  err.status = status;
  err.code = 'PGRST000';
  return Inv.wrapInviteError(err);
}

var wrapped500 = serverError(500);
assert.strictEqual(wrapped500.status, 500);
assert.strictEqual(wrapped500.cause.status, 500);
assert.strictEqual(Inv.inviteFailureKind(wrapped500), 'retry');

var wrapped503 = serverError(503);
assert.strictEqual(Inv.inviteFailureKind(wrapped503), 'retry');

var network = new TypeError('Failed to fetch');
var wrappedNetwork = Inv.wrapInviteError(network);
assert.strictEqual(wrappedNetwork.name, 'TypeError');
assert.strictEqual(wrappedNetwork.message, 'Failed to fetch');
assert.strictEqual(wrappedNetwork.cause, network);
assert.strictEqual(Inv.inviteFailureKind(wrappedNetwork), 'retry');

var offline = new TypeError('Load failed');
offline.offline = true;
assert.strictEqual(Inv.inviteFailureKind(Inv.wrapInviteError(offline)), 'retry');

var waiting = new Error('Your account is waiting for approval.');
assert.strictEqual(Inv.inviteFailureKind(Inv.wrapInviteError(waiting)), 'retry');

var connected = new Error('You are already connected to a trainer. End that connection before using a new invite.');
connected.hint = 'invite_connected';
var wrappedConnected = Inv.wrapInviteError(connected);
assert.strictEqual(wrappedConnected.inviteOutcome, 'invite_connected');
assert.strictEqual(Inv.inviteFailureKind(wrappedConnected), 'terminal');

var expiredHint = new Error('That invite could not be used.');
expiredHint.hint = 'invite_expired';
assert.strictEqual(Inv.inviteFailureKind(Inv.wrapInviteError(expiredHint)), 'terminal');

var unrelated = new Error('That check expired. Please try again.');
assert.strictEqual(Inv.inviteFailureKind(Inv.wrapInviteError(unrelated)), 'once');

console.log('invite failure ok');
