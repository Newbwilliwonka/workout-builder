// Invite rules without a network: node tests/invites.test.js
const assert = require('assert');
const Inv = require('../invites.js');
const trainer = { id: 't1', email: 'coach@example.com', membership: 'none', intended_plan: 'trainer' };
const master = { id: 'm1', email: 'master@example.com', membership: 'master_trainer', intended_plan: null };
const newbie = { id: 'n1', email: 'new@example.com', membership: 'none', intended_plan: null };
const fan = { id: 'e1', email: 'fan@example.com', membership: 'none', intended_plan: 'enthusiast' };
const paidFan = { id: 'e2', email: 'paid@example.com', membership: 'enthusiast', intended_plan: null };
const coach = { id: 't2', email: 'other@example.com', membership: 'none', intended_plan: 'master_trainer' };

assert.strictEqual(Inv.capFor(trainer), 15);
assert.strictEqual(Inv.capFor(master), 30);
assert.strictEqual(Inv.capFor(newbie), 0);
assert.strictEqual(Inv.trainerRole(trainer), 'trainer');
assert.strictEqual(Inv.trainerRole({ membership: 'trainer', intended_plan: 'enthusiast' }), 'trainer');
assert.strictEqual(Inv.canCreate(newbie, [], [], 0).message, Inv.MSG.notTrainer);
assert.strictEqual(Inv.canCreate(trainer, [], [], 0).ok, true);

for (var i = 0; i < 200; i++) {
  var code = Inv.generateCode();
  assert.ok(Inv.codeIsWellFormed(code), code);
  assert.ok(!/[01OI]/.test(code), code);
}
assert.strictEqual(Inv.normalizeCode(' abcd-2345 '), 'ABCD2345');
assert.strictEqual(Inv.formatCode('ABCD2345'), 'ABCD-2345');
assert.strictEqual(Inv.inviteLink('ABCD2345'), 'https://coachtrainerapp.com/?invite=ABCD2345#/signin');

function book(me, signed) {
  return Inv.createBook({
    me: me, signedIn: signed !== false,
    users: { t1: Object.assign({}, trainer), m1: Object.assign({}, master), n1: Object.assign({}, newbie), e1: Object.assign({}, fan), e2: Object.assign({}, paidFan), t2: Object.assign({}, coach) }
  });
}
function fill(b, n) {
  var jobs = [];
  for (var i = 0; i < n; i++) jobs.push(b.api().createInvite());
  return Promise.all(jobs);
}

(async function () {
  var b = book('t1');
  var now = 1_700_000_000_000;
  b.setNow(now);
  var made = await fill(b, 15);
  assert.strictEqual(made.length, 15);
  await assert.rejects(b.api().createInvite(), /No invite slots left/);
  var roster = await b.api().roster();
  assert.strictEqual(roster.clientCount, 0);
  assert.strictEqual(roster.cap, 15);
  assert.strictEqual(roster.canCreate, false);
  assert.strictEqual(roster.invites.length, 15);
  await b.api().cancelInvite(made[0].code);
  roster = await b.api().roster();
  assert.strictEqual(roster.canCreate, true);
  assert.strictEqual(roster.invites.length, 14);
  await assert.rejects(b.api().redeemInvite(made[0].code), /canceled/);
  var again = await b.api().createInvite();
  assert.ok(Inv.codeIsWellFormed(again.code));
  b.setNow(now + Inv.TTL_MS + 1);
  await assert.rejects(b.api().redeemInvite(again.code), /expired/);
  roster = await b.api().roster();
  assert.strictEqual(roster.invites.some(function (inv) { return inv.code === again.code; }), false);
  assert.strictEqual(roster.canCreate, true);

  b.setNow(now);
  b.setMe('n1');
  var open = made[1].code;
  var joined = await b.api().redeemInvite(open);
  assert.strictEqual(joined.message, Inv.MSG.free);
  assert.strictEqual((await b.api().profile()).membership, 'free_client');
  await assert.rejects(b.api().redeemInvite(open), /already been used/);
  await assert.rejects(b.api().redeemInvite('ZZZZZZZZ'), /not found/);
  await assert.rejects(b.api().redeemInvite('not-a-code'), /not found/);
  var conn = await b.api().myConnection();
  assert.strictEqual(conn.trainerId, 't1');
  await assert.rejects(b.api().redeemInvite(made[2].code), /already connected/);

  var kept = Inv.withoutTrainerWorkouts([
    { id: 'own', name: 'Mine' },
    { id: 'theirs', name: 'From coach', sourceTrainerId: 't1' }
  ], 't1');
  assert.deepStrictEqual(kept.map(function (w) { return w.id; }), ['own']);

  var ended = await b.api().endConnection(null);
  assert.strictEqual(ended.trainerId, 't1');
  assert.strictEqual(await b.api().myConnection(), null);
  assert.strictEqual((await b.api().profile()).membership, 'free_client');
  b.setMe('t1');
  assert.strictEqual((await b.api().roster()).clientCount, 0);

  b.setMe('e1');
  var linkBook = book('t1');
  var created = await linkBook.api().createInvite();
  linkBook.setMe('e1');
  var enth = await linkBook.api().redeemInvite(created.code);
  assert.strictEqual(enth.message, Inv.MSG.enthusiast);
  assert.strictEqual((await linkBook.api().profile()).membership, 'none');
  assert.strictEqual((await linkBook.api().profile()).intended_plan, 'enthusiast');
  linkBook.setMe('t1');
  var clients = (await linkBook.api().roster()).clients;
  assert.strictEqual(clients.length, 1);
  assert.strictEqual(clients[0].plan, 'Enthusiast');
  await linkBook.api().endConnection(clients[0].id);
  linkBook.setMe('e1');
  assert.strictEqual(await linkBook.api().myConnection(), null);
  assert.strictEqual((await linkBook.api().profile()).intended_plan, 'enthusiast');
  var own = Inv.withoutTrainerWorkouts([
    { id: 'mine', name: 'Fan workout' },
    { id: 'coach', name: 'Assigned', sourceTrainerId: 't1' }
  ], 't1');
  assert.deepStrictEqual(own.map(function (w) { return w.name; }), ['Fan workout']);

  linkBook.setMe('t1');
  var forCoach = await linkBook.api().createInvite();
  linkBook.setMe('t2');
  await assert.rejects(linkBook.api().redeemInvite(forCoach.code), /cannot join as a client/);
  var masterBook = book('m1');
  assert.strictEqual((await masterBook.api().roster()).cap, 30);
  await fill(masterBook, 30);
  await assert.rejects(masterBook.api().createInvite(), /No invite slots left/);

  var capBook = book('t1');
  var spare = await capBook.api().createInvite();
  for (var c = 0; c < 15; c++) {
    capBook.state.links.push({ trainer_id: 't1', client_id: 'c' + c, ended_at: null, plan: 'Free Client' });
  }
  capBook.setMe('n1');
  await assert.rejects(capBook.api().redeemInvite(spare.code), /no open client spots/);
  console.log('INVITES OK');
})().catch(function (e) { console.error(e); process.exit(1); });
