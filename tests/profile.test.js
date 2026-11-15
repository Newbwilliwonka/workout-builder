// Profile name, location, and bio rules. No browser and no database.
const assert = require('assert');
const P = require('../profile.js');

assert.strictEqual(P.PROMPT, 'To protect your email account from spammers, please enter a name in your profile before proceeding.');
assert.strictEqual(P.EMPTY, 'Fill in the highlighted fields.');
assert.strictEqual(P.BIO_MAX, 150);

assert.strictEqual(P.needsName({ profileReady: true, display_name: '' }), true);
assert.strictEqual(P.needsName({ profileReady: true, display_name: '   ' }), true);
assert.strictEqual(P.needsName({ profileReady: true, display_name: 'J' }), false);
assert.strictEqual(P.needsName({ membership: 'trainer', display_name: '' }), false);

assert.strictEqual(P.locationRequired({ membership: 'trainer' }), true);
assert.strictEqual(P.locationRequired({ membership: 'master_trainer' }), true);
assert.strictEqual(P.locationRequired({ membership: 'none', intended_plan: 'trainer' }), true);
assert.strictEqual(P.locationRequired({ membership: 'enthusiast', intended_plan: 'trainer' }), false);
assert.strictEqual(P.locationRequired({ membership: 'free_client' }), false);

const nick = P.validate({ display_name: '  J!  ', membership: 'enthusiast' });
assert.strictEqual(nick.ok, true);
assert.strictEqual(nick.fields.display_name, 'J!');
assert.strictEqual(nick.fields.city, null);

const blank = P.validate({ display_name: '   ', membership: 'free_client' });
assert.strictEqual(blank.ok, false);
assert.strictEqual(blank.empty.name, true);
assert.strictEqual(blank.message, P.EMPTY);

const trainer = P.validate({ display_name: 'Ace', membership: 'trainer' });
assert.strictEqual(trainer.ok, false);
assert.strictEqual(trainer.empty.city, true);
assert.strictEqual(trainer.empty.state, true);
assert.strictEqual(trainer.empty.name, undefined);

const online = P.validate({ display_name: 'Ace', membership: 'master_trainer', online_only: true });
assert.strictEqual(online.ok, true);
assert.strictEqual(online.fields.online_only, true);

const place = P.validate({ display_name: 'Ace', membership: 'trainer', city: ' Austin ', state: 'TX' });
assert.strictEqual(place.ok, true);
assert.strictEqual(place.fields.city, 'Austin');
assert.strictEqual(place.fields.state, 'TX');

const partial = P.validate({ display_name: 'Ace', membership: 'trainer', city: 'Austin' });
assert.strictEqual(partial.ok, false);
assert.strictEqual(partial.empty.city, undefined);
assert.strictEqual(partial.empty.state, true);

assert.strictEqual(P.label({ name: 'Ada', email: 'ada@example.com' }), 'Ada');
assert.strictEqual(P.label({ email: 'ada@example.com' }), 'ada@example.com');
assert.strictEqual(P.label({ trainerName: 'Sam', trainerEmail: 's@example.com' }), 'Sam');
assert.strictEqual(P.fromTrainer({ name: 'Friday', sourceTrainerName: 'Sam', sourceTrainerEmail: 's@example.com' }), 'Sam');
assert.strictEqual(P.fromTrainer({ name: 'Friday', sourceTrainerEmail: 's@example.com' }), 's@example.com');

const sheet = P.sheetHtml({ required: true, display_name: '', bio: 'hi' });
assert.ok(sheet.indexOf(P.PROMPT) > 0);
assert.ok(sheet.indexOf('id="profile-cancel"') === -1);
assert.ok(sheet.indexOf('1/150') === -1);
assert.ok(sheet.indexOf('>hi</textarea>') > 0);
assert.ok(sheet.indexOf('2/150') > 0);
const edit = P.sheetHtml({ required: false, display_name: 'Sam' });
assert.ok(edit.indexOf(P.PROMPT) === -1);
assert.ok(edit.indexOf('id="profile-cancel"') > 0);

console.log('profile rules ok');
