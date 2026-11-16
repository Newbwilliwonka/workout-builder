// Other people's email addresses are not used as labels.
// node tests/privacy-names.test.js
const assert = require('assert');
const P = require('../profile.js');
const S = require('../sends.js');
const D = require('../dashboard.js');
const Sh = require('../sharing.js');

const people = [
  { email: 'ada@example.com', plan: 'Free Client' },
  { name: 'ada@example.com', email: 'ada@example.com', plan: 'Free Client' },
  { name: 'Jo Park', email: 'jo@example.com', plan: 'Enthusiast' },
  { display_name: 'Sam', trainerEmail: 'sam@example.com', plan: 'Trainer' },
  { trainerName: '', trainerEmail: 'coach@example.com', plan: 'Trainer' }
];
people.forEach(function (row) {
  const label = P.label(row);
  assert.ok(label.indexOf('@') === -1, label);
  assert.ok(label !== 'ada' || row.name === 'ada');
});
assert.strictEqual(P.label(people[0]), 'Client');
assert.strictEqual(P.label(people[1]), 'Client');
assert.strictEqual(P.label(people[2]), 'Jo Park');
assert.strictEqual(P.label(people[3]), 'Sam');
assert.strictEqual(P.label(people[4]), 'Trainer');

const fromEmail = P.fromTrainerHtml({ sourceTrainerEmail: 'kinisiathletics@gmail.com', sourceTrainerName: '' });
const fromNamed = P.fromTrainerHtml({ sourceTrainerEmail: 'kinisiathletics@gmail.com', sourceTrainerName: 'Coach Lee' });
const fromAddressName = P.fromTrainerHtml({ sourceTrainerName: 'coach@example.com' });
assert.strictEqual(fromEmail, 'Trainer');
assert.ok(fromNamed.indexOf('Coach Lee') !== -1);
assert.ok(fromNamed.indexOf('@') === -1);
assert.strictEqual(fromAddressName, 'Trainer');

const note = S.confirmation([
  { email: 'hempled@gmail.com', plan: 'Enthusiast' },
  { email: 'ada@example.com', plan: 'Free Client' }
], 'Friday full body');
assert.ok(note.indexOf('@') === -1);
assert.ok(note.indexOf('hempled') === -1);
assert.ok(note.indexOf('Enthusiast') !== -1);
assert.ok(note.indexOf('Client') !== -1);

const stamp = D.stampText({ asOf: '2026-11-16', trainerName: 'coach@example.com' });
assert.strictEqual(stamp, 'As of November 16, 2026 from Trainer');
assert.ok(D.snapshotHtml({ asOf: '2026-11-16', trainerName: 'coach@example.com', cards: [] }).indexOf('@') === -1);

const status = Sh.parseStatus({
  shared: true, enthusiast: true, linked: true,
  email: 'fan@example.com', name: 'Fan', plan: 'Enthusiast'
});
assert.strictEqual(status.ok, true);
assert.strictEqual(status.email, undefined);
assert.strictEqual(status.name, 'Fan');
assert.ok(JSON.stringify(status).indexOf('@') === -1);

console.log('privacy names ok');
