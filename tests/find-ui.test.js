// Find a trainer, requests, and a temporary conversation. No live database.
// node tests/find-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';
const AMY = '11111111-1111-4111-8111-111111111111';
const BEA = '22222222-2222-4222-8222-222222222222';
const ADA = '12121212-1212-4121-8121-121212121212';
const QUINN = '66666666-6666-4666-8666-666666666666';

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const chrome = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
  const b = await pp.launch({ executablePath: chrome, args: ['--no-sandbox', '--hide-scrollbars'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', function (e) { errs.push(String(e)); });
  p.on('dialog', function (d) { d.accept(); });
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument(function (ids) {
    window.__mode = 'client';
    window.__expired = false;
    window.__sent = {};
    window.__requests = [{
      id: 'abababab-abab-4aba-8aba-abababababab',
      name: 'Ada <Lee>',
      role: 'Free Client',
      verified: false,
      note: 'Hello <script>alert(1)</script>',
      at: new Date().toISOString(),
      email: 'ada@example.com'
    }];
    var trainers = [
      { id: ids.AMY, name: 'Amy Coach', role: 'Master Trainer', verified: true, serviceType: 'both', request: 'none', email: 'amy@example.com' },
      { id: ids.BEA, name: 'Bea Coach', role: 'Trainer', verified: false, serviceType: 'online', request: 'none', email: 'bea@example.com' }
    ];
    function me() {
      if (window.__mode === 'trainer') {
        return { id: ids.QUINN, email: 'quinn@example.com', membership: 'trainer', name: 'Quinn Coach' };
      }
      return { id: ids.ADA, email: 'ada@example.com', membership: 'free_client', name: 'Ada Lee' };
    }
    var current;
    function patch(api) {
      if (!api || api.__findStub) return api;
      api.__findStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () {
        var who = me();
        return Promise.resolve({ user: { id: who.id, email: who.email } });
      };
      api.freshSession = function () { return api.session(); };
      api.profile = function () {
        var who = me();
        return Promise.resolve({
          id: who.id,
          email: who.email,
          membership: who.membership,
          display_name: who.name,
          access_approved: true,
          profileReady: true,
          online_only: true,
          listed: who.membership === 'trainer',
          service_type: who.membership === 'trainer' ? 'online' : null
        });
      };
      api.signOut = function () { return Promise.resolve(); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.roster = function () { return Promise.resolve({ role: null, clients: [], invites: [] }); };
      api.workoutCopies = function () { return Promise.resolve([]); };
      api.accountPull = function () { return Promise.resolve([]); };
      api.accountImport = function () { return Promise.resolve({}); };
      api.accountPush = function () { return Promise.resolve({}); };
      api.avatarUrl = function () { return Promise.resolve(''); };
      api.hubPosts = function () { return Promise.resolve([]); };
      api.trainerRequestCount = function () {
        return Promise.resolve(window.__mode === 'trainer' ? window.__requests.length : 0);
      };
      api.trainerSearch = function () {
        return Promise.resolve({
          mode: 'online',
          comingSoon: false,
          trainers: trainers.map(function (row) {
            return {
              id: row.id,
              name: row.name,
              role: row.role,
              verified: row.verified,
              serviceType: row.serviceType,
              request: window.__sent[row.id] ? 'open' : 'none'
            };
          })
        });
      };
      api.trainerRequestSend = function (id, note) {
        window.__sent[id] = note || '';
        window.__lastNote = note || '';
        return Promise.resolve({ id: 'sent', status: 'open' });
      };
      api.trainerRequests = function () { return Promise.resolve(window.__requests.slice()); };
      api.trainerRequestDecide = function (id, approve) {
        window.__decided = { id: id, approve: !!approve };
        window.__requests = window.__requests.filter(function (row) { return row.id !== id; });
        return Promise.resolve({ id: id, status: approve ? 'approved' : 'declined' });
      };
      api.threads = function () {
        if (window.__mode !== 'trainer') return Promise.resolve({ role: 'client', threads: [], requests: [] });
        return Promise.resolve({
          role: 'trainer',
          requestCount: window.__requests.length,
          requests: window.__requests.slice(),
          threads: [{
            id: ids.ADA,
            name: 'Ada Lee',
            plan: 'Free Client',
            verified: false,
            temporary: true,
            canSend: !window.__expired,
            daysLeft: window.__expired ? 0 : 6,
            preview: 'Hello from Ada',
            at: new Date().toISOString()
          }]
        });
      };
      api.messages = function () {
        return Promise.resolve({
          person: {
            id: ids.ADA,
            name: 'Ada Lee',
            plan: 'Free Client',
            verified: false,
            temporary: true,
            canSend: !window.__expired,
            daysLeft: window.__expired ? 0 : 6
          },
          messages: [
            { id: 'm1', mine: false, body: 'Hello <b>coach</b>', at: new Date().toISOString() },
            { id: 'm2', mine: true, body: 'Good to meet you', at: new Date().toISOString() }
          ]
        });
      };
      api.sendMessage = function (personId, messageId, body) {
        return Promise.resolve({ id: messageId, mine: true, body: body, at: new Date().toISOString() });
      };
      api.markRead = function () { return Promise.resolve({ ok: true }); };
      api.watchMessages = function () { return Promise.resolve(function () {}); };
      api.endTemporary = function () { window.__ended = true; return Promise.resolve({ ended: true }); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  }, { AMY: AMY, BEA: BEA, ADA: ADA, QUINN: QUINN });

  await p.goto(URL + '#/hub', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#hub-find');
  await p.click('#hub-find');
  await p.waitForSelector('#find-list');
  const results = await p.evaluate(function () {
    var near = document.getElementById('find-near');
    return {
      title: document.getElementById('title').textContent,
      text: document.getElementById('app').innerText,
      html: document.getElementById('app').innerHTML,
      nearDisabled: near.disabled,
      online: document.getElementById('find-online').classList.contains('on')
    };
  });
  assert.strictEqual(results.title, 'Find a trainer');
  assert.strictEqual(results.nearDisabled, true);
  assert.strictEqual(results.online, true);
  assert.ok(results.text.indexOf('Online only') !== -1);
  assert.ok(results.text.indexOf('Near me') !== -1);
  assert.ok(results.text.indexOf('Coming soon') !== -1);
  assert.ok(results.text.indexOf('Amy Coach') !== -1);
  assert.ok(results.text.indexOf('Master Trainer') !== -1);
  assert.ok(results.text.indexOf('Both') !== -1);
  assert.ok(results.text.indexOf('Bea Coach') !== -1);
  assert.ok(results.text.indexOf('Online') !== -1);
  assert.ok(results.text.indexOf('Request to message') !== -1);
  assert.ok(results.text.indexOf('@') === -1);
  assert.ok(results.html.indexOf('amy@example.com') === -1);
  await p.screenshot({ path: ART + '/find-trainer-online.png' });

  await p.click('[data-request="' + AMY + '"]');
  await p.waitForSelector('#find-note');
  await p.type('#find-note', 'I would like help with squats.');
  const form = await p.evaluate(function () {
    return {
      title: document.getElementById('title').textContent,
      count: document.getElementById('find-count').textContent,
      name: document.querySelector('#find-request .name').textContent,
      html: document.getElementById('app').innerHTML
    };
  });
  assert.strictEqual(form.title, 'Request to message');
  assert.strictEqual(form.count, '30/300');
  assert.ok(form.name.indexOf('Amy Coach') !== -1);
  assert.ok(form.html.indexOf('@') === -1);
  await p.screenshot({ path: ART + '/find-trainer-request.png' });
  await p.click('#find-send');
  await p.waitForSelector('#find-list');
  const after = await p.evaluate(function (id) {
    var card = document.querySelector('[data-trainer="' + id + '"]');
    return { text: card.innerText, sent: window.__lastNote };
  }, AMY);
  assert.ok(after.text.indexOf('Requested') !== -1);
  assert.strictEqual(after.sent, 'I would like help with squats.');

  await p.evaluate(function () { window.__mode = 'trainer'; });
  await p.goto(URL + '#/hub', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#hub-requests .request-count');
  await p.click('#hub-requests');
  await p.waitForSelector('[data-request-approve]');
  const inbox = await p.evaluate(function () {
    return {
      title: document.getElementById('title').textContent,
      text: document.getElementById('app').innerText,
      html: document.getElementById('app').innerHTML,
      approve: document.querySelector('[data-request-approve]').textContent,
      decline: document.querySelector('[data-request-decline]').textContent
    };
  });
  assert.strictEqual(inbox.title, 'Requests');
  assert.ok(inbox.text.indexOf('Ada <Lee>') !== -1 || inbox.text.indexOf('Ada') !== -1);
  assert.ok(inbox.text.indexOf('Free Client') !== -1);
  assert.ok(inbox.text.indexOf('Hello <script>alert(1)</script>') !== -1);
  assert.strictEqual(inbox.approve, 'Approve');
  assert.strictEqual(inbox.decline, 'Decline');
  assert.ok(inbox.html.indexOf('<script>') === -1);
  assert.ok(inbox.html.indexOf('ada@example.com') === -1);
  assert.ok(inbox.text.indexOf('@') === -1);
  await p.evaluate(function () {
    var toast = document.getElementById('toast');
    if (toast) { toast.className = ''; toast.textContent = ''; }
  });
  await p.screenshot({ path: ART + '/trainer-requests.png' });

  await p.goto(URL + '#/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#messages-nav');
  const navBadge = await p.evaluate(function () {
    var hub = document.querySelector('#hub-nav .request-count');
    var messages = document.querySelector('#messages-nav .request-count');
    return {
      hub: hub ? hub.textContent : '',
      messages: messages ? messages.textContent : ''
    };
  });
  assert.strictEqual(navBadge.hub, '1');
  assert.strictEqual(navBadge.messages, '1');
  await p.screenshot({ path: ART + '/trainer-request-badges.png' });

  await p.goto(URL + '#/messages/' + ADA, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#days-left');
  await p.waitForSelector('#msg-text');
  const live = await p.evaluate(function () {
    return {
      days: document.getElementById('days-left').textContent,
      with: document.getElementById('with').textContent,
      note: document.getElementById('temp-note').textContent,
      send: !!document.getElementById('msg-send'),
      body: document.getElementById('app').innerText,
      html: document.getElementById('app').innerHTML
    };
  });
  assert.strictEqual(live.days, '6 days left');
  assert.strictEqual(live.with, 'Free Client');
  assert.ok(live.note.indexOf('link code') !== -1);
  assert.strictEqual(live.send, true);
  assert.ok(live.body.indexOf('Hello <b>coach</b>') !== -1);
  assert.ok(live.html.indexOf('<b>') === -1);
  assert.ok(live.body.indexOf('@') === -1);
  await p.evaluate(function () {
    var toast = document.getElementById('toast');
    if (toast) { toast.className = ''; toast.textContent = ''; }
  });
  await p.screenshot({ path: ART + '/temp-conversation-days.png' });

  await p.evaluate(function () { window.__expired = true; });
  await p.goto(URL + '#/messages/' + ADA, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#thread-readonly');
  const ended = await p.evaluate(function () {
    return {
      days: document.getElementById('days-left').textContent,
      readonly: document.getElementById('thread-readonly').textContent,
      send: !!document.getElementById('msg-send'),
      history: document.getElementById('app').innerText.indexOf('Good to meet you') !== -1
    };
  });
  assert.strictEqual(ended.days, 'Read only');
  assert.ok(ended.readonly.indexOf('read-only') !== -1);
  assert.strictEqual(ended.send, false);
  assert.strictEqual(ended.history, true);
  await p.screenshot({ path: ART + '/temp-conversation-readonly.png' });

  await p.click('#temp-end');
  await p.waitForFunction(function () { return window.__ended === true; });

  await p.goto(URL + '#/account', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#profile-edit');
  await p.click('#profile-edit');
  await p.waitForSelector('#profile-listed');
  const listing = await p.evaluate(function () {
    var sw = document.getElementById('profile-listed');
    return {
      label: document.getElementById('profile-listing').innerText,
      on: sw.getAttribute('aria-checked'),
      service: document.getElementById('profile-service').value
    };
  });
  assert.ok(listing.label.indexOf('Show me in trainer search') !== -1);
  assert.strictEqual(listing.on, 'true');
  assert.strictEqual(listing.service, 'online');
  await p.evaluate(function () {
    var el = document.getElementById('profile-listing');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  });
  await p.screenshot({ path: ART + '/trainer-search-opt-in.png' });
  await p.click('#profile-listed');
  assert.strictEqual(await p.$eval('#profile-listed', function (el) { return el.getAttribute('aria-checked'); }), 'false');

  if (errs.length) throw new Error(errs.join('\n'));
  await b.close();
  console.log('find ui ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});