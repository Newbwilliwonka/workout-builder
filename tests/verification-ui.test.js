// Get verified, the seal, and the admin queue. No live database.
// node tests/verification-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const chrome = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
  const b = await pp.launch({ executablePath: chrome, args: ['--no-sandbox', '--hide-scrollbars'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', function (e) { errs.push(String(e)); });
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument(function () {
    window.__profile = {
      id: 'coach-1',
      email: 'coach@example.com',
      membership: 'master_trainer',
      intended_plan: 'master_trainer',
      profileReady: true,
      display_name: 'Coach Kim',
      city: null,
      state: null,
      online_only: true,
      bio: 'Strength and conditioning',
      avatar_path: null,
      avatarUrl: '',
      verified_until: '2027-06-01'
    };
    window.__session = { user: { id: 'coach-1', email: 'coach@example.com' } };
    window.__requests = [];
    window.__queue = [{
      id: 'req-9',
      user_id: 'coach-1',
      display_name: 'Coach Kim',
      email: 'coach@example.com',
      cert_body: 'NASM',
      cert_number: 'A-100',
      expires_on: '2027-06-01',
      created_at: '2026-11-15T15:04:00.000Z'
    }];
    window.__conn = null;
    var current;
    function patch(api) {
      if (!api || api.__verifyStub) return api;
      api.__verifyStub = true;
      api.session = function () { return Promise.resolve(window.__session); };
      api.freshSession = function () { return api.session(); };
      api.profile = function () { return Promise.resolve(window.__profile); };
      api.roster = function () {
        return Promise.resolve({ role: 'master_trainer', cap: 30, clientCount: 0, canCreate: true, clients: [], invites: [] });
      };
      api.myConnection = function () { return Promise.resolve(window.__conn); };
      api.workoutCopies = function () { return Promise.resolve([]); };
      api.shareSetting = function () { return Promise.resolve({ on: false, enthusiast: false }); };
      api.accountPull = function () { return Promise.resolve([]); };
      api.signOut = function () { return Promise.resolve(); };
      api.avatarUrl = function () { return Promise.resolve(''); };
      api.myVerifications = function () { return Promise.resolve(window.__requests.slice()); };
      api.submitVerification = function (fields) {
        var row = {
          id: 'req-new',
          status: 'pending',
          admin_note: null,
          created_at: '2026-11-15T16:00:00.000Z',
          cert_body: fields.cert_body,
          cert_number: fields.cert_number,
          expires_on: fields.expires_on
        };
        window.__submitted = fields;
        window.__requests = [row].concat(window.__requests);
        return Promise.resolve(row);
      };
      api.verificationQueue = function () {
        window.__queueReads = (window.__queueReads || 0) + 1;
        return Promise.resolve(window.__queue.slice());
      };
      api.reviewVerification = function (id, status, note) {
        window.__review = { id: id, status: status, note: note };
        window.__queue = window.__queue.filter(function (row) { return row.id !== id; });
        return Promise.resolve({ id: id, status: status, admin_note: note || null });
      };
      api.threads = function () {
        return Promise.resolve({
          role: 'client',
          threads: [{ id: 'coach-1', name: 'Coach Kim', plan: 'Trainer', verified: true, preview: 'See you Friday', at: '2026-11-15T15:00:00.000Z', unread: 0 }]
        });
      };
      api.messages = function () {
        return Promise.resolve({
          person: { id: 'coach-1', name: 'Coach Kim', plan: 'Trainer', verified: true },
          messages: []
        });
      };
      api.markRead = function () { return Promise.resolve(); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });

  await p.goto(URL + '#/account', { waitUntil: 'networkidle0' });
  await p.waitForSelector('#account-label .seal');
  const accountSeal = await p.evaluate(function () {
    var name = document.querySelector('#account-label .nm');
    var seal = document.querySelector('#account-label .seal');
    var size = parseFloat(getComputedStyle(name).fontSize);
    var box = seal.getBoundingClientRect();
    return {
      text: name.textContent,
      label: seal.getAttribute('aria-label'),
      width: seal.getAttribute('width'),
      height: seal.getAttribute('height'),
      size: size,
      box: box.height,
      link: !!document.getElementById('verify-open'),
      admin: !!document.getElementById('admin-open')
    };
  });
  assert.strictEqual(accountSeal.text, 'Coach Kim');
  assert.strictEqual(accountSeal.label, 'Verified');
  assert.strictEqual(accountSeal.width, '1em');
  assert.strictEqual(accountSeal.height, '1em');
  assert.ok(Math.abs(accountSeal.box - accountSeal.size) < 1.5, 'seal height ' + accountSeal.box + ' vs name ' + accountSeal.size);
  assert.strictEqual(accountSeal.link, false);
  assert.strictEqual(accountSeal.admin, false);

  await p.click('#profile-open');
  await p.waitForSelector('#profile-title .seal');
  await p.waitForSelector('#profile-bio');
  const profileSeal = await p.evaluate(function () {
    var title = document.getElementById('profile-title');
    var bio = document.getElementById('profile-bio');
    return {
      name: title.querySelector('.nm').textContent,
      seal: !!title.querySelector('.seal'),
      bio: bio.value,
      link: !!document.getElementById('verify-open'),
      slot: !!document.getElementById('verify-slot'),
      ends: (document.getElementById('verify-ends') || {}).textContent || '',
      endsAfterBio: !!(document.getElementById('verify-ends') && (bio.compareDocumentPosition(document.getElementById('verify-ends')) & Node.DOCUMENT_POSITION_FOLLOWING)),
      bioBeforeSeal: bio.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING
    };
  });
  assert.strictEqual(profileSeal.name, 'Coach Kim');
  assert.strictEqual(profileSeal.seal, true);
  assert.strictEqual(profileSeal.bio, 'Strength and conditioning');
  assert.strictEqual(profileSeal.link, false);
  assert.strictEqual(profileSeal.slot, true);
  assert.strictEqual(profileSeal.ends, 'Verification ends Jun 1, 2027');
  assert.strictEqual(profileSeal.endsAfterBio, true);
  const endsBox = await p.evaluate(function () {
    var el = document.getElementById('verify-ends');
    return el.getBoundingClientRect().height;
  });
  assert.ok(endsBox > 8, 'ends line height ' + endsBox);
  assert.ok(profileSeal.bioBeforeSeal === 0);
  await p.screenshot({ path: ART + '/profile-seal.png' });

  await p.click('#profile-cancel');
  await p.evaluate(function () { location.hash = '#/messages/coach-1'; });
  await p.waitForFunction(function () {
    var title = document.getElementById('title');
    return title && title.querySelector('.seal') && title.querySelector('.nm') && title.querySelector('.nm').textContent === 'Coach Kim';
  });
  const header = await p.evaluate(function () {
    var seal = document.querySelector('#title .seal');
    var name = document.querySelector('#title .nm');
    var size = parseFloat(getComputedStyle(name).fontSize);
    return { label: seal.getAttribute('aria-label'), box: seal.getBoundingClientRect().height, size: size };
  });
  assert.strictEqual(header.label, 'Verified');
  assert.ok(Math.abs(header.box - header.size) < 1.5);

  await p.evaluate(function () {
    window.__profile.membership = 'free_client';
    window.__profile.display_name = 'Ada';
    window.__profile.verified_until = null;
    window.__profile.bio = '';
    window.__conn = { trainerId: 'coach-1', trainerName: 'Coach Kim', trainerEmail: 'coach@example.com', verified: true };
    location.hash = '#/account';
  });
  await p.waitForFunction(function () {
    var card = document.getElementById('redeem');
    return card && card.querySelector('.seal') && card.textContent.indexOf('Coach Kim') !== -1;
  });

  await p.evaluate(function () {
    window.__profile.membership = 'master_trainer';
    window.__profile.display_name = 'Coach Kim';
    window.__profile.online_only = true;
    window.__profile.bio = 'Strength and conditioning';
    window.__profile.verified_until = '2026-01-01';
    window.__requests = [{ status: 'declined', admin_note: 'The number does not match the card.', created_at: '2026-11-14T12:00:00Z' }];
    window.__conn = null;
    location.hash = '#/account?declined=1';
  });
  await p.waitForFunction(function () {
    var el = document.getElementById('account-label');
    return el && el.textContent === 'Coach Kim' && !el.querySelector('.seal');
  });
  await p.click('#profile-open');
  await p.waitForSelector('#verify-note');
  const declined = await p.evaluate(function () {
    return {
      note: document.getElementById('verify-note').textContent,
      link: document.getElementById('verify-open').textContent,
      pending: !!document.getElementById('verify-status'),
      seal: !!document.querySelector('#profile-title .seal')
    };
  });
  assert.strictEqual(declined.note, 'The number does not match the card.');
  assert.strictEqual(declined.link, 'Get verified');
  assert.strictEqual(declined.pending, false);
  assert.strictEqual(declined.seal, false);
  const order = await p.evaluate(function () {
    var bio = document.getElementById('profile-bio');
    var link = document.getElementById('verify-open');
    return bio.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  assert.ok(order);

  await p.click('#verify-open');
  await p.waitForSelector('#verify-form');
  const opened = await p.evaluate(function () {
    return { hidden: document.getElementById('verify-form').hidden, link: document.getElementById('verify-open').hidden };
  });
  assert.strictEqual(opened.hidden, false);
  assert.strictEqual(opened.link, true);
  await p.click('#verify-submit');
  const blocked = await p.evaluate(function () {
    return {
      text: document.getElementById('verify-error').textContent,
      body: document.getElementById('verify-body').classList.contains('is-empty'),
      number: document.getElementById('verify-number').classList.contains('is-empty'),
      expires: document.getElementById('verify-expires').classList.contains('is-empty')
    };
  });
  assert.strictEqual(blocked.text, 'Fill in the highlighted fields.');
  assert.strictEqual(blocked.body, true);
  assert.strictEqual(blocked.number, true);
  assert.strictEqual(blocked.expires, true);

  await p.type('#verify-body', 'NASM');
  await p.type('#verify-number', 'A-100');
  await p.$eval('#verify-expires', function (el) { el.value = '2020-01-01'; });
  await p.click('#verify-submit');
  const past = await p.$eval('#verify-error', function (el) { return el.textContent; });
  assert.strictEqual(past, 'Expiration date must be in the future.');

  await p.$eval('#verify-expires', function (el) { el.value = '2027-06-01'; });
  await p.click('#verify-submit');
  await p.waitForSelector('#verify-status');
  const pending = await p.evaluate(function () {
    return {
      status: document.getElementById('verify-status').textContent,
      link: !!document.getElementById('verify-open'),
      sent: window.__submitted
    };
  });
  assert.strictEqual(pending.status, 'Pending review');
  assert.strictEqual(pending.link, false);
  assert.strictEqual(pending.sent.cert_body, 'NASM');
  assert.strictEqual(pending.sent.cert_number, 'A-100');
  assert.strictEqual(pending.sent.expires_on, '2027-06-01');

  await p.evaluate(function () {
    window.__session.user.email = 'kinisiathletics@gmail.com';
    location.hash = '#/admin/verifications';
  });
  await p.waitForSelector('[data-verify="approve"]');
  const queue = await p.evaluate(function () {
    var card = document.querySelector('[data-request="req-9"]');
    return {
      title: document.getElementById('title').textContent,
      text: card.innerText,
      approve: !!card.querySelector('[data-verify="approve"]'),
      decline: !!card.querySelector('[data-verify="decline"]')
    };
  });
  assert.strictEqual(queue.title, 'Admin');
  assert.ok(queue.text.indexOf('Certifying organization') !== -1);
  assert.strictEqual(queue.text.indexOf('Certification body'), -1);
  assert.ok(queue.text.indexOf('Coach Kim') !== -1);
  assert.ok(queue.text.indexOf('coach@example.com') !== -1);
  assert.ok(queue.text.indexOf('NASM') !== -1);
  assert.ok(queue.text.indexOf('A-100') !== -1);
  assert.ok(queue.text.indexOf('Jun 1, 2027') !== -1);
  assert.ok(queue.text.indexOf('Nov 15, 2026') !== -1);
  assert.strictEqual(queue.approve, true);
  assert.strictEqual(queue.decline, true);
  await p.screenshot({ path: ART + '/admin-verifications.png' });

  await p.click('[data-verify="decline"]');
  await p.waitForSelector('#note-req-9');
  await p.click('[data-verify="confirm-decline"]');
  const needNote = await p.evaluate(function () {
    return {
      text: document.getElementById('note-err-req-9').textContent,
      shown: !document.getElementById('note-err-req-9').hidden,
      review: window.__review || null
    };
  });
  assert.strictEqual(needNote.text, 'Enter a note.');
  assert.strictEqual(needNote.shown, true);
  assert.strictEqual(needNote.review, null);

  await p.type('#note-req-9', 'Number does not match.');
  await p.click('[data-verify="confirm-decline"]');
  await p.waitForSelector('#verify-empty');
  const reviewed = await p.evaluate(function () { return window.__review; });
  assert.deepStrictEqual(reviewed, { id: 'req-9', status: 'declined', note: 'Number does not match.' });

  await p.evaluate(function () {
    window.__queue = [{
      id: 'req-8',
      display_name: 'Coach Kim',
      email: 'coach@example.com',
      cert_body: 'ACE',
      cert_number: 'Z-9',
      expires_on: '2027-01-02',
      created_at: '2026-11-10T12:00:00.000Z'
    }];
    location.hash = '#/account';
  });
  await p.waitForFunction(function () {
    var btn = document.getElementById('admin-open');
    var badge = document.getElementById('admin-count');
    return btn && btn.textContent.indexOf('Admin') === 0 && badge && !badge.hidden && badge.textContent === '1' && window.__queueReads > 0;
  });
  const pendingBadge = await p.evaluate(function () {
    var badge = document.getElementById('admin-count');
    var style = getComputedStyle(badge);
    var box = badge.getBoundingClientRect();
    return {
      label: badge.getAttribute('aria-label'),
      bg: style.backgroundColor,
      radius: style.borderRadius,
      round: Math.abs(box.width - box.height) < 1
    };
  });
  assert.strictEqual(pendingBadge.label, '1 pending');
  assert.strictEqual(pendingBadge.bg, 'rgb(220, 38, 38)');
  assert.ok(pendingBadge.round, 'badge is not circular');
  assert.ok(parseFloat(pendingBadge.radius) >= 11);
  await p.evaluate(function () {
    document.getElementById('admin-open').scrollIntoView({ block: 'center' });
  });
  await p.screenshot({ path: ART + '/account-admin-badge.png' });
  await p.click('#admin-open');
  await p.waitForSelector('[data-verify="approve"]');
  await p.click('[data-verify="approve"]');
  await p.waitForSelector('#verify-empty');
  const approved = await p.evaluate(function () { return window.__review; });
  assert.strictEqual(approved.status, 'approved');
  assert.strictEqual(approved.id, 'req-8');

  await p.evaluate(function () {
    window.__queueReads = 0;
    location.hash = '#/account';
  });
  await p.waitForFunction(function () {
    var badge = document.getElementById('admin-count');
    return window.__queueReads > 0 && badge && badge.hidden && document.getElementById('admin-open');
  });
  await p.evaluate(function () {
    window.__session.user.email = 'ada@example.com';
    location.hash = '#/admin/verifications';
  });
  await p.waitForSelector('#verify-admin-denied');
  assert.strictEqual(await p.$('#verify-queue'), null);
  await p.evaluate(function () { location.hash = '#/account'; });
  await p.waitForSelector('#account-label');
  assert.strictEqual(await p.$('#admin-open'), null);

  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('verification ui ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
