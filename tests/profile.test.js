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
assert.strictEqual(online.fields.listed, false);
assert.strictEqual(online.fields.service_type, null);

const listed = P.validate({
  display_name: 'Ace', membership: 'trainer', online_only: true, listed: true, service_type: 'both'
});
assert.strictEqual(listed.ok, true);
assert.strictEqual(listed.fields.listed, true);
assert.strictEqual(listed.fields.service_type, 'both');
const listedBlank = P.validate({
  display_name: 'Ace', membership: 'master_trainer', online_only: true, listed: true
});
assert.strictEqual(listedBlank.ok, false);
assert.strictEqual(listedBlank.message, 'Choose in person, online, or both.');
const clientListed = P.validate({
  display_name: 'Ada', membership: 'free_client', listed: true, service_type: 'online'
});
assert.strictEqual(clientListed.ok, true);
assert.strictEqual(clientListed.fields.listed, false);
assert.strictEqual(clientListed.fields.service_type, null);
assert.strictEqual(P.canListInSearch({ membership: 'trainer' }), true);
assert.strictEqual(P.canListInSearch({ membership: 'enthusiast', intended_plan: 'trainer' }), false);
assert.strictEqual(P.canFindTrainers({ membership: 'free_client' }), true);
assert.strictEqual(P.canFindTrainers({ membership: 'enthusiast' }), true);
assert.strictEqual(P.canFindTrainers({ membership: 'trainer' }), false);
assert.strictEqual(P.canFindTrainers({ membership: 'none', intended_plan: 'enthusiast' }), true);
assert.strictEqual(P.serviceLabel('in_person'), 'In person');
assert.strictEqual(P.serviceLabel('<script>'), '');

const place = P.validate({ display_name: 'Ace', membership: 'trainer', city: ' Austin ', state: 'TX' });
assert.strictEqual(place.ok, true);
assert.strictEqual(place.fields.city, 'Austin');
assert.strictEqual(place.fields.state, 'TX');

const partial = P.validate({ display_name: 'Ace', membership: 'trainer', city: 'Austin' });
assert.strictEqual(partial.ok, false);
assert.strictEqual(partial.empty.city, undefined);
assert.strictEqual(partial.empty.state, true);

assert.strictEqual(P.label({ name: 'Ada', email: 'ada@example.com' }), 'Ada');
assert.strictEqual(P.label({ email: 'ada@example.com' }), '');
assert.strictEqual(P.label({ email: 'ada@example.com', plan: 'Free Client' }), 'Client');
assert.strictEqual(P.label({ name: 'ada@example.com', plan: 'Free Client' }), 'Client');
assert.strictEqual(P.label({ email: 'fan@example.com', plan: 'Enthusiast' }), 'Enthusiast');
assert.strictEqual(P.label({ name: 'fan', email: 'fan@example.com', plan: 'Enthusiast' }), 'fan');
assert.strictEqual(P.label({ trainerName: 'Sam', trainerEmail: 's@example.com' }), 'Sam');
assert.strictEqual(P.label({ trainerEmail: 's@example.com', plan: 'Trainer' }), 'Trainer');
assert.strictEqual(P.fromTrainer({ name: 'Friday', sourceTrainerName: 'Sam', sourceTrainerEmail: 's@example.com' }), 'Sam');
assert.strictEqual(P.fromTrainer({ name: 'Friday', sourceTrainerEmail: 's@example.com' }), '');
assert.strictEqual(P.fromTrainer({ sourceTrainerName: 'coach@example.com', sourceTrainerEmail: 'coach@example.com' }), '');
assert.strictEqual(P.isEmailAddress('ada@example.com'), true);
assert.strictEqual(P.isEmailAddress('Ada'), false);
assert.strictEqual(P.safeName('ada'), 'ada');
assert.strictEqual(P.safeName('ada@example.com'), '');

const sheet = P.sheetHtml({ required: true, display_name: '', bio: 'hi' });
assert.ok(sheet.indexOf(P.PROMPT) > 0);
assert.ok(sheet.indexOf('id="profile-cancel"') === -1);
assert.ok(sheet.indexOf('1/150') === -1);
assert.ok(sheet.indexOf('>hi</textarea>') > 0);
assert.ok(sheet.indexOf('2/150') > 0);
const edit = P.sheetHtml({ required: false, display_name: 'Sam' });
assert.ok(edit.indexOf(P.PROMPT) === -1);
assert.ok(edit.indexOf('id="profile-cancel"') > 0);
assert.ok(edit.indexOf('Show me in trainer search') === -1);
const coachSheet = P.sheetHtml({
  required: false,
  display_name: 'Coach Kim',
  canList: true,
  listed: false,
  service_type: '<script>',
  online_only: true
});
assert.ok(coachSheet.indexOf('Show me in trainer search') > 0);
assert.ok(coachSheet.indexOf('aria-checked="false"') > 0);
assert.ok(coachSheet.indexOf('class="switch on"') === -1);
assert.ok(coachSheet.indexOf('<script>') === -1);
assert.ok(coachSheet.indexOf('>In person<') > 0);
assert.ok(coachSheet.indexOf('>Online<') > 0);
assert.ok(coachSheet.indexOf('>Both<') > 0);
const coachOn = P.sheetHtml({ canList: true, listed: true, service_type: 'online', display_name: 'Coach Kim' });
assert.ok(coachOn.indexOf('aria-checked="true"') > 0);
assert.ok(coachOn.indexOf('value="online" selected') > 0);
assert.ok(edit.indexOf('id="profile-pin"') === -1);
assert.ok(coachSheet.indexOf(P.PIN_NOTE) > 0);
assert.ok(coachSheet.indexOf('id="pin-map"') > 0);
assert.ok(coachSheet.indexOf('id="pin-query"') > 0);
assert.ok(coachSheet.indexOf('id="pin-city"') === -1);
assert.ok(coachSheet.indexOf('id="pin-state"') === -1);
assert.ok(coachSheet.indexOf('OpenStreetMap') > 0);
const pinned = P.sheetHtml({
  canList: true,
  display_name: 'Coach',
  service_type: 'both',
  listed: true,
  pin: { city: '<script>', region: 'Texas', latitude: 30.2672, longitude: -97.74 }
});
assert.ok(pinned.indexOf('<script>') === -1);
assert.ok(pinned.indexOf('Public location: &lt;script&gt;, Texas') > 0);
assert.ok(pinned.indexOf('30.2672') === -1);
assert.ok(pinned.indexOf('id="pin-remove" hidden') === -1);

console.log('profile rules ok');
