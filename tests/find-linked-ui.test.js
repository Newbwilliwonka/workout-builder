// Linked trainer card in Find a trainer. No live database.
// node tests/find-linked-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';
const RILEY = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const JORDAN = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const SAM = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';
const ADA = '12121212-1212-4121-8121-121212121212';

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const chrome = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
  const b = await pp.launch({ executablePath: chrome, args: ['--no-sandbox', '--hide-scrollbars'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', function (e) { errs.push(String(e)); });
  p.on('dialog', function (d) { d.accept(); });
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const context = b.defaultBrowserContext();
  await context.overridePermissions('http://127.0.0.1:8787', ['geolocation']);
  await p.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
  await p.evaluateOnNewDocument(function (ids) {
    var riley = {
      id: ids.RILEY,
      name: 'Riley Coach',
      role: 'Trainer',
      verified: false,
      serviceType: 'in_person',
      city: 'Austin',
      state: 'Texas',
      request: 'none',
      isLinked: true,
      email: 'riley@example.com'
    };
    window.__online = [riley];
    window.__near = [
      {
        id: ids.RILEY,
        name: 'Riley Coach',
        role: 'Trainer',
        verified: false,
        serviceType: 'online',
        request: 'none',
        isLinked: true,
        email: 'riley@example.com'
      },
      {
        id: ids.JORDAN,
        name: 'Jordan Lee',
        role: 'Trainer',
        verified: false,
        serviceType: 'in_person',
        city: 'Round Rock',
        state: 'Texas',
        distanceMiles: 12,
        request: 'none',
        isLinked: false,
        email: 'jordan@example.com',
        latitude: 30.5083
      }
    ];
    window.__others = [
      riley,
      {
        id: ids.JORDAN,
        name: 'Jordan Lee',
        role: 'Trainer',
        verified: false,
        serviceType: 'online',
        request: 'none',
        isLinked: false,
        email: 'jordan@example.com'
      },
      {
        id: ids.SAM,
        name: 'Sam Patel',
        role: 'Master Trainer',
        verified: true,
        serviceType: 'both',
        city: 'Dallas',
        state: 'Texas',
        request: 'none',
        isLinked: false,
        email: 'sam@example.com'
      }
    ];
    var current;
    function patch(api) {
      if (!api || api.__linkedStub) return api;
      api.__linkedStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () {
        return Promise.resolve({ user: { id: ids.ADA, email: 'ada@example.com' } });
      };
      api.freshSession = function () { return api.session(); };
      api.profile = function () {
        return Promise.resolve({
          id: ids.ADA,
          email: 'ada@example.com',
          membership: 'free_client',
          display_name: 'Ada Lee',
          access_approved: true,
          profileReady: true,
          online_only: true,
          listed: false,
          service_type: null
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
      api.trainerRequestCount = function () { return Promise.resolve(0); };
      api.trainerSearch = function (mode, lat, lng) {
        window.__search = { mode: mode || 'online', lat: lat == null ? null : lat, lng: lng == null ? null : lng };
        if (mode === 'near') {
          return Promise.resolve({ mode: 'near', comingSoon: false, trainers: window.__near.slice() });
        }
        var rows = window.__only === false ? window.__others : window.__online;
        return Promise.resolve({ mode: 'online', comingSoon: false, trainers: rows.slice() });
      };
      api.trainerRequestSend = function () { return Promise.resolve({ id: 'sent', status: 'open' }); };
      api.threads = function () { return Promise.resolve({ role: 'client', threads: [], requests: [] }); };
      api.messages = function (personId) {
        window.__opened = personId;
        return Promise.resolve({
          person: { id: personId, name: 'Riley Coach', plan: 'Trainer', verified: false, temporary: false, canSend: true },
          messages: [{ id: 'm1', mine: false, body: 'See you Thursday', at: new Date().toISOString() }]
        });
      };
      api.sendMessage = function (personId, messageId, body) {
        return Promise.resolve({ id: messageId, mine: true, body: body, at: new Date().toISOString() });
      };
      api.markRead = function () { return Promise.resolve({ ok: true }); };
      api.watchMessages = function () { return Promise.resolve(function () {}); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  }, { RILEY: RILEY, JORDAN: JORDAN, SAM: SAM, ADA: ADA });

  await p.goto(URL + '#/hub', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#hub-find');
  await p.click('#hub-find');
  await p.waitForSelector('#find-none');
  const only = await p.evaluate(function (id) {
    var card = document.querySelector('[data-message="' + id + '"]');
    var list = document.getElementById('find-list');
    return {
      title: document.getElementById('title').textContent,
      text: document.getElementById('app').innerText,
      html: document.getElementById('app').innerHTML,
      first: list && list.firstElementChild && list.firstElementChild.getAttribute('data-message'),
      request: card ? card.innerText.indexOf('Request to message') : -1,
      label: card ? card.querySelector('.find-yours').textContent : ''
    };
  }, RILEY);
  assert.strictEqual(only.title, 'Find a trainer');
  assert.strictEqual(only.first, RILEY);
  assert.strictEqual(only.label, 'Your trainer');
  assert.strictEqual(only.request, -1);
  assert.ok(only.text.indexOf('Riley Coach') !== -1);
  assert.ok(only.text.indexOf('No other trainers are listed yet.') !== -1);
  assert.ok(only.text.indexOf('No trainers are available online right now.') === -1);
  assert.ok(only.text.indexOf('Request to message') === -1);
  assert.ok(only.text.indexOf('@') === -1);
  assert.ok(only.html.indexOf('riley@example.com') === -1);
  await p.screenshot({ path: ART + '/find_online_your_trainer_only.png' });

  await p.click('[data-message="' + RILEY + '"]');
  await p.waitForSelector('#msg-text');
  const thread = await p.evaluate(function (id) {
    return {
      title: document.getElementById('title').textContent,
      hash: location.hash,
      opened: window.__opened,
      text: document.getElementById('app').innerText,
      html: document.getElementById('app').innerHTML
    };
  }, RILEY);
  assert.strictEqual(thread.opened, RILEY);
  assert.ok(thread.hash.indexOf('/messages/' + RILEY) !== -1);
  assert.strictEqual(thread.title, 'Riley Coach');
  assert.ok(thread.text.indexOf('Request to message') === -1);
  assert.ok(thread.text.indexOf('See you Thursday') !== -1);
  assert.ok(thread.text.indexOf('@') === -1);
  assert.ok(thread.html.indexOf('riley@example.com') === -1);
  await p.screenshot({ path: ART + '/find_linked_trainer_messages.png' });

  await p.evaluate(function () {
    window.__only = false;
    location.hash = '#/hub/find';
  });
  await p.waitForSelector('[data-trainer="' + JORDAN + '"]');
  const many = await p.evaluate(function (ids) {
    var cards = Array.prototype.map.call(document.querySelectorAll('#find-list > *'), function (el) {
      return el.getAttribute('data-message') || el.getAttribute('data-trainer');
    });
    var yours = document.querySelector('[data-message="' + ids.RILEY + '"]');
    return {
      cards: cards,
      none: !!document.getElementById('find-none'),
      yoursRequest: yours ? yours.innerText.indexOf('Request to message') : -1,
      jordan: document.querySelector('[data-request="' + ids.JORDAN + '"]') ? document.querySelector('[data-request="' + ids.JORDAN + '"]').textContent : '',
      text: document.getElementById('app').innerText,
      html: document.getElementById('app').innerHTML
    };
  }, { RILEY: RILEY, JORDAN: JORDAN, SAM: SAM });
  assert.deepStrictEqual(many.cards, [RILEY, JORDAN, SAM]);
  assert.strictEqual(many.none, false);
  assert.strictEqual(many.yoursRequest, -1);
  assert.strictEqual(many.jordan, 'Request to message');
  assert.ok(many.text.indexOf('Your trainer') !== -1);
  assert.ok(many.text.indexOf('No other trainers are listed yet.') === -1);
  assert.ok(many.text.indexOf('Jordan Lee') !== -1);
  assert.ok(many.text.indexOf('Sam Patel') !== -1);
  assert.ok(many.text.indexOf('@') === -1);
  assert.ok(many.html.indexOf('jordan@example.com') === -1);
  assert.ok(many.html.indexOf('sam@example.com') === -1);
  await p.screenshot({ path: ART + '/find_online_your_trainer_and_others.png' });

  await p.click('#find-near');
  await p.waitForSelector('#find-locate');
  await p.click('#find-locate');
  await p.waitForSelector('[data-trainer="' + JORDAN + '"]');
  const near = await p.evaluate(function (ids) {
    var cards = Array.prototype.map.call(document.querySelectorAll('#find-list > *'), function (el) {
      return el.getAttribute('data-message') || el.getAttribute('data-trainer');
    });
    var yours = document.querySelector('[data-message="' + ids.RILEY + '"]');
    return {
      cards: cards,
      text: yours ? yours.innerText : '',
      page: document.getElementById('app').innerText,
      html: document.getElementById('app').innerHTML,
      mode: window.__search && window.__search.mode
    };
  }, { RILEY: RILEY, JORDAN: JORDAN });
  assert.strictEqual(near.mode, 'near');
  assert.deepStrictEqual(near.cards, [RILEY, JORDAN]);
  assert.ok(near.text.indexOf('Your trainer') !== -1);
  assert.ok(near.text.indexOf('Request to message') === -1);
  assert.ok(near.text.indexOf('Austin') === -1);
  assert.ok(near.page.indexOf('Round Rock, Texas') !== -1);
  assert.ok(near.page.indexOf('About 12 mi') !== -1);
  assert.ok(near.page.indexOf('No other trainers are listed yet.') === -1);
  assert.ok(near.html.indexOf('30.5083') === -1);
  assert.ok(near.page.indexOf('@') === -1);

  await p.evaluate(function () { window.__only = true; window.__online = []; });
  await p.click('#find-online');
  await p.waitForSelector('#find-empty');
  const empty = await p.evaluate(function () {
    return document.getElementById('app').innerText;
  });
  assert.ok(empty.indexOf('No trainers are available online right now.') !== -1);
  assert.ok(empty.indexOf('No other trainers are listed yet.') === -1);
  assert.ok(empty.indexOf('Your trainer') === -1);

  if (errs.length) throw new Error(errs.join('\n'));
  await b.close();
  console.log('find linked ui ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});