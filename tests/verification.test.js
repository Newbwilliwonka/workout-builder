// Master Trainer verification rules. No browser and no database.
const assert = require('assert');
const P = require('../profile.js');

const TODAY = '2026-11-15';

assert.strictEqual(P.ADMIN_EMAIL, 'kinisiathletics@gmail.com');
assert.strictEqual(P.isAdminEmail('  KinisiAthletics@gmail.com '), true);
assert.strictEqual(P.isAdminEmail('other@example.com'), false);
assert.strictEqual(P.isAdminEmail(''), false);

assert.strictEqual(P.todayISO(new Date(Date.UTC(2026, 10, 15, 23, 30))), '2026-11-15');
assert.strictEqual(P.isoDate('2026-11-15T05:00:00Z'), '2026-11-15');
assert.strictEqual(P.isoDate('2026-02-31'), '');
assert.strictEqual(P.isoDate('11/15/2026'), '');
assert.strictEqual(P.formatDay('2026-12-01'), 'Dec 1, 2026');
assert.strictEqual(P.formatDay('2028-10-26'), 'Oct 26, 2028');

assert.strictEqual(P.isVerified(null, TODAY), false);
assert.strictEqual(P.isVerified('2026-11-14', TODAY), false);
assert.strictEqual(P.isVerified('2026-11-15', TODAY), true);
assert.strictEqual(P.isVerified('2026-12-01T00:00:00+00:00', TODAY), true);
assert.strictEqual(P.isVerified('nope', TODAY), false);

const missing = P.validateVerification({}, TODAY);
assert.strictEqual(missing.ok, false);
assert.strictEqual(missing.empty.body, true);
assert.strictEqual(missing.empty.number, true);
assert.strictEqual(missing.empty.expires, true);
assert.strictEqual(missing.message, 'Fill in the highlighted fields.');

const past = P.validateVerification({
  cert_body: ' NASM ',
  cert_number: ' A-1 ',
  expires_on: TODAY
}, TODAY);
assert.strictEqual(past.ok, false);
assert.strictEqual(past.empty.body, undefined);
assert.strictEqual(past.empty.expires, true);
assert.strictEqual(past.message, 'Expiration date must be in the future.');
assert.strictEqual(past.fields.cert_body, 'NASM');
assert.strictEqual(past.fields.cert_number, 'A-1');

const tomorrow = P.validateVerification({
  body: 'ACE',
  number: '99',
  expiresOn: '2026-11-16'
}, TODAY);
assert.strictEqual(tomorrow.ok, true);
assert.strictEqual(tomorrow.message, '');
assert.deepStrictEqual(tomorrow.fields, {
  cert_body: 'ACE',
  cert_number: '99',
  expires_on: '2026-11-16'
});

const longBody = P.validateVerification({
  cert_body: 'x'.repeat(P.CERT_BODY_MAX + 1),
  cert_number: '1',
  expires_on: '2027-01-01'
}, TODAY);
assert.strictEqual(longBody.ok, false);
assert.strictEqual(longBody.message, 'Certification details are too long.');

const blankNote = P.validateDecline('   ');
assert.strictEqual(blankNote.ok, false);
assert.strictEqual(blankNote.message, 'Enter a note.');
const note = P.validateDecline('  Number does not match. ');
assert.strictEqual(note.ok, true);
assert.strictEqual(note.note, 'Number does not match.');
assert.strictEqual(P.validateDecline('n'.repeat(P.NOTE_MAX + 1)).ok, false);

assert.deepStrictEqual(P.verificationView({ membership: 'trainer', today: TODAY }), {
  show: false, verified: false, mode: 'hidden', note: '', link: false
});
assert.deepStrictEqual(P.verificationView({
  membership: 'master_trainer',
  verifiedUntil: '2026-12-01',
  requests: [{ status: 'approved', created_at: '2026-11-01T00:00:00Z' }],
  today: TODAY
}), { show: true, verified: true, mode: 'verified', note: '', link: false, ends: '2026-12-01' });
assert.deepStrictEqual(P.verificationView({
  membership: 'master_trainer',
  verifiedUntil: '2026-11-14',
  requests: [{ status: 'approved', created_at: '2026-10-01T00:00:00Z' }],
  today: TODAY
}), { show: true, verified: false, mode: 'open', note: '', link: true });
assert.deepStrictEqual(P.verificationView({
  membership: 'master_trainer',
  requests: [
    { status: 'declined', admin_note: 'Old', created_at: '2026-11-01T00:00:00Z' },
    { status: 'pending', created_at: '2026-11-02T00:00:00Z' }
  ],
  today: TODAY
}), { show: true, verified: false, mode: 'pending', note: '', link: false });
assert.deepStrictEqual(P.verificationView({
  membership: 'master_trainer',
  requests: [{ status: 'declined', admin_note: '  Check the number. ', created_at: '2026-11-02T00:00:00Z' }],
  today: TODAY
}), { show: true, verified: false, mode: 'declined', note: 'Check the number.', link: true });

const seal = P.sealHtml();
assert.ok(seal.indexOf('aria-label="Verified"') > 0);
assert.ok(seal.indexOf('width="1em"') > 0);
assert.ok(seal.indexOf('height="1em"') > 0);
assert.ok(seal.indexOf('role="img"') > 0);
const points = seal.match(/points="([^"]+)"/);
assert.ok(points);
assert.strictEqual(points[1].split(' ').length, 24);
assert.strictEqual(P.nameHtml('Coach Kim', false), 'Coach Kim');
assert.ok(P.nameHtml('Coach Kim', true).indexOf('Coach Kim') > 0);
assert.ok(P.nameHtml('Coach Kim', true).indexOf('aria-label="Verified"') > 0);
assert.strictEqual(P.nameHtml('A & B', false), 'A &amp; B');
assert.ok(P.fromTrainerHtml({ sourceTrainerName: 'Sam', sourceTrainerVerified: true }).indexOf('aria-label="Verified"') > 0);
assert.strictEqual(P.fromTrainerHtml({ sourceTrainerEmail: 's@example.com' }), 'Trainer');
assert.strictEqual(P.fromTrainerHtml({ sourceTrainerName: 's@example.com' }), 'Trainer');
assert.ok(P.fromTrainerHtml({ sourceTrainerName: 'Sam', sourceTrainerEmail: 's@example.com' }).indexOf('s@example.com') === -1);

const open = P.verifyAreaHtml(P.verificationView({ membership: 'master_trainer', today: TODAY }));
assert.ok(open.indexOf('Get verified') > 0);
assert.ok(open.indexOf('id="verify-form"') > 0);
assert.ok(open.indexOf('Certifying organization') > 0);
assert.strictEqual(open.indexOf('Certification body'), -1);
assert.ok(open.indexOf('Certification number') > 0);
assert.ok(open.indexOf('Expiration date') > 0);
assert.ok(open.indexOf('hidden') > 0);
const pending = P.verifyAreaHtml({ show: true, mode: 'pending', link: false, note: 'secret' });
assert.strictEqual(pending.indexOf('Get verified'), -1);
assert.ok(pending.indexOf('Pending review') > 0);
assert.strictEqual(pending.indexOf('secret'), -1);
const declined = P.verifyAreaHtml(P.verificationView({
  membership: 'master_trainer',
  requests: [{ status: 'declined', admin_note: 'Send the card', created_at: '2026-11-02' }],
  today: TODAY
}));
assert.ok(declined.indexOf('Send the card') > 0);
assert.ok(declined.indexOf('Get verified') > 0);
assert.strictEqual(P.verifyAreaHtml({ show: true, mode: 'verified' }), '');
assert.strictEqual(
  P.verifyAreaHtml({ show: true, mode: 'verified', ends: '2028-10-26' }),
  '<p class="verify-status" id="verify-ends">Verification ends Oct 26, 2028</p>'
);
assert.strictEqual(P.verifyAreaHtml({ show: true, mode: 'verified', ends: '2028-10-26' }).indexOf('Get verified'), -1);
const active = P.verifyAreaHtml(P.verificationView({
  membership: 'master_trainer',
  verifiedUntil: '2028-10-26',
  today: TODAY
}));
assert.ok(active.indexOf('Verification ends Oct 26, 2028') > 0);
assert.strictEqual(active.indexOf('Get verified'), -1);
assert.strictEqual(P.verifyAreaHtml({ show: false }), '');

const plain = P.sheetHtml({ display_name: 'J', bio: '' });
assert.ok(plain.indexOf('id="verify-slot"') === -1);
assert.ok(plain.indexOf('>Profile</h3>') > 0);
const master = P.sheetHtml({ master: true, display_name: 'Coach Kim', membership: 'master_trainer' });
assert.ok(master.indexOf('id="verify-slot"') > 0);
assert.ok(master.indexOf('id="profile-name"') < master.indexOf('id="verify-slot"'));
assert.ok(master.indexOf('id="verify-slot"') < master.indexOf('id="profile-bio"'));
const sealed = P.sheetHtml({ verified: true, display_name: 'Coach Kim' });
assert.ok(sealed.indexOf('aria-label="Verified"') > 0);
assert.ok(sealed.indexOf('Coach Kim') > 0);
assert.ok(sealed.indexOf('id="verify-slot"') === -1);
assert.strictEqual(sealed.indexOf('Verification ends'), -1);
const ownSeal = P.sheetHtml({
  master: true,
  verified: true,
  verified_until: '2028-10-26',
  display_name: 'Coach Kim',
  bio: 'Strength'
});
assert.ok(ownSeal.indexOf('id="profile-name"') < ownSeal.indexOf('id="verify-ends"'));
assert.ok(ownSeal.indexOf('id="verify-ends"') < ownSeal.indexOf('id="profile-bio"'));
assert.ok(ownSeal.indexOf('Verification ends Oct 26, 2028') > 0);
assert.strictEqual(ownSeal.indexOf('Get verified'), -1);

console.log('verification rules ok');
