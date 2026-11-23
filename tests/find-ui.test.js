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
  const context = b.defaultBrowserContext();
  await context.overridePermissions('http://127.0.0.1:8787', ['geolocation']);
  await p.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
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
      { id: ids.AMY, name: 'Amy Coach', role: 'Master Trainer', verified: true, serviceType: 'both', request: 'none', city: 'Austin', state: 'Texas', email: 'amy@example.com' },
      { id: ids.BEA, name: 'Bea Coach', role: 'Trainer', verified: false, serviceType: 'online', request: 'none', city: 'Dallas', state: 'Texas', email: 'bea@example.com' }
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
      api.trainerSearch = function (mode, lat, lng) {
        window.__search = { mode: mode || 'online', lat: lat == null ? null : lat, lng: lng == null ? null : lng };
        if (mode === 'near') {
          return Promise.resolve({
            mode: 'near',
            comingSoon: false,
            trainers: [
              {
                id: ids.AMY,
                name: 'Amy Coach',
                role: 'Master Trainer',
                verified: true,
                serviceType: 'both',
                request: window.__sent[ids.AMY] ? 'open' : 'none',
                city: 'Austin',
                state: 'Texas',
                distanceMiles: 2
              },
              {
                id: ids.BEA,
                name: 'Bea Coach',
                role: 'Trainer',
                verified: false,
                serviceType: 'in_person',
                request: 'none',
                city: 'Round Rock',
                state: 'Texas',
                distanceMiles: 17,
                email: 'bea@example.com',
                latitude: 30.2672,
                longitude: -97.7431
              }
            ]
          });
        }
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
              city: row.city,
              state: row.state,
              request: window.__sent[row.id] ? 'open' : 'none'
            };
          })
        });
      };
      api.myClientLocation = function () { return Promise.resolve(null); };
      api.myServiceLocations = function () {
        return Promise.resolve(window.__pin ? [window.__pin] : []);
      };
      api.saveServiceLocation = function (pin) {
        window.__savedPin = pin;
        window.__pin = Object.assign({ id: 'pin1', slot: 1 }, pin);
        return Promise.resolve(window.__pin);
      };
      api.removeServiceLocation = function () {
        window.__removedPin = true;
        window.__pin = null;
        return Promise.resolve({ removed: true });
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
  assert.strictEqual(results.nearDisabled, false);
  assert.strictEqual(results.online, true);
  assert.ok(results.text.indexOf('Online only') !== -1);
  assert.ok(results.text.indexOf('Near me') !== -1);
  assert.ok(results.text.indexOf('Coming soon') === -1);
  assert.ok(results.text.indexOf('Amy Coach') !== -1);
  assert.ok(results.text.indexOf('Master Trainer') !== -1);
  assert.ok(results.text.indexOf('In Person and Online') !== -1);
  assert.ok(results.text.indexOf('Both') === -1);
  assert.ok(results.text.indexOf('Austin, Texas') !== -1);
  assert.ok(results.text.indexOf('Bea Coach') !== -1);
  assert.ok(results.text.indexOf('Dallas, Texas') === -1);
  assert.ok(results.text.indexOf('Online') !== -1);
  assert.ok(results.text.indexOf('Request to message') !== -1);
  assert.ok(results.text.indexOf('@') === -1);
  assert.ok(results.html.indexOf('amy@example.com') === -1);
  await p.screenshot({ path: ART + '/find-trainer-online.png' });
  await p.screenshot({ path: ART + '/find-in-person-and-online.png' });
  await p.screenshot({ path: ART + '/find-online-city.png' });

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

  await p.click('#find-near');
  await p.waitForSelector('#find-city');
  await p.evaluate(function () {
    window.__cityQuery = '';
    window.WBPlaces.searchPlace = function (q) {
      window.__cityQuery = q;
      return Promise.resolve({
        latitude: 32.7767,
        longitude: -96.797,
        city: 'Dallas',
        region: 'Texas',
        country: 'United States',
        ok: true
      });
    };
  });
  await p.type('#find-city', 'Dallas');
  const typed = await p.evaluate(function () {
    return {
      query: window.__cityQuery,
      mode: window.__search && window.__search.mode,
      oninput: document.getElementById('find-city').oninput
    };
  });
  assert.strictEqual(typed.query, '');
  assert.strictEqual(typed.mode, 'online');
  assert.strictEqual(typed.oninput, null);
  await p.click('#find-city-go');
  await p.waitForFunction(function () { return window.__cityQuery === 'Dallas' && window.__search && window.__search.mode === 'near'; });
  await p.click('#find-near');
  await p.waitForSelector('#find-locate');
  await p.evaluate(function () {
    var city = document.getElementById('find-city');
    var toast = document.getElementById('toast');
    if (city) city.value = '';
    if (toast) { toast.className = ''; toast.textContent = ''; }
  });
  await p.click('#find-locate');
  await p.waitForSelector('#find-list .find-place');
  const near = await p.evaluate(function () {
    return {
      text: document.getElementById('app').innerText,
      html: document.getElementById('app').innerHTML,
      search: window.__search,
      pressed: document.getElementById('find-near').getAttribute('aria-pressed')
    };
  });
  assert.strictEqual(near.pressed, 'true');
  assert.strictEqual(near.search.mode, 'near');
  assert.ok(Math.abs(near.search.lat - 30.2672) < 0.001);
  assert.ok(near.text.indexOf('Your location is used only for this search and is not saved.') !== -1);
  assert.ok(near.text.indexOf('Austin, Texas') !== -1);
  assert.ok(near.text.indexOf('Round Rock, Texas') !== -1);
  assert.ok(near.text.indexOf('About 2 mi') !== -1);
  assert.ok(near.text.indexOf('About 17 mi') !== -1);
  assert.ok(near.text.indexOf('In person') !== -1);
  assert.ok(near.text.indexOf('Request to message') !== -1);
  assert.ok(near.text.indexOf('@') === -1);
  assert.ok(near.html.indexOf('<script>') === -1);
  assert.ok(near.html.indexOf('30.2672') === -1);
  assert.ok(near.html.indexOf('bea@example.com') === -1);
  await p.screenshot({ path: ART + '/find-near-results.png' });

  await p.click('[data-request="' + BEA + '"]');
  await p.waitForSelector('#find-note');
  const nearForm = await p.evaluate(function () {
    return {
      title: document.getElementById('title').textContent,
      text: document.getElementById('app').innerText
    };
  });
  assert.strictEqual(nearForm.title, 'Request to message');
  assert.ok(nearForm.text.indexOf('Bea Coach') !== -1);
  assert.ok(nearForm.text.indexOf('In person') !== -1);
  assert.ok(nearForm.text.indexOf('Round Rock, Texas') !== -1);
  assert.ok(nearForm.text.indexOf('not available') === -1);
  await p.click('#back');
  await p.waitForSelector('#find-near');

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
  await p.evaluate(function () {
    window.__pin = {
      id: 'pin1',
      slot: 1,
      latitude: 30.2672,
      longitude: -97.7431,
      city: 'Austin',
      region: 'Texas',
      country: 'United States'
    };
  });
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
  const onlineService = await p.evaluate(function () {
    var service = document.getElementById('profile-service');
    var pin = document.getElementById('profile-pin');
    var title = document.getElementById('pin-title');
    var note = document.getElementById('pin-privacy');
    return {
      labels: Array.prototype.map.call(service.options, function (opt) { return opt.textContent; }),
      city: !!document.getElementById('profile-city'),
      state: !!document.getElementById('profile-state'),
      onlineBox: !!document.getElementById('profile-online'),
      serviceHidden: document.getElementById('profile-service-block').hidden,
      placeHidden: pin.hidden,
      noteAfterTitle: !!(title && note && title.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)
    };
  });
  assert.deepStrictEqual(onlineService.labels, ['Choose', 'In person', 'Online', 'In Person and Online']);
  assert.strictEqual(onlineService.city, false);
  assert.strictEqual(onlineService.state, false);
  assert.strictEqual(onlineService.onlineBox, false);
  assert.strictEqual(onlineService.serviceHidden, false);
  assert.strictEqual(onlineService.placeHidden, true);
  assert.strictEqual(onlineService.noteAfterTitle, true);
  await p.evaluate(function () {
    var el = document.getElementById('profile-service');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  });
  await p.screenshot({ path: ART + '/profile-service-online.png' });
  await p.click('#profile-listed');
  const searchOff = await p.evaluate(function () {
    return {
      on: document.getElementById('profile-listed').getAttribute('aria-checked'),
      serviceHidden: document.getElementById('profile-service-block').hidden,
      placeHidden: document.getElementById('profile-pin').hidden
    };
  });
  assert.strictEqual(searchOff.on, 'false');
  assert.strictEqual(searchOff.serviceHidden, true);
  assert.strictEqual(searchOff.placeHidden, true);
  await p.evaluate(function () {
    var el = document.getElementById('profile-listing');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  });
  await p.screenshot({ path: ART + '/profile-search-off.png' });
  await p.click('#profile-listed');
  assert.strictEqual(await p.$eval('#profile-pin', function (el) { return el.hidden; }), true);
  await p.select('#profile-service', 'in_person');
  const inPerson = await p.evaluate(function () {
    var pin = document.getElementById('profile-pin');
    var title = document.getElementById('pin-title');
    var note = document.getElementById('pin-privacy');
    var map = document.getElementById('pin-map');
    return {
      serviceHidden: document.getElementById('profile-service-block').hidden,
      placeHidden: pin.hidden,
      title: title.textContent,
      note: note.textContent,
      noteAfterTitle: !!(title.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING),
      hint: document.getElementById('pin-near-hint').textContent,
      mapW: map.getBoundingClientRect().width,
      mapH: map.getBoundingClientRect().height
    };
  });
  assert.strictEqual(inPerson.serviceHidden, false);
  assert.strictEqual(inPerson.placeHidden, false);
  assert.strictEqual(inPerson.title, 'Service location');
  assert.strictEqual(inPerson.note, 'Your exact pin is private. It is only used so clients can find you in the Trainer Hub search. Only your city and state are shown publicly.');
  assert.strictEqual(inPerson.noteAfterTitle, true);
  assert.ok(inPerson.hint.indexOf('Near me') !== -1);
  assert.ok(inPerson.mapW > 100, 'map has no width after it is shown');
  assert.ok(inPerson.mapH > 100, 'map has no height after it is shown');
  await p.evaluate(function () {
    var el = document.getElementById('profile-listing');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  });
  await p.screenshot({ path: ART + '/trainer-search-opt-in.png' });
  await p.evaluate(function () {
    var el = document.getElementById('pin-title');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
  });
  await p.screenshot({ path: ART + '/profile-service-in-person.png' });
  await p.waitForFunction(function () {
    var el = document.getElementById('pin-public');
    var map = document.querySelector('#pin-map.leaflet-container');
    var box = map && map.getBoundingClientRect();
    return el && map && box.width > 100 && el.textContent.indexOf('Austin, Texas') !== -1;
  });
  const pin = await p.evaluate(function () {
    var root = document.getElementById('profile-pin');
    return {
      note: document.getElementById('pin-privacy').textContent,
      text: root.innerText,
      html: root.innerHTML,
      inputs: Array.prototype.map.call(root.querySelectorAll('input'), function (el) { return el.id; }),
      attr: root.innerText.indexOf('OpenStreetMap') !== -1
    };
  });
  assert.strictEqual(pin.note, 'Your exact pin is private. It is only used so clients can find you in the Trainer Hub search. Only your city and state are shown publicly.');
  assert.ok(pin.text.indexOf('Public location: Austin, Texas') !== -1);
  assert.ok(pin.inputs.indexOf('pin-query') !== -1);
  assert.ok(pin.inputs.indexOf('pin-city') === -1);
  assert.ok(pin.inputs.indexOf('pin-state') === -1);
  assert.strictEqual(pin.attr, true);
  assert.ok(pin.text.indexOf('30.2672') === -1);
  assert.ok(pin.html.indexOf('30.2672') === -1);
  await p.evaluate(function () {
    var el = document.getElementById('profile-pin');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
  });
  await new Promise(function (resolve) { setTimeout(resolve, 400); });
  const pinShot = await p.$('#profile-pin');
  await pinShot.screenshot({ path: ART + '/profile-service-pin.png' });

  await p.evaluate(function () {
    window.__geo = [];
    window.fetch = function (url) {
      return new Promise(function (resolve) {
        window.__geo.push({ url: String(url), resolve: resolve });
      });
    };
    window.__geoReply = function (part, body) {
      var item = window.__geo.filter(function (row) { return row.url.indexOf(part) !== -1; }).pop();
      if (!item) throw new Error('missing ' + part);
      item.resolve({ ok: true, json: function () { return Promise.resolve(body); } });
    };
  });
  const mapBox = await p.evaluate(function () {
    var rect = document.getElementById('pin-map').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await p.mouse.click(mapBox.x, mapBox.y);
  await p.waitForFunction(function () {
    return window.__geo.some(function (row) { return row.url.indexOf('/reverse') !== -1; });
  }, { timeout: 5000 });
  await p.type('#pin-query', 'Dallas');
  await p.click('#pin-go');
  await p.waitForFunction(function () {
    return window.__geo.some(function (row) { return row.url.indexOf('/search') !== -1; });
  }, { timeout: 5000 });
  await p.evaluate(function () {
    window.__geoReply('/search', [{
      lat: '32.7767',
      lon: '-96.797',
      address: { city: 'Dallas', state: 'Texas', country: 'United States' }
    }]);
  });
  await p.waitForFunction(function () {
    return document.getElementById('pin-public').textContent.indexOf('Dallas, Texas') !== -1;
  });
  await p.evaluate(function () {
    window.__geoReply('/reverse', {
      lat: '31.0000',
      lon: '-97.0000',
      address: { city: 'Clicktown', state: 'Texas', country: 'United States' }
    });
  });
  await new Promise(function (resolve) { setTimeout(resolve, 400); });
  const afterSearch = await p.evaluate(function () {
    return {
      text: document.getElementById('pin-public').textContent,
      save: document.getElementById('pin-save').disabled
    };
  });
  assert.ok(afterSearch.text.indexOf('Dallas, Texas') !== -1);
  assert.ok(afterSearch.text.indexOf('Clicktown') === -1);
  assert.strictEqual(afterSearch.save, false);

  await p.mouse.click(mapBox.x, mapBox.y);
  await p.waitForFunction(function () {
    return window.__geo.filter(function (row) { return row.url.indexOf('/reverse') !== -1; }).length >= 2;
  }, { timeout: 5000 });
  await p.click('#pin-remove');
  await p.waitForFunction(function () {
    return document.getElementById('pin-public').textContent.indexOf('No pin yet') !== -1;
  });
  await p.evaluate(function () {
    window.__geoReply('/reverse', {
      lat: '29.7604',
      lon: '-95.3698',
      address: { city: 'Backtown', state: 'Texas', country: 'United States' }
    });
  });
  await new Promise(function (resolve) { setTimeout(resolve, 400); });
  const afterRemove = await p.evaluate(function () {
    return {
      text: document.getElementById('pin-public').textContent,
      save: document.getElementById('pin-save').disabled,
      removed: window.__removedPin === true
    };
  });
  assert.ok(afterRemove.text.indexOf('No pin yet') !== -1);
  assert.ok(afterRemove.text.indexOf('Backtown') === -1);
  assert.strictEqual(afterRemove.save, true);
  assert.strictEqual(afterRemove.removed, true);

  await p.evaluate(function () {
    var query = document.getElementById('pin-query');
    if (query) query.value = '';
  });
  await p.type('#pin-query', 'Waco');
  await p.click('#pin-go');
  await p.waitForFunction(function () {
    return window.__geo.some(function (row) { return row.url.indexOf('/search?') !== -1 && row.url.indexOf('Waco') !== -1; });
  }, { timeout: 5000 });
  assert.strictEqual(await p.$eval('#pin-go', function (el) { return el.disabled; }), true);
  await p.mouse.click(mapBox.x, mapBox.y);
  await p.evaluate(function () {
    window.__geoReply('Waco', [{
      lat: '31.5493',
      lon: '-97.1467',
      address: { city: 'Waco', state: 'Texas', country: 'United States' }
    }]);
  });
  await p.waitForFunction(function () {
    return document.getElementById('pin-go').disabled === false;
  });
  const afterSupersededSearch = await p.evaluate(function () {
    return document.getElementById('pin-public').textContent;
  });
  assert.ok(afterSupersededSearch.indexOf('Waco') === -1);

  await p.evaluate(function () {
    var button = document.getElementById('pin-remove');
    button.hidden = false;
    window.__removeRelease = null;
    window.WBAuth.removeServiceLocation = function () {
      return new Promise(function (resolve) { window.__removeRelease = resolve; });
    };
  });
  await p.evaluate(function () {
    document.getElementById('pin-remove').scrollIntoView({ block: 'center' });
  });
  await p.click('#pin-remove');
  await p.waitForFunction(function () {
    return document.getElementById('pin-remove').disabled === true && typeof window.__removeRelease === 'function';
  });
  await p.mouse.click(mapBox.x, mapBox.y);
  await p.evaluate(function () { window.__removeRelease({ removed: true }); });
  await p.waitForFunction(function () {
    return document.getElementById('pin-remove').disabled === false;
  });

  await p.click('#profile-listed');
  assert.strictEqual(await p.$eval('#profile-listed', function (el) { return el.getAttribute('aria-checked'); }), 'false');

  if (errs.length) throw new Error(errs.join('\n'));
  await b.close();
  console.log('find ui ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});