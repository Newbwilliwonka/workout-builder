// Phone-width account sync. A refused save must not hide a workout from the other device,
// and the grey line under + New workout must say why. No network and no live database.
// node tests/account-sync-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../model.js');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const USER = '11111111-1111-4111-8111-111111111111';
const ARTIFACTS = '/opt/cursor/artifacts';

function wo(id, name) {
  return {
    id: id,
    name: name,
    items: [{ id: 'ex_1', name: 'Press', sets: 3, weight: { unit: 'lb', value: 95 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }, notes: '', groupId: null, media: null }],
    createdAt: 1000,
    updatedAt: 1000
  };
}

(async () => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const chrome = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
  const b = await pp.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errs = [];
  p.on('pageerror', function (e) { errs.push(String(e)); });
  const phone = wo('wo_phone', 'Phone day');
  const bad = wo('wo_bad', 'Phone extra');
  const good = wo('wo_good', 'Legs');
  const presets = {
    plan: [phone],
    auth: [phone],
    offline: [phone],
    saved: [],
    shape: [],
    split: [bad, good],
    queue: []
  };
  await p.evaluateOnNewDocument(function (userId, storageKey, presets) {
    window.__wbLibraryResumeMs = 300;
    var mode = '';
    try { mode = new URLSearchParams(location.search).get('sync') || ''; } catch (e) {}
    if (mode && presets[mode]) {
      var body = { version: 4, workouts: presets[mode], sessions: [], programs: [] };
      localStorage.setItem(storageKey, JSON.stringify(body));
      var seed = {};
      seed[userId] = [];
      localStorage.setItem('wb.accountSeed.v1', JSON.stringify(seed));
      localStorage.removeItem('wb.accountReject.v1');
      var queued = {};
      if (mode === 'queue') {
        queued[userId] = [
          { ownerId: 'ada', kind: 'account', localId: 'wo_q1', change: { localId: 'wo_q1', name: 'Nope', items: [], revisedAt: 1, deleted: false }, gen: 1 },
          { ownerId: 'ada', kind: 'account', localId: 'wo_q2', change: { localId: 'wo_q2', name: 'Yes', items: [], revisedAt: 2, deleted: false }, gen: 1 }
        ];
      }
      localStorage.setItem('wb.clientQueue.v1', JSON.stringify(queued));
    }
    var current;
    function patch(api) {
      if (!api || api.__syncStub) return api;
      api.__syncStub = true;
      api.session = function () { return Promise.resolve({ user: { id: userId, email: 'fan@example.com' } }); };
      api.freshSession = function () { return api.session(); };
      api.profile = function () {
        return Promise.resolve({ id: userId, email: 'fan@example.com', membership: 'enthusiast', intended_plan: 'enthusiast' });
      };
      api.workoutCopies = function () { return Promise.resolve([]); };
      api.shareSetting = function () { return Promise.resolve({ on: false, enthusiast: true }); };
      api.accountImport = function () { return Promise.resolve({ localId: 'skip', revisedAt: 1 }); };
      api.saveClientWorkout = function (ownerId, change) {
        window.__queueCalls = window.__queueCalls || [];
        window.__queueCalls.push(change && change.localId);
        var mode = '';
        try { mode = new URLSearchParams(location.search).get('sync') || ''; } catch (e) {}
        if (mode === 'queue' && change && change.localId === 'wo_q1') return Promise.reject(new Error('There is no connection.'));
        return Promise.resolve({ ok: true });
      };
      api.saveClientCopy = function () { return Promise.resolve({ ok: true }); };
      api.deleteClientCopy = function () { return Promise.resolve({ ok: true }); };
      api.accountPull = function () {
        var mode = 'saved';
        try { mode = new URLSearchParams(location.search).get('sync') || 'saved'; } catch (e) {}
        window.__pulls = (window.__pulls || 0) + 1;
        if (mode === 'auth') return Promise.reject(new Error('JWT expired'));
        if (mode === 'offline') return Promise.reject(new Error('Failed to fetch'));
        if (mode === 'shape') return Promise.resolve('[{"localId":"wo_chest","name":"Chest - press","items":[{"name":"Press","sets":3}],"revisedAt":5000,"deleted":false,"createdAt":4000}]');
        return Promise.resolve([{
          localId: 'wo_chest',
          name: 'Chest - press',
          items: [{ name: 'Press', sets: 3 }],
          revisedAt: 5000,
          deleted: false,
          createdAt: 4000
        }]);
      };
      api.accountPush = function (change) {
        window.__pushes = window.__pushes || [];
        window.__pushes.push(change && change.localId);
        var mode = 'saved';
        try { mode = new URLSearchParams(location.search).get('sync') || 'saved'; } catch (e) {}
        if (mode === 'plan' && change && change.localId === 'wo_phone') {
          return Promise.reject(new Error('Your plan includes up to 6 workouts.'));
        }
        if (mode === 'split' && change && change.localId === 'wo_bad') {
          return Promise.reject(new Error('Enter a workout name.'));
        }
        return Promise.resolve({ localId: change.localId, revisedAt: change.revisedAt, deleted: !!change.deleted, name: change.name, items: change.items });
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  }, USER, M.STORAGE_KEY, presets);

  async function boot(mode) {
    await p.goto(URL + '?sync=' + mode);
    await p.waitForSelector('[data-a=new]');
  }
  async function status() {
    return p.$eval('#library-status', function (el) { return el.innerText.replace(/\s+/g, ' ').trim(); });
  }

  await boot('plan');
  await p.waitForFunction(function () { return document.body.innerText.indexOf('Chest - press') !== -1; });
  assert.strictEqual(await status(), 'Your plan includes up to 6 workouts. See plans');
  assert.ok(await p.$('#library-status a[href="#/subscriptions"]'));
  assert.ok((await p.$eval('[data-a=new]', function (el) { return el.nextElementSibling && el.nextElementSibling.id; })) === 'library-status');
  await p.screenshot({ path: path.join(ARTIFACTS, 'sync-status-plan-limit.png') });
  const pushed = await p.evaluate(function () { return window.__pushes || []; });
  assert.ok(pushed.indexOf('wo_phone') !== -1, 'the phone workout was still offered');
  assert.ok(pushed.indexOf('wo_chest') === -1, 'the workout from the other device is not sent back');

  await boot('auth');
  await p.waitForFunction(function () {
    var el = document.getElementById('library-status');
    return el && el.textContent === 'Sign in again';
  });
  assert.ok((await p.evaluate(function () { return document.body.innerText; })).indexOf('Chest - press') === -1);
  await p.screenshot({ path: path.join(ARTIFACTS, 'sync-status-sign-in.png') });

  await boot('offline');
  await p.waitForFunction(function () {
    var el = document.getElementById('library-status');
    return el && el.textContent === 'Offline, will sync';
  });
  await p.screenshot({ path: path.join(ARTIFACTS, 'sync-status-offline.png') });

  await boot('saved');
  await p.waitForFunction(function () {
    var el = document.getElementById('library-status');
    return el && el.textContent === 'Saved' && document.body.innerText.indexOf('Chest - press') !== -1;
  });
  await p.screenshot({ path: path.join(ARTIFACTS, 'sync-status-saved-chest.png') });

  await boot('shape');
  await p.waitForFunction(function () { return document.body.innerText.indexOf('Chest - press') !== -1; });

  await boot('split');
  await p.waitForFunction(function () { return document.body.innerText.indexOf('Chest - press') !== -1 && document.body.innerText.indexOf('Legs') !== -1; });
  const splitPushes = await p.evaluate(function () { return window.__pushes || []; });
  assert.ok(splitPushes.indexOf('wo_bad') !== -1 && splitPushes.indexOf('wo_good') !== -1, 'a refused workout does not stop the next one');
  assert.strictEqual(await status(), 'Enter a workout name.');

  await boot('queue');
  await p.waitForFunction(function () {
    var calls = window.__queueCalls || [];
    return document.body.innerText.indexOf('Chest - press') !== -1 && calls.indexOf('wo_q1') !== -1 && calls.indexOf('wo_q2') !== -1;
  });
  assert.strictEqual(await status(), 'There is no connection.');

  // Coming back to the app asks for workouts again, and a burst of focus events does not ask over and over.
  await boot('saved');
  await p.waitForFunction(function () { return (window.__pulls || 0) >= 1 && document.body.innerText.indexOf('Chest - press') !== -1; });
  await p.waitForFunction(function () { return !window.__pullsBusy; }).catch(function () {});
  await new Promise(function (r) { setTimeout(r, 500); });
  const before = await p.evaluate(function () { return window.__pulls || 0; });
  await p.evaluate(function () { window.__wbLibraryResumeMs = 10000; });
  await p.evaluate(function () { document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForFunction(function (n) { return (window.__pulls || 0) > n; }, {}, before);
  const afterVisible = await p.evaluate(function () { return window.__pulls || 0; });
  await p.evaluate(function () {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
  });
  await new Promise(function (r) { setTimeout(r, 300); });
  const afterBurst = await p.evaluate(function () { return window.__pulls || 0; });
  assert.ok(afterVisible > before, 'returning to the app checks for workouts');
  assert.strictEqual(afterBurst, afterVisible, 'focus and pageshow in the same moment do not each check again');

  assert.deepStrictEqual(errs, []);
  console.log('ACCOUNT SYNC UI OK');
  await b.close();
})().catch(function (e) { console.error(e); process.exit(1); });
