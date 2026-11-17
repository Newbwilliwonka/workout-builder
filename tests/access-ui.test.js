// Waiting-for-access screen and the admin Access section. No live database.
// node tests/access-ui.test.js [url]
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
    window.__mode = 'waiting';
    window.__accounts = [
      { id: 'wait-new', display_name: 'Sam Ortiz', email: 'sam@example.com', approved: false, created_at: '2026-11-16T18:00:00.000Z' },
      { id: 'wait-old', display_name: 'Riley Chen', email: 'riley@example.com', approved: false, created_at: '2026-11-15T12:00:00.000Z' },
      { id: 'ok-new', display_name: 'Jordan Hale', email: 'jordan@example.com', approved: true, created_at: '2026-11-14T09:00:00.000Z' },
      { id: 'ok-old', display_name: 'Alex Nguyen', email: 'alex@example.com', approved: true, created_at: '2026-11-10T09:00:00.000Z' }
    ];
    window.__queue = [{
      id: 'req-1',
      display_name: 'Coach Kim',
      email: 'coach@example.com',
      cert_body: 'NASM',
      cert_number: 'A-100',
      expires_on: '2027-06-01',
      created_at: '2026-11-15T15:04:00.000Z'
    }];
    var current;
    function patch(api) {
      if (!api || api.__accessStub) return api;
      api.__accessStub = true;
      api.session = function () {
        if (window.__mode === 'out') return Promise.resolve(null);
        if (window.__mode === 'waiting' || window.__mode === 'held' || window.__mode === 'held-ok' || window.__mode === 'held-done') {
          return Promise.resolve({ user: { id: 'pat', email: 'pat@example.com' } });
        }
        if (window.__mode === 'member') return Promise.resolve({ user: { id: 'member', email: 'member@example.com' } });
        return Promise.resolve({ user: { id: 'admin', email: 'kinisiathletics@gmail.com' } });
      };
      api.freshSession = function () { return api.session(); };
      api.signIn = function (email, password) {
        window.__signIn = password;
        return Promise.resolve({ session: { user: { id: 'pat', email: email } } });
      };
      api.signUp = function (email, password) {
        window.__signUp = password;
        if (window.__holdInvite) {
          window.__mode = 'held';
          return Promise.resolve({ session: { user: { id: 'pat', email: 'pat@example.com' } }, needsConfirmation: false });
        }
        return Promise.resolve({ needsConfirmation: true });
      };
      api.redeemInvite = function (code) {
        window.__redeemed = (window.__redeemed || 0) + 1;
        window.__redeemCode = code;
        if (window.__mode === 'held') return Promise.reject(new Error('Your account is waiting for approval.'));
        window.__mode = 'held-done';
        return Promise.resolve({ membership: 'free_client', message: 'You are connected as a Free Client.' });
      };
      api.profile = function () {
        if (window.__mode === 'out') return Promise.resolve(null);
        if (window.__mode === 'waiting' || window.__mode === 'held') {
          return Promise.resolve({
            id: 'pat', email: 'pat@example.com', membership: 'none', access_approved: false,
            display_name: 'Pat Lee', profileReady: true
          });
        }
        if (window.__mode === 'held-ok') {
          return Promise.resolve({
            id: 'pat', email: 'pat@example.com', membership: 'none', access_approved: true,
            display_name: 'Pat Lee', profileReady: true
          });
        }
        if (window.__mode === 'held-done') {
          return Promise.resolve({
            id: 'pat', email: 'pat@example.com', membership: 'free_client', access_approved: true,
            display_name: 'Pat Lee', profileReady: true
          });
        }
        if (window.__mode === 'member') {
          return Promise.resolve({
            id: 'member', email: 'member@example.com', membership: 'enthusiast', access_approved: true,
            display_name: 'Member', profileReady: true, intended_plan: 'enthusiast'
          });
        }
        return Promise.resolve({
          id: 'admin', email: 'kinisiathletics@gmail.com', membership: 'trainer', access_approved: true,
          display_name: 'Kinisi Admin', profileReady: true, online_only: true, intended_plan: 'trainer'
        });
      };
      api.signOut = function () { window.__signedOut = true; return Promise.resolve(); };
      api.roster = function () { return Promise.resolve({ role: 'trainer', cap: 10, clientCount: 0, canCreate: true, clients: [], invites: [] }); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.workoutCopies = function () { return Promise.resolve([]); };
      api.accountPull = function () { return Promise.resolve([]); };
      api.accountImport = function () { return Promise.resolve({}); };
      api.accountPush = function () { return Promise.resolve({}); };
      api.avatarUrl = function () { return Promise.resolve(''); };
      api.verificationQueue = function () { return Promise.resolve(window.__queue.slice()); };
      api.accessAccounts = function () { return Promise.resolve(window.__accounts.slice()); };
      api.setAccess = function (id, approved) {
        window.__accessSet = { id: id, approved: approved };
        window.__accounts = window.__accounts.map(function (row) {
          return row.id === id ? Object.assign({}, row, { approved: !!approved }) : row;
        });
        return Promise.resolve();
      };
      api.reviewVerification = function () { return Promise.resolve({}); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });

  await p.goto(URL + '#/', { waitUntil: 'networkidle0' });
  await p.waitForSelector('#access-wait');
  const waiting = await p.evaluate(function () {
    var gate = document.getElementById('access-wait');
    return {
      title: document.getElementById('title').textContent,
      heading: gate.querySelector('h2').textContent,
      lede: gate.querySelector('.lede').textContent,
      signOut: document.getElementById('access-signout').textContent,
      headerOut: !document.getElementById('account-signout').hidden,
      builder: !!document.querySelector('[data-b]'),
      admin: !!document.getElementById('admin-open')
    };
  });
  assert.strictEqual(waiting.title, 'Waiting for access');
  assert.strictEqual(waiting.heading, 'Waiting for access');
  assert.strictEqual(waiting.lede, 'Your account is waiting for approval.');
  assert.strictEqual(waiting.signOut, 'Sign out');
  assert.strictEqual(waiting.headerOut, true);
  assert.strictEqual(waiting.builder, false);
  assert.strictEqual(waiting.admin, false);
  await p.screenshot({ path: ART + '/waiting-for-access.png' });

  await p.click('#access-signout');
  await p.waitForFunction(function () { return location.hash === '#/signin' && window.__signedOut === true; });

  await p.evaluate(function () {
    window.__mode = 'admin';
    location.hash = '#/account';
  });
  await p.waitForFunction(function () {
    var btn = document.getElementById('admin-open');
    var badge = document.getElementById('admin-count');
    return btn && badge && !badge.hidden && badge.textContent === '3';
  });
  const account = await p.evaluate(function () {
    var nav = document.getElementById('account-nav');
    var badge = document.getElementById('admin-count');
    return {
      title: document.getElementById('title').textContent,
      buttons: Array.prototype.map.call(nav.querySelectorAll('button'), function (b) { return b.textContent.replace(/\s+/g, ' ').trim(); }),
      label: badge.getAttribute('aria-label'),
      link: !!document.querySelector('.admin-link, #admin-verifications')
    };
  });
  assert.strictEqual(account.title, 'Account');
  assert.ok(account.buttons.indexOf('Messages') !== -1);
  assert.ok(account.buttons.some(function (t) { return t.indexOf('Admin') === 0; }));
  assert.strictEqual(account.label, '3 pending');
  assert.strictEqual(account.link, false);
  await p.evaluate(function () {
    document.getElementById('admin-open').scrollIntoView({ block: 'center' });
  });
  await p.screenshot({ path: ART + '/account-admin-button.png' });

  await p.click('#admin-open');
  await p.waitForSelector('#access-waiting [data-account="wait-new"]');
  const access = await p.evaluate(function () {
    function card(id) {
      var el = document.querySelector('[data-account="' + id + '"]');
      return el ? el.innerText : '';
    }
    var waitingIds = Array.prototype.map.call(document.querySelectorAll('#access-waiting [data-account]'), function (el) {
      return el.getAttribute('data-account');
    });
    var approvedIds = Array.prototype.map.call(document.querySelectorAll('#access-approved [data-account]'), function (el) {
      return el.getAttribute('data-account');
    });
    return {
      title: document.getElementById('title').textContent,
      accessHeading: document.querySelector('#access-section h2').textContent,
      verifyHeading: document.querySelector('#verifications-section h2').textContent,
      waitingIds: waitingIds,
      approvedIds: approvedIds,
      sam: card('wait-new'),
      riley: card('wait-old'),
      jordan: card('ok-new')
    };
  });
  assert.strictEqual(access.title, 'Admin');
  assert.strictEqual(access.accessHeading, 'Access');
  assert.strictEqual(access.verifyHeading, 'Verifications');
  assert.deepStrictEqual(access.waitingIds, ['wait-new', 'wait-old']);
  assert.deepStrictEqual(access.approvedIds, ['ok-new', 'ok-old']);
  assert.ok(access.sam.indexOf('Sam Ortiz') !== -1);
  assert.ok(access.sam.indexOf('sam@example.com') !== -1);
  assert.ok(access.sam.indexOf('Approve') !== -1);
  assert.ok(access.sam.indexOf('Remove access') !== -1);
  assert.ok(access.riley.indexOf('riley@example.com') !== -1);
  assert.ok(access.jordan.indexOf('Jordan Hale') !== -1);
  assert.ok(access.jordan.indexOf('jordan@example.com') !== -1);
  assert.ok(access.jordan.indexOf('Approve') === -1);
  assert.ok(access.jordan.indexOf('Remove access') !== -1);
  await p.screenshot({ path: ART + '/admin-access.png', fullPage: true });

  await p.click('#access-waiting [data-access="approve"]');
  await p.waitForFunction(function () {
    return window.__accessSet && window.__accessSet.id === 'wait-new' && window.__accessSet.approved === true
      && !document.querySelector('#access-waiting [data-account="wait-new"]')
      && document.querySelector('#access-approved [data-account="wait-new"]');
  });

  await p.evaluate(function () {
    window.__mode = 'member';
    location.hash = '#/account';
  });
  await p.waitForSelector('#account-label');
  assert.strictEqual(await p.$('#admin-open'), null);
  await p.evaluate(function () { location.hash = '#/'; });
  await p.waitForFunction(function () { return !document.getElementById('access-wait') && document.getElementById('title').textContent !== 'Waiting for access'; });

  await p.evaluate(function () {
    window.__mode = 'out';
    window.__signIn = '';
    window.__signUp = '';
    location.hash = '#/signin';
  });
  await p.waitForSelector('#acct-pass');
  await p.evaluate(function () {
    document.getElementById('acct-email').value = '';
    document.getElementById('acct-pass').value = '';
  });
  await p.type('#acct-email', 'pat@example.com');
  await p.type('#acct-pass', 'secret12');
  await p.click('[data-auth=in]');
  await p.waitForFunction(function () { return window.__signIn === 'secret12'; });

  await p.evaluate(function () {
    window.__signUp = '';
    location.hash = '#/join';
  });
  await p.waitForSelector('[data-auth=up]');
  await p.type('#acct-email', 'pat@example.com');
  await p.type('#acct-pass', 'secret12');
  await p.click('[data-auth=up]');
  await p.waitForFunction(function () { return document.body.innerText.indexOf('at least 10 characters') !== -1; });
  assert.strictEqual(await p.evaluate(function () { return window.__signUp; }), '');

  await p.evaluate(function () {
    window.__holdInvite = true;
    window.__redeemed = 0;
    window.__mode = 'out';
    location.hash = '#/join';
  });
  await p.waitForSelector('[data-auth=up]');
  await p.evaluate(function () {
    document.getElementById('acct-email').value = '';
    document.getElementById('acct-pass').value = '';
  });
  await p.type('#acct-email', 'pat@example.com');
  await p.type('#acct-pass', 'secret1234');
  await p.type('#invite-code', 'ABCD2345');
  await p.click('[data-auth=up]');
  await p.waitForSelector('#access-wait');
  assert.strictEqual(await p.evaluate(function () { return window.__redeemed; }), 1);
  assert.strictEqual(await p.evaluate(function () { return sessionStorage.getItem('wb.invite'); }), 'ABCD2345');
  await p.evaluate(function () {
    window.__mode = 'held-ok';
    location.hash = '#/';
  });
  await p.waitForFunction(function () {
    return window.__redeemed === 2 && location.hash === '#/' && !document.getElementById('access-wait') && sessionStorage.getItem('wb.invite') == null;
  });
  assert.strictEqual(await p.evaluate(function () { return window.__redeemCode; }), 'ABCD2345');

  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('access ui ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
