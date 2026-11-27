// Sign-out uploads, then the phone is empty. No network and no live database.
// node tests/sign-out-wipe.test.js [url]
const assert = require('assert');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function workout(name) {
  const data = M.emptyData();
  data.workouts.push(M.newWorkout(name));
  return JSON.stringify(data);
}

(async () => {
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  const dialogs = [];
  let acceptLeave = false;
  page.on('pageerror', function (err) { errors.push(String(err)); });
  page.on('dialog', function (dialog) {
    dialogs.push(dialog.message());
    if (dialog.message().indexOf('have not uploaded') !== -1 && !acceptLeave) dialog.dismiss();
    else dialog.accept();
  });
  await page.evaluateOnNewDocument(function (A) {
    var current;
    function userId() { return localStorage.getItem('test.user') || ''; }
    function patch(api) {
      if (!api || api.__wipeStub) return api;
      api.__wipeStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () {
        var id = userId();
        if (!id) return Promise.resolve(null);
        return Promise.resolve({ user: { id: id, email: 'kinisiathletics@gmail.com' } });
      };
      api.freshSession = function () { return api.session(); };
      api.profile = function () {
        var id = userId();
        if (!id) return Promise.resolve(null);
        return Promise.resolve({
          id: id,
          email: 'kinisiathletics@gmail.com',
          membership: 'trainer',
          intended_plan: 'trainer',
          display_name: id === A ? 'Ada' : 'Bea'
        });
      };
      api.signOut = function () {
        localStorage.removeItem('test.user');
        return Promise.resolve();
      };
      api.accountPull = function () {
        var all = {};
        try { all = JSON.parse(localStorage.getItem('test.server') || '{}'); } catch (e) {}
        return Promise.resolve(all[userId()] || []);
      };
      api.accountImport = function (row) {
        return Promise.resolve({ localId: row && row.localId, revisedAt: 1 });
      };
      api.accountPush = function (change) {
        if (localStorage.getItem('test.failPush') === '1') return Promise.reject(new Error('Failed to fetch'));
        var pushes = [];
        try { pushes = JSON.parse(localStorage.getItem('test.pushes') || '[]'); } catch (e) {}
        pushes.push({ user: userId(), name: change && change.name || '', localId: change && change.localId || '' });
        localStorage.setItem('test.pushes', JSON.stringify(pushes));
        var all = {};
        try { all = JSON.parse(localStorage.getItem('test.server') || '{}'); } catch (e) {}
        var id = userId();
        all[id] = all[id] || [];
        if (change && !change.deleted && !all[id].some(function (row) { return row.localId === change.localId; })) {
          all[id].push({
            localId: change.localId,
            name: change.name,
            items: change.items || [],
            revisedAt: change.revisedAt || 1,
            deleted: false
          });
        }
        localStorage.setItem('test.server', JSON.stringify(all));
        return Promise.resolve({ localId: change && change.localId, revisedAt: change && change.revisedAt || 1 });
      };
      api.workoutCopies = function () { return Promise.resolve([]); };
      api.shareSetting = function () { return Promise.resolve({ on: false, enthusiast: true }); };
      api.trainerRequestCount = function () { return Promise.resolve(0); };
      api.navBadges = function () { return Promise.resolve({ messages: 0, hub: 0, tracking: 0 }); };
      api.navMarkSeen = function () { return Promise.resolve(null); };
      api.circuits = function () { return Promise.resolve([]); };
      api.circuitGuestPlacements = function () { return Promise.resolve([]); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  }, A);

  await page.goto(URL);
  await page.evaluate(function (id, raw) {
    localStorage.setItem('test.user', id);
    localStorage.setItem('test.pushes', '[]');
    localStorage.setItem('test.server', '{}');
    localStorage.setItem('wb.libraryOwner.v1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    localStorage.setItem('wb.libraryCache.v1', '{}');
    localStorage.setItem('wb.data.v1', raw);
  }, A, workout('Secret'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return document.body.innerText.indexOf('No workouts yet') !== -1; });
  assert.strictEqual(await page.evaluate(function () { return document.body.innerText.indexOf('Secret'); }), -1);
  const leaked = await page.evaluate(function () {
    return JSON.parse(localStorage.getItem('test.pushes') || '[]').some(function (row) { return row.name === 'Secret'; });
  });
  assert.strictEqual(leaked, false);

  await page.evaluate(function (id, raw) {
    localStorage.setItem('test.user', id);
    localStorage.setItem('test.pushes', '[]');
    localStorage.removeItem('wb.libraryOwner.v1');
    localStorage.setItem('wb.data.v1', raw);
  }, A, workout('Phone day'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return document.body.innerText.indexOf('Phone day') !== -1; });
  await page.goto(URL + '#/account');
  await page.waitForSelector('#account-signout');
  await page.click('#account-signout');
  try {
    await page.waitForFunction(function () {
      return !localStorage.getItem('test.user') && !localStorage.getItem('wb.data.v1') && !localStorage.getItem('wb.libraryOwner.v1') && !localStorage.getItem('wb.libraryCache.v1');
    }, { timeout: 8000 });
  } catch (err) {
    console.log(JSON.stringify(await page.evaluate(function () {
      var link = document.getElementById('account-signout');
      return {
        hash: location.hash,
        user: localStorage.getItem('test.user'),
        data: localStorage.getItem('wb.data.v1'),
        owner: localStorage.getItem('wb.libraryOwner.v1'),
        online: navigator.onLine,
        hidden: link ? link.hidden : null,
        text: document.body.innerText.slice(0, 500)
      };
    }), null, 2));
    console.log(dialogs);
    throw err;
  }

  await page.evaluate(function (id) {
    localStorage.setItem('test.user', id);
    localStorage.setItem('test.pushes', '[]');
  }, B);
  await page.goto(URL + '#/');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return document.body.innerText.indexOf('No workouts yet') !== -1; });
  assert.strictEqual(await page.evaluate(function () { return document.body.innerText.indexOf('Phone day'); }), -1);
  const pushedToB = await page.evaluate(function () {
    return JSON.parse(localStorage.getItem('test.pushes') || '[]').some(function (row) { return row.name === 'Phone day'; });
  });
  assert.strictEqual(pushedToB, false);

  await page.evaluate(function (id) { localStorage.setItem('test.user', id); }, A);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return document.body.innerText.indexOf('Phone day') !== -1; });

  await page.evaluate(function (id, raw) {
    localStorage.setItem('test.user', id);
    localStorage.setItem('test.failPush', '1');
    localStorage.setItem('wb.libraryOwner.v1', id);
    localStorage.setItem('wb.data.v1', raw);
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: function () { return false; } });
  }, A, workout('Phone day'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return document.body.innerText.indexOf('Phone day') !== -1; });
  await page.goto(URL + '#/account');
  await page.waitForSelector('#account-signout');
  await page.click('#account-signout');
  await page.waitForFunction(function () {
    var raw = localStorage.getItem('wb.data.v1') || '';
    return !!localStorage.getItem('test.user') && raw.indexOf('Phone day') !== -1;
  });
  assert.ok(dialogs.some(function (msg) { return msg.indexOf('have not uploaded') !== -1; }));
  assert.strictEqual(await page.evaluate(function () { return !!localStorage.getItem('wb.data.v1'); }), true);

  assert.deepStrictEqual(errors, []);
  console.log('SIGN OUT WIPE OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
