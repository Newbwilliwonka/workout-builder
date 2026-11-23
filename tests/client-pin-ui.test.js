// Client profile pin and Near me using that pin. No live database.
// node tests/client-pin-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';
const RILEY = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const PIN = { latitude: 30.2672, longitude: -97.7431, city: 'Hidden Harbor', region: 'Minnesota', country: 'United States' };
const CLIENT_BIO = 'Tell people a little about yourself: your goals, what you enjoy, or what you\'re training for.';
const CLIENT_NOTE = 'Your exact pin is private. It is only used to find trainers near you in the Trainer Hub search.';

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
  await p.setGeolocation({ latitude: 40.7128, longitude: -74.006 });
  await p.evaluateOnNewDocument(function (ids) {
    window.__clientPin = null;
    window.__search = null;
    var current;
    function patch(api) {
      if (!api || api.__clientPinStub) return api;
      api.__clientPinStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () {
        return Promise.resolve({ user: { id: 'casey', email: 'casey@example.com' } });
      };
      api.freshSession = function () { return api.session(); };
      api.profile = function () {
        return Promise.resolve({
          id: 'casey',
          membership: 'free_client',
          intended_plan: 'free_client',
          display_name: 'Casey Nguyen',
          access_approved: true,
          profileReady: true,
          bio: '',
          listed: false,
          service_type: null,
          online_only: false
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
      api.myClientLocation = function () { return Promise.resolve(window.__clientPin); };
      api.saveClientLocation = function (pin) {
        window.__savedClientPin = pin;
        window.__clientPin = Object.assign({ id: 'client-pin' }, pin);
        return Promise.resolve(window.__clientPin);
      };
      api.removeClientLocation = function () {
        window.__removedClientPin = true;
        window.__clientPin = null;
        return Promise.resolve({ removed: true });
      };
      api.saveServiceLocation = function () { return Promise.reject(new Error('Only a Trainer or Master Trainer can set a service location.')); };
      api.trainerSearch = function (mode, lat, lng) {
        window.__search = { mode: mode || 'online', lat: lat == null ? null : lat, lng: lng == null ? null : lng };
        if (mode === 'near') {
          return Promise.resolve({
            mode: 'near',
            comingSoon: false,
            trainers: [{
              id: ids.RILEY,
              name: 'Riley Coach',
              role: 'Trainer',
              verified: false,
              serviceType: 'in_person',
              city: 'Round Rock',
              state: 'Texas',
              distanceMiles: 12,
              request: 'none',
              isLinked: false
            }]
          });
        }
        return Promise.resolve({ mode: 'online', comingSoon: false, trainers: [] });
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  }, { RILEY: RILEY });

  await p.goto(URL + '#/account', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#profile-edit');
  await p.click('#profile-edit');
  await p.waitForSelector('#pin-title');
  const sheet = await p.evaluate(function () {
    var bio = document.getElementById('profile-bio');
    var root = document.getElementById('profile-sheet');
    return {
      placeholder: bio.placeholder,
      max: bio.maxLength,
      count: document.getElementById('profile-count').textContent,
      title: document.getElementById('pin-title').textContent,
      note: document.getElementById('pin-privacy').textContent,
      kind: document.getElementById('profile-pin').getAttribute('data-pin-kind'),
      hidden: document.getElementById('profile-pin').hidden,
      service: !!document.getElementById('profile-service'),
      listing: !!document.getElementById('profile-listing'),
      hint: !!document.getElementById('pin-near-hint'),
      remove: document.getElementById('pin-remove').textContent,
      text: root.innerText,
      html: root.innerHTML
    };
  });
  assert.strictEqual(sheet.placeholder, CLIENT_BIO);
  assert.strictEqual(sheet.max, 150);
  assert.strictEqual(sheet.count, '0/150');
  assert.strictEqual(sheet.title, 'Location');
  assert.strictEqual(sheet.note, CLIENT_NOTE);
  assert.strictEqual(sheet.kind, 'client');
  assert.strictEqual(sheet.hidden, false);
  assert.strictEqual(sheet.service, false);
  assert.strictEqual(sheet.listing, false);
  assert.strictEqual(sheet.hint, false);
  assert.ok(sheet.text.indexOf('Save pin') !== -1);
  assert.strictEqual(sheet.remove, 'Remove pin');
  assert.ok(sheet.text.indexOf('Search') !== -1);
  assert.ok(sheet.text.indexOf('Public location') === -1);
  assert.ok(sheet.text.indexOf('Service location') === -1);
  assert.ok(sheet.text.indexOf('Show me in trainer search') === -1);
  assert.ok(sheet.text.indexOf('Specialties, service areas, certifications') === -1);
  assert.ok(sheet.html.indexOf('@') === -1);
  assert.ok(sheet.text.indexOf('@') === -1);

  await p.evaluate(function () {
    var orig = window.fetch;
    window.fetch = function (url) {
      var address = String(url);
      if (address.indexOf('nominatim.openstreetmap.org') !== -1 && address.indexOf('/search') !== -1) {
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve([{
              lat: '30.2672',
              lon: '-97.7431',
              address: { city: 'Austin', state: 'Texas', country: 'United States' }
            }]);
          }
        });
      }
      return orig.apply(window, arguments);
    };
  });
  await p.type('#pin-query', 'Austin');
  await p.click('#pin-go');
  await p.waitForFunction(function () { return !document.getElementById('pin-save').disabled; });
  const drafted = await p.evaluate(function () {
    return document.getElementById('pin-public').textContent;
  });
  assert.strictEqual(drafted, 'Austin, Texas');
  assert.ok(drafted.indexOf('Public') === -1);
  await p.click('#pin-save');
  await p.waitForFunction(function () {
    return window.__savedClientPin && window.__savedClientPin.city === 'Austin' && !document.getElementById('pin-remove').hidden;
  });
  await p.setViewport({ width: 390, height: 1700, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluate(function () {
    var sheet = document.getElementById('profile-sheet');
    var card = sheet.querySelector('.pv-sheet-card');
    var scroll = sheet.querySelector('.profile-scroll');
    sheet.style.alignItems = 'flex-start';
    card.style.maxHeight = 'none';
    card.style.overflow = 'visible';
    if (scroll) {
      scroll.style.overflow = 'visible';
      scroll.style.maxHeight = 'none';
      scroll.style.flex = 'none';
      scroll.style.minHeight = 'auto';
    }
  });
  const card = await p.$('#profile-sheet .pv-sheet-card');
  await card.screenshot({ path: ART + '/client-profile-bio-location.png' });
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const shot = fs.statSync(ART + '/client-profile-bio-location.png');
  assert.ok(shot.size > 1000);

  await p.evaluate(function () { document.getElementById('pin-remove').click(); });
  await p.waitForFunction(function () {
    return window.__removedClientPin === true && window.__clientPin === null && document.getElementById('pin-remove').hidden;
  });
  await p.evaluate(function () { document.getElementById('profile-cancel').click(); });
  await p.waitForFunction(function () { return !document.getElementById('profile-sheet'); });

  await p.evaluate(function (pin) { window.__clientPin = pin; }, PIN);
  await p.evaluate(function () { location.hash = '#/hub'; });
  await p.waitForSelector('#hub-find');
  await p.click('#hub-find');
  await p.waitForSelector('#find-near');
  const beforeNear = await p.evaluate(function () { return window.__search && window.__search.mode; });
  assert.strictEqual(beforeNear, 'online');
  await p.click('#find-near');
  await p.waitForFunction(function () {
    return window.__search && window.__search.mode === 'near'
      && Math.abs(window.__search.lat - 30.2672) < 0.001
      && document.getElementById('find-near-saved');
  });
  const near = await p.evaluate(function () {
    return {
      text: document.getElementById('app').innerText,
      html: document.getElementById('app').innerHTML,
      search: window.__search,
      pressed: document.getElementById('find-near').getAttribute('aria-pressed'),
      locate: document.getElementById('find-locate').textContent,
      city: !!document.getElementById('find-city')
    };
  });
  assert.strictEqual(near.pressed, 'true');
  assert.strictEqual(near.locate, 'Use my location');
  assert.strictEqual(near.city, true);
  assert.ok(near.text.indexOf('Using your saved pin.') !== -1);
  assert.ok(near.text.indexOf('Your location is used only for this search and is not saved.') !== -1);
  assert.ok(near.text.indexOf('Riley Coach') !== -1);
  assert.ok(near.text.indexOf('Round Rock, Texas') !== -1);
  assert.ok(near.text.indexOf('About 12 mi') !== -1);
  assert.ok(near.text.indexOf('Hidden Harbor') === -1);
  assert.ok(near.text.indexOf('@') === -1);
  assert.ok(near.html.indexOf('30.2672') === -1);
  assert.ok(near.html.indexOf('@') === -1);
  await p.screenshot({ path: ART + '/trainer-hub-near-saved-pin.png' });

  await p.click('#find-locate');
  await p.waitForFunction(function () {
    return window.__search && Math.abs(window.__search.lat - 40.7128) < 0.001 && !document.getElementById('find-near-saved');
  });
  await p.evaluate(function () {
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
  await p.click('#find-city');
  await p.type('#find-city', 'Dallas');
  await p.click('#find-city-go');
  await p.waitForFunction(function () {
    return window.__cityQuery === 'Dallas'
      && window.__search
      && Math.abs(window.__search.lat - 32.7767) < 0.001
      && !document.getElementById('find-near-saved');
  });

  if (errs.length) throw new Error(errs.join('\n'));
  await b.close();
  console.log('client pin ui ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
