// Sign-out uploads, then the phone is empty. No network and no live database.
// node tests/sign-out-wipe.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../model.js');
const appSrc = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
function appSlice(startMark, endMark) {
  var start = appSrc.indexOf(startMark);
  var end = appSrc.indexOf(endMark, start + startMark.length);
  assert.ok(start >= 0 && end > start, startMark);
  return appSrc.slice(start, end);
}
assert.ok(appSlice('function abandonReset()', 'function holdRecovery').indexOf('signOutAndWipe(') >= 0);
assert.ok(appSlice("closest('#level-signout')", "closest('#plan-switch-no')").indexOf('signOutFromAccount()') >= 0);
assert.ok(appSlice('function signOutFromAccount()', 'var accountSignOut').indexOf('signOutAndWipe(') >= 0);
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
        if (localStorage.getItem('test.throwSession') === '1') throw new Error('session read failed');
        if (localStorage.getItem('test.blankUser') === '1') return Promise.resolve({ user: {} });
        var id = userId();
        if (!id) return Promise.resolve(null);
        return Promise.resolve({ user: { id: id, email: 'kinisiathletics@gmail.com' } });
      };
      api.freshSession = function () { return api.session(); };
      api.profile = function () {
        var id = userId();
        if (!id) return Promise.resolve(null);
        var planless = localStorage.getItem('test.planless') === '1';
        return Promise.resolve({
          id: id,
          email: 'kinisiathletics@gmail.com',
          membership: planless ? 'none' : 'trainer',
          intended_plan: planless ? null : 'trainer',
          display_name: id === A ? 'Ada' : 'Bea'
        });
      };
      api.signOut = function () {
        if (localStorage.getItem('test.failSignOut') === '1') return Promise.reject(new Error('Could not sign out'));
        localStorage.removeItem('test.user');
        return Promise.resolve();
      };
      api.accountPull = function () {
        if (localStorage.getItem('test.holdPull') === '1') {
          return new Promise(function (resolve) {
            window.__releasePull = function (rows) { resolve(rows || []); };
          });
        }
        var all = {};
        try { all = JSON.parse(localStorage.getItem('test.server') || '{}'); } catch (e) {}
        return Promise.resolve(all[userId()] || []);
      };
      api.accountImport = function (row) {
        return Promise.resolve({ localId: row && row.localId, revisedAt: 1 });
      };
      api.accountPush = function (change) {
        if (localStorage.getItem('test.missingLibrary') === '1') {
          var missing = new Error('account workout SQL is not available yet');
          missing.missing = true;
          return Promise.reject(missing);
        }
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

  await page.evaluate(function (id, raw) {
    localStorage.setItem('test.user', id);
    localStorage.removeItem('test.failPush');
    localStorage.setItem('test.holdPull', '1');
    localStorage.setItem('wb.libraryOwner.v1', id);
    localStorage.setItem('wb.data.v1', raw);
  }, A, workout('Keep'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(URL + '#/account');
  await page.waitForSelector('#account-signout');
  await page.click('#account-signout');
  await page.waitForFunction(function () {
    return !localStorage.getItem('test.user') && !localStorage.getItem('wb.data.v1');
  });
  const released = await page.evaluate(function () {
    return new Promise(function (resolve) {
      if (!window.__releasePull) { resolve(false); return; }
      window.__releasePull([{ localId: 'stale', name: 'Stale pull', items: [], revisedAt: 9, deleted: false }]);
      setTimeout(function () { resolve(true); }, 400);
    });
  });
  assert.strictEqual(released, true);
  const stale = await page.evaluate(function () {
    return (localStorage.getItem('wb.data.v1') || '') + document.body.innerText;
  });
  assert.ok(stale.indexOf('Stale pull') === -1);

  await page.evaluate(function (id, raw) {
    localStorage.setItem('test.user', id);
    localStorage.removeItem('test.holdPull');
    localStorage.setItem('test.failSignOut', '1');
    localStorage.setItem('wb.libraryOwner.v1', id);
    localStorage.setItem('wb.data.v1', raw);
  }, A, workout('Stay'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return document.body.innerText.indexOf('Stay') !== -1; });
  await page.goto(URL + '#/account');
  await page.waitForSelector('#account-signout');
  await page.click('#account-signout');
  await page.waitForFunction(function () { return document.body.innerText.indexOf('Could not sign out') !== -1; });
  assert.strictEqual(await page.evaluate(function () {
    return localStorage.getItem('test.user') && (localStorage.getItem('wb.data.v1') || '').indexOf('Stay') !== -1;
  }), true);

  async function waitUnsaved(from) {
    const start = Date.now();
    while (Date.now() - start < 4000) {
      if (dialogs.slice(from).some(function (msg) { return msg.indexOf('have not uploaded') !== -1; })) return;
      await new Promise(function (resolve) { setTimeout(resolve, 50); });
    }
    throw new Error('missing unsaved warning: ' + JSON.stringify(dialogs.slice(from)));
  }

  await page.evaluate(function (id, raw) {
    localStorage.setItem('test.user', id);
    localStorage.removeItem('test.failSignOut');
    localStorage.setItem('test.planless', '1');
    localStorage.setItem('test.failPush', '1');
    localStorage.setItem('wb.libraryOwner.v1', id);
    localStorage.setItem('wb.data.v1', raw);
  }, A, workout('Locked'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(URL + '#/subscriptions');
  await page.waitForSelector('#level-signout');
  const beforeLock = dialogs.length;
  await page.click('#level-signout');
  await waitUnsaved(beforeLock);
  assert.strictEqual(await page.evaluate(function () { return localStorage.getItem('test.user'); }), A);
  assert.ok((await page.evaluate(function () { return localStorage.getItem('wb.data.v1') || ''; })).indexOf('Locked') !== -1);

  await page.evaluate(function () {
    localStorage.removeItem('test.planless');
    localStorage.removeItem('test.failPush');
  });
  await page.goto(URL + '#/account');
  await page.waitForSelector('#account-signout');
  await page.evaluate(function () { localStorage.setItem('test.throwSession', '1'); });
  const beforeThrow = dialogs.length;
  await page.click('#account-signout');
  await waitUnsaved(beforeThrow);
  assert.ok((await page.evaluate(function () { return localStorage.getItem('wb.data.v1') || ''; })).indexOf('Locked') !== -1);
  assert.strictEqual(await page.evaluate(function () { return localStorage.getItem('test.user'); }), A);

  await page.evaluate(function () {
    localStorage.removeItem('test.throwSession');
    localStorage.setItem('test.blankUser', '1');
  });
  const beforeBlank = dialogs.length;
  await page.click('#account-signout');
  await waitUnsaved(beforeBlank);
  assert.ok((await page.evaluate(function () { return localStorage.getItem('wb.data.v1') || ''; })).indexOf('Locked') !== -1);
  assert.strictEqual(await page.evaluate(function () { return localStorage.getItem('test.user'); }), A);

  await page.evaluate(function () {
    localStorage.removeItem('test.blankUser');
    localStorage.setItem('test.missingLibrary', '1');
  });
  const beforeMissing = dialogs.length;
  await page.click('#account-signout');
  await waitUnsaved(beforeMissing);
  assert.ok((await page.evaluate(function () { return localStorage.getItem('wb.data.v1') || ''; })).indexOf('Locked') !== -1);

  await page.evaluate(function (queue) {
    localStorage.removeItem('test.missingLibrary');
    localStorage.setItem('wb.clientQueue.v1', queue);
  }, JSON.stringify({ [A]: [{ ownerId: B, kind: 'account', localId: 'q1', change: { name: 'Queued' }, gen: 1 }] }));
  const beforeQueue = dialogs.length;
  await page.click('#account-signout');
  await waitUnsaved(beforeQueue);
  assert.ok((await page.evaluate(function () { return localStorage.getItem('wb.data.v1') || ''; })).indexOf('Locked') !== -1);
  assert.ok((await page.evaluate(function () { return localStorage.getItem('wb.clientQueue.v1') || ''; })).indexOf('q1') !== -1);

  assert.deepStrictEqual(errors, []);
  console.log('SIGN OUT WIPE OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
