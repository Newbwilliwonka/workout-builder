// Sharing option, account switch, and the trainer's read-only view. No live database.
// node tests/sharing-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';
const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', function (e) { errs.push(String(e)); });
  await page.evaluateOnNewDocument(function (T, C, E) {
    function read() {
      try { return JSON.parse(localStorage.getItem('wb.sharetest') || '{}'); } catch (e) { return {}; }
    }
    function write(cfg) {
      localStorage.setItem('wb.sharetest', JSON.stringify(cfg));
    }
    var stub = {
      session: function () {
        var cfg = read();
        if (cfg.who === 'out') return Promise.resolve(null);
        var person = cfg.who === 'trainer'
          ? { id: T, email: 'coach@example.com' }
          : cfg.who === 'free'
            ? { id: C, email: 'ada@example.com' }
            : { id: E, email: cfg.builder ? 'kinisiathletics@gmail.com' : 'fan@example.com' };
        return Promise.resolve({ user: person });
      },
      profile: function () {
        var cfg = read();
        var person = cfg.who === 'trainer'
          ? { id: T, email: 'coach@example.com', membership: 'trainer', intended_plan: 'trainer' }
          : cfg.who === 'free'
            ? { id: C, email: 'ada@example.com', membership: 'free_client', intended_plan: null }
            : { id: E, email: cfg.builder ? 'kinisiathletics@gmail.com' : 'fan@example.com', membership: 'enthusiast', intended_plan: 'enthusiast' };
        return Promise.resolve(person);
      },
      myConnection: function () {
        var cfg = read();
        if (!cfg.linked || cfg.who === 'trainer') return Promise.resolve(null);
        return Promise.resolve({ trainerId: T, trainerEmail: 'coach@example.com' });
      },
      roster: function () {
        var cfg = read();
        if (cfg.who !== 'trainer') return Promise.resolve({ role: null });
        return Promise.resolve({
          role: 'trainer', cap: 15, clientCount: 2, canCreate: true, invites: [],
          clients: [
            { id: E, email: 'fan@example.com', plan: 'Enthusiast' },
            { id: C, email: 'ada@example.com', plan: 'Free Client' }
          ]
        });
      },
      redeemInvite: function (code, share) {
        window.__redeem = { code: code, share: share };
        if (code === 'FAILFAIL') return Promise.reject(new Error('That invite code was not found.'));
        var stored = typeof share === 'boolean';
        return Promise.resolve({
          message: 'You are connected. Your Enthusiast plan is unchanged.',
          trainerId: T,
          shareStored: stored
        });
      },
      shareSetting: function () {
        window.__settingCalls++;
        var cfg = read();
        if (cfg.mode === 'unavailable') return Promise.reject(new Error('Sharing workouts is not available yet. Apply the sharing SQL in the Supabase SQL editor.'));
        if (cfg.setting === 'down') return Promise.reject(new Error('Failed to fetch'));
        if (cfg.mode === 'retry') {
          cfg.mode = 'ok';
          write(cfg);
          return Promise.reject(new Error('Failed to fetch'));
        }
        if (cfg.mode === 'retry-hold') {
          cfg.mode = 'hold';
          write(cfg);
          return Promise.reject(new Error('Failed to fetch'));
        }
        if (cfg.mode === 'hold') {
          return new Promise(function (resolve) {
            window.__settingRelease = function () {
              var next = read();
              resolve({ on: next.on === true, enthusiast: true, linked: !!next.linked });
            };
          });
        }
        if (cfg.mode === 'down') return Promise.reject(new Error('Failed to fetch'));
        if (cfg.mode === 'bad') return Promise.resolve({ on: 'yes' });
        if (typeof cfg.on !== 'boolean') return Promise.resolve({});
        return Promise.resolve({ on: cfg.on, enthusiast: true, linked: !!cfg.linked });
      },
      setShare: function (on) {
        var cfg = read();
        window.__shareCalls.push(on);
        if (cfg.mode === 'fail') {
          cfg.mode = 'ok';
          write(cfg);
          return Promise.reject(new Error('Could not save that choice.'));
        }
        if (cfg.mode === 'save-unavail') {
          cfg.mode = 'ok';
          write(cfg);
          return Promise.reject(new Error('Sharing workouts is not available yet. Apply the sharing SQL in the Supabase SQL editor.'));
        }
        if (cfg.mode === 'garbage') {
          cfg.mode = 'ok';
          write(cfg);
          return Promise.resolve({ ok: true });
        }
        if (cfg.mode === 'slow') {
          cfg.mode = 'ok';
          write(cfg);
          return new Promise(function (resolve) {
            window.__shareRelease = function () {
              var next = read();
              next.on = on;
              write(next);
              resolve({ on: on, enthusiast: true, linked: true });
            };
          });
        }
        cfg.on = on;
        cfg.mode = 'ok';
        write(cfg);
        return Promise.resolve({ on: on, enthusiast: true, linked: !!cfg.linked });
      },
      pushOwn: function (workouts, sessions) {
        window.__pushes.push({ workouts: workouts, sessions: sessions });
        var cfg = read();
        if (cfg.mode === 'push-fail') return Promise.reject(new Error('Failed to fetch'));
        if (cfg.mode === 'push-slow-fail') {
          cfg.pushFails = (cfg.pushFails || 0) + 1;
          if (cfg.pushFails >= 3) cfg.mode = 'ok';
          write(cfg);
          if (cfg.pushFails < 3) {
            return new Promise(function (resolve, reject) {
              window.__pushRelease = function () { reject(new Error('Failed to fetch')); };
            });
          }
          return Promise.resolve({ ok: true, workouts: workouts.length, sessions: sessions.length });
        }
        return Promise.resolve({ ok: true, workouts: workouts.length, sessions: sessions.length });
      },
      clientStatus: function (id) {
        window.__statusCalls.push(id);
        var cfg = read();
        if (cfg.mode === 'view-down') return Promise.reject(new Error('Sharing workouts is not available yet. Apply the sharing SQL in the Supabase SQL editor.'));
        if (cfg.mode === 'view-error') return Promise.reject(new Error('Failed to fetch'));
        if (cfg.mode === 'view-bad') return Promise.resolve({ shared: 'yes' });
        var enthusiast = id === E;
        var shared = enthusiast && cfg.mode !== 'view-off';
        return Promise.resolve({
          linked: true,
          enthusiast: enthusiast,
          shared: shared,
          email: enthusiast ? 'fan@example.com' : 'ada@example.com',
          plan: enthusiast ? 'Enthusiast' : 'Free Client'
        });
      },
      clientWorkouts: function () {
        window.__workoutCalls++;
        var cfg = read();
        if (cfg.mode === 'rows-fail') return Promise.reject(new Error('Could not load workouts.'));
        return Promise.resolve([{
          localId: 'wo_sat',
          name: 'Saturday easy',
          items: [{ name: 'Squat', sets: 3 }, { name: 'Plank', sets: 2 }]
        }]);
      },
      clientSessions: function () {
        return Promise.resolve([{
          localId: 'ses_1',
          workoutName: 'Saturday easy',
          endedAt: '2026-11-11T15:04:00.000Z',
          results: [
            { name: 'Squat', set: 1, of: 3, reps: 8, weight: 135, unit: 'lb', logged: true },
            { name: 'Squat', set: 2, of: 3, reps: 8, weight: 140, unit: 'lb', logged: true }
          ]
        }]);
      }
    };
    window.__shareCalls = [];
    window.__pushes = [];
    window.__settingCalls = 0;
    window.__statusCalls = [];
    window.__workoutCalls = 0;
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return stub; },
      set: function () {}
    });
  }, T, C, E);

  const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  async function boot(cfg, hash, data, log) {
    await page.goto(URL);
    await page.evaluate(function (cfg, data, log) {
      localStorage.setItem('wb.sharetest', JSON.stringify(cfg));
      if (data) localStorage.setItem('wb.data.v1', data);
      else localStorage.removeItem('wb.data.v1');
      localStorage.removeItem('wb.trainer');
      if (log == null) localStorage.removeItem('wb.ownSessions.v1');
      else localStorage.setItem('wb.ownSessions.v1', log);
    }, cfg, data || '', log == null ? null : log);
    await page.goto(URL + hash, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  async function shot(name, sel) {
    if (sel) await page.$eval(sel, function (el) { el.scrollIntoView({ block: 'center' }); });
    await wait(150);
    await page.screenshot({ path: ART + '/' + name });
  }
  function ownData() {
    return JSON.stringify({
      version: 4,
      workouts: [
        { id: 'wo_sat', name: 'Saturday easy', items: [{ id: 'ex1', name: 'Squat', sets: 3 }], createdAt: 1, updatedAt: 5 },
        { id: 'from', name: 'Trainer day', items: [], sourceTrainerId: T, sourceTrainerEmail: 'coach@example.com', createdAt: 1, updatedAt: 1 }
      ],
      sessions: [
        { id: 'ses_own', workoutId: 'wo_sat', workoutName: 'Saturday easy', ownWork: true, endedAt: 1760001000000, results: [{ name: 'Squat', set: 1, of: 3, reps: 8, weight: 135, unit: 'lb', logged: true }] },
        { id: 'ses_copy', workoutId: 'from', workoutName: 'Trainer day', ownWork: false, endedAt: 1760002000000, results: [{ name: 'Secret', reps: 9, logged: true }] }
      ]
    });
  }

  await boot({ who: 'enthusiast', linked: false, mode: 'ok', on: true }, '#/subscriptions');
  await page.waitForSelector('#share-link');
  assert.strictEqual(await page.$eval('#share-link', function (el) { return el.checked; }), true);
  assert.ok((await page.$eval('#share-option', function (el) { return el.textContent; })).includes('avoid training conflicts'));
  assert.strictEqual(await page.$('#share-account'), null);
  await shot('share-link-checked.png', '#share-option');
  await page.click('#share-link');
  assert.strictEqual(await page.$eval('#share-link', function (el) { return el.checked; }), false);
  await page.click('#invite-code', { clickCount: 3 });
  await page.type('#invite-code', 'FAILFAIL');
  await page.click('[data-invite=redeem]');
  await page.waitForFunction(function () { return document.body.innerText.indexOf('not found') !== -1; });
  assert.strictEqual(await page.$eval('#share-link', function (el) { return el.checked; }), false);
  await page.evaluate(function () { document.getElementById('invite-code').value = 'ABCD2345'; });
  await page.click('[data-invite=redeem]');
  await page.waitForFunction(function () { return document.body.innerText.indexOf('Enthusiast plan is unchanged') !== -1; });
  assert.deepStrictEqual(await page.evaluate(function () { return window.__redeem.share; }), false);
  assert.deepStrictEqual(await page.evaluate(function () { return window.__pushes; }), []);

  await boot({ who: 'free', linked: false, mode: 'ok', on: true }, '#/subscriptions');
  await page.waitForSelector('#redeem');
  assert.strictEqual(await page.$('#share-link'), null);
  assert.strictEqual(await page.$('#share-account'), null);
  assert.ok((await page.evaluate(function () { return document.body.innerText; })).indexOf('Let your trainer view') === -1);

  await boot({ who: 'enthusiast', linked: true, mode: 'ok', on: true }, '#/account', ownData());
  await page.waitForSelector('#share-account');
  assert.strictEqual(await page.$eval('#share-account', function (el) { return el.getAttribute('aria-checked'); }), 'true');
  assert.strictEqual(await page.$eval('#share-account', function (el) { return el.disabled; }), false);
  await page.waitForFunction(function () { return window.__pushes.length === 1; });
  var pushed = await page.evaluate(function () { return window.__pushes[0]; });
  assert.deepStrictEqual(pushed.workouts.map(function (w) { return w.name; }), ['Saturday easy']);
  assert.deepStrictEqual(pushed.sessions.map(function (s) { return s.workoutName; }), ['Saturday easy']);
  assert.ok(JSON.stringify(pushed).indexOf('Secret') === -1);
  assert.ok(JSON.stringify(pushed).indexOf('Trainer day') === -1);
  await shot('share-account-on.png', '#share-card');

  await page.evaluate(function () {
    var cfg = JSON.parse(localStorage.getItem('wb.sharetest'));
    cfg.mode = 'slow';
    localStorage.setItem('wb.sharetest', JSON.stringify(cfg));
  });
  await page.click('#share-account');
  await page.waitForFunction(function () { return document.getElementById('share-account').disabled; });
  assert.strictEqual(await page.$eval('#share-account', function (el) { return el.getAttribute('aria-checked'); }), 'true');
  await wait(400);
  assert.strictEqual(await page.$eval('#share-account', function (el) { return el.disabled; }), true);
  assert.deepStrictEqual(await page.evaluate(function () { return window.__shareCalls; }), [false]);
  await page.evaluate(function () { window.__shareRelease(); });
  await page.waitForFunction(function () {
    var el = document.getElementById('share-account');
    return el && !el.disabled && el.getAttribute('aria-checked') === 'false';
  });
  await shot('share-account-off.png', '#share-card');

  await page.evaluate(function () {
    var cfg = JSON.parse(localStorage.getItem('wb.sharetest'));
    cfg.mode = 'fail';
    localStorage.setItem('wb.sharetest', JSON.stringify(cfg));
  });
  await page.click('#share-account');
  await page.waitForFunction(function () {
    var el = document.getElementById('share-account');
    return el && !el.disabled && el.getAttribute('aria-checked') === 'false';
  });
  assert.ok((await page.evaluate(function () { return document.getElementById('toast').textContent; })).includes('Could not save'));

  await page.evaluate(function () {
    var cfg = JSON.parse(localStorage.getItem('wb.sharetest'));
    cfg.mode = 'garbage';
    localStorage.setItem('wb.sharetest', JSON.stringify(cfg));
  });
  await page.click('#share-account');
  await page.waitForFunction(function () {
    var el = document.getElementById('share-account');
    return el && !el.disabled && el.getAttribute('aria-checked') === 'false';
  });
  assert.strictEqual(await page.evaluate(function () { return JSON.parse(localStorage.getItem('wb.sharetest')).on; }), false);

  await boot({ who: 'enthusiast', linked: true, mode: 'down', on: true }, '#/account', ownData());
  await page.waitForSelector('#share-error');
  assert.strictEqual(await page.$('#share-account'), null);
  assert.ok((await page.evaluate(function () { return document.body.innerText; })).includes('Could not load sharing'));
  assert.strictEqual(await page.$('#share-account'), null);
  var kept = JSON.parse(await page.evaluate(function (k) { return localStorage.getItem(k); }, 'wb.data.v1'));
  assert.strictEqual(kept.workouts[0].name, 'Saturday easy');
  assert.strictEqual(kept.workouts[0].updatedAt, 5);
  assert.strictEqual(await page.evaluate(function () { return localStorage.getItem('wb.shareWorkouts'); }), null);

  await boot({ who: 'enthusiast', linked: true, mode: 'unavailable', on: true }, '#/account');
  await page.waitForSelector('#share-wait');
  assert.ok((await page.$eval('#share-wait', function (el) { return el.textContent; })).includes('Not available yet'));
  assert.strictEqual(await page.$('#share-account'), null);

  await boot({ who: 'enthusiast', linked: true, mode: 'push-fail', on: true }, '#/account', ownData());
  await page.waitForSelector('#share-account');
  await page.waitForFunction(function () { return window.__pushes.length === 1; });
  await wait(100);
  kept = JSON.parse(await page.evaluate(function (k) { return localStorage.getItem(k); }, 'wb.data.v1'));
  assert.strictEqual(kept.workouts.map(function (w) { return w.name; }).join(','), 'Saturday easy,Trainer day');
  assert.strictEqual(kept.workouts[0].updatedAt, 5);

  await boot({ who: 'enthusiast', linked: true, mode: 'ok', on: true }, '#/account', ownData(), '{');
  await page.waitForSelector('#share-account');
  await wait(250);
  assert.strictEqual(await page.evaluate(function () { return localStorage.getItem('wb.ownSessions.v1'); }), '{');
  assert.deepStrictEqual(await page.evaluate(function () { return window.__pushes; }), []);

  await boot({ who: 'enthusiast', linked: true, mode: 'ok', on: true, builder: true }, '#/', ownData());
  await page.waitForSelector('[data-a="new"]');
  assert.strictEqual(await page.$('#share-account'), null);
  await page.waitForFunction(function () { return window.__pushes.length === 1; });
  var fromHome = await page.evaluate(function () { return window.__pushes[0]; });
  assert.deepStrictEqual(fromHome.workouts.map(function (w) { return w.name; }), ['Saturday easy']);
  assert.deepStrictEqual(fromHome.sessions.map(function (s) { return s.workoutName; }), ['Saturday easy']);
  assert.ok(JSON.stringify(fromHome).indexOf('Secret') === -1);
  page.once('dialog', function (dialog) { return dialog.accept('Saturday hard'); });
  await page.click('[data-a="rename"][data-id="wo_sat"]');
  await page.waitForFunction(function () { return window.__pushes.length === 2; });
  assert.deepStrictEqual((await page.evaluate(function () { return window.__pushes[1]; })).workouts.map(function (w) { return w.name; }), ['Saturday hard']);
  await page.evaluate(function (trainerId) {
    window.__wbPlayer = {
      w: { id: 'from', name: 'Trainer day', sourceTrainerId: trainerId, items: [] },
      done: { id: 'leak', workoutId: 'from', workoutName: 'Trainer day', endedAt: 9, results: [{ name: 'Secret', reps: 4, logged: true }] }
    };
  }, T);
  await page.evaluate(function () { location.hash = '#/w/wo_sat'; });
  await page.waitForFunction(function () { return !window.__wbPlayer || window.__wbPlayer.done == null; });
  assert.strictEqual(await page.evaluate(function () { return localStorage.getItem('wb.ownSessions.v1'); }), null);
  await page.evaluate(function () { location.hash = '#/'; });
  await page.waitForSelector('[data-a="del"][data-id="from"]');
  page.once('dialog', function (dialog) { return dialog.accept(); });
  await page.click('[data-a="del"][data-id="from"]');
  await page.waitForFunction(function () { return !document.querySelector('[data-a="del"][data-id="from"]'); });
  await page.evaluate(function () {
    window.__wbPlayer = {
      w: { id: 'from', name: 'Trainer day', items: [] },
      done: { id: 'leak2', workoutId: 'from', workoutName: 'Trainer day', endedAt: 11, ownWork: false, results: [{ name: 'Secret', reps: 4, logged: true }] }
    };
  });
  await page.evaluate(function () { location.hash = '#/account'; });
  await page.waitForSelector('#share-account');
  assert.strictEqual(await page.evaluate(function () { return localStorage.getItem('wb.ownSessions.v1'); }), null);
  assert.ok((await page.evaluate(function () { return JSON.stringify(window.__pushes); })).indexOf('leak2') === -1);
  assert.ok((await page.evaluate(function () { return JSON.stringify(window.__pushes); })).indexOf('Secret') === -1);

  await boot({ who: 'enthusiast', linked: true, mode: 'push-slow-fail', on: true, builder: true }, '#/', ownData());
  await page.waitForSelector('[data-a="rename"][data-id="wo_sat"]');
  await page.waitForFunction(function () { return window.__pushes.length === 1; });
  page.once('dialog', function (dialog) { return dialog.accept('Saturday hard'); });
  await page.click('[data-a="rename"][data-id="wo_sat"]');
  await page.waitForFunction(function () { return document.body.innerText.indexOf('Saturday hard') !== -1; });
  await page.evaluate(function () { window.__pushRelease(); });
  await page.waitForFunction(function () { return window.__pushes.length === 2; });
  await page.evaluate(function () { window.__pushRelease(); });
  await page.waitForFunction(function () { return window.__pushes.length === 3; });
  var retried = await page.evaluate(function () { return window.__pushes[2]; });
  assert.deepStrictEqual(retried.workouts.map(function (w) { return w.name; }), ['Saturday hard']);
  assert.deepStrictEqual((await page.evaluate(function () { return window.__pushes[1]; })).workouts.map(function (w) { return w.name; }), ['Saturday hard']);
  var still = JSON.parse(await page.evaluate(function (k) { return localStorage.getItem(k); }, 'wb.data.v1'));
  assert.strictEqual(still.workouts[0].name, 'Saturday hard');

  await boot({ who: 'enthusiast', linked: true, mode: 'retry', on: true, builder: true }, '#/', ownData());
  await page.waitForSelector('[data-a="new"]');
  await page.waitForFunction(function () { return window.__settingCalls === 1; });
  assert.deepStrictEqual(await page.evaluate(function () { return window.__pushes; }), []);
  assert.strictEqual(await page.$('#share-account'), null);
  assert.strictEqual(await page.evaluate(function () { return localStorage.getItem('wb.shareWorkouts'); }), null);
  var beforeRetry = JSON.parse(await page.evaluate(function (k) { return localStorage.getItem(k); }, 'wb.data.v1'));
  assert.strictEqual(beforeRetry.workouts[0].name, 'Saturday easy');
  assert.strictEqual(beforeRetry.workouts[0].updatedAt, 5);
  await page.waitForFunction(function () { return window.__pushes.length === 1; }, { timeout: 5000 });
  assert.strictEqual(await page.evaluate(function () { return window.__settingCalls; }), 2);
  assert.deepStrictEqual((await page.evaluate(function () { return window.__pushes[0]; })).workouts.map(function (w) { return w.name; }), ['Saturday easy']);
  var afterRetry = JSON.parse(await page.evaluate(function (k) { return localStorage.getItem(k); }, 'wb.data.v1'));
  assert.strictEqual(afterRetry.workouts[0].updatedAt, 5);

  await boot({ who: 'enthusiast', linked: true, mode: 'retry-hold', on: true, builder: true }, '#/', ownData());
  await page.waitForFunction(function () { return window.__settingCalls === 1; });
  await wait(50);
  await page.evaluate(function () {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForFunction(function () { return window.__settingCalls === 2; });
  await wait(400);
  assert.strictEqual(await page.evaluate(function () { return window.__settingCalls; }), 2);
  assert.deepStrictEqual(await page.evaluate(function () { return window.__pushes; }), []);
  await page.evaluate(function () { window.__settingRelease(); });
  await page.waitForFunction(function () { return window.__pushes.length === 1; });
  assert.deepStrictEqual((await page.evaluate(function () { return window.__pushes[0]; })).workouts.map(function (w) { return w.name; }), ['Saturday easy']);
  assert.ok((await page.evaluate(function () { return JSON.stringify(window.__pushes); })).indexOf('Secret') === -1);

  await boot({ who: 'enthusiast', linked: true, mode: 'ok', on: true, builder: true }, '#/account', ownData());
  await page.waitForSelector('#share-account');
  await page.waitForFunction(function () { return window.__pushes.length === 1; });
  await page.evaluate(function () {
    var cfg = JSON.parse(localStorage.getItem('wb.sharetest'));
    cfg.setting = 'down';
    localStorage.setItem('wb.sharetest', JSON.stringify(cfg));
  });
  await page.evaluate(function () { location.hash = '#/subscriptions'; });
  await page.waitForSelector('#redeem');
  await page.evaluate(function () { location.hash = '#/account'; });
  await page.waitForSelector('#share-account');
  await wait(400);
  assert.strictEqual(await page.evaluate(function () { return window.__pushes.length; }), 1);
  assert.strictEqual(await page.$eval('#share-account', function (el) { return el.getAttribute('aria-checked'); }), 'true');
  await page.evaluate(function () {
    var cfg = JSON.parse(localStorage.getItem('wb.sharetest'));
    cfg.mode = 'slow';
    cfg.setting = 'down';
    localStorage.setItem('wb.sharetest', JSON.stringify(cfg));
  });
  await page.click('#share-account');
  await page.waitForFunction(function () { return document.getElementById('share-account').disabled; });
  var during = await page.evaluate(function () { return window.__settingCalls; });
  await page.evaluate(function () { location.hash = '#/'; });
  await page.waitForSelector('[data-a="rename"][data-id="wo_sat"]');
  page.once('dialog', function (dialog) { return dialog.accept('Saturday later'); });
  await page.click('[data-a="rename"][data-id="wo_sat"]');
  await page.waitForFunction(function () { return document.body.innerText.indexOf('Saturday later') !== -1; });
  await page.evaluate(function () { location.hash = '#/account'; });
  await page.waitForFunction(function () {
    var el = document.getElementById('share-account');
    return el && el.disabled && el.getAttribute('aria-checked') === 'true';
  });
  await wait(300);
  assert.strictEqual(await page.evaluate(function () { return window.__pushes.length; }), 1);
  assert.ok(await page.evaluate(function (n) { return window.__settingCalls === n; }, during));
  await page.evaluate(function () { window.__shareRelease(); });
  await page.waitForFunction(function () {
    var el = document.getElementById('share-account');
    return el && !el.disabled && el.getAttribute('aria-checked') === 'false';
  });
  await wait(400);
  assert.strictEqual(await page.evaluate(function () { return window.__pushes.length; }), 1);
  var renamed = JSON.parse(await page.evaluate(function (k) { return localStorage.getItem(k); }, 'wb.data.v1'));
  assert.strictEqual(renamed.workouts[0].name, 'Saturday later');

  await boot({ who: 'enthusiast', linked: true, mode: 'ok', on: true }, '#/account', ownData());
  await page.waitForSelector('#share-account');
  await page.waitForFunction(function () { return window.__pushes.length === 1; });
  await page.evaluate(function () {
    var cfg = JSON.parse(localStorage.getItem('wb.sharetest'));
    cfg.mode = 'save-unavail';
    localStorage.setItem('wb.sharetest', JSON.stringify(cfg));
  });
  await page.click('#share-account');
  await page.waitForSelector('#share-wait');
  assert.strictEqual(await page.$('#share-account'), null);
  assert.ok((await page.$eval('#share-wait', function (el) { return el.textContent; })).includes('Not available yet'));
  assert.strictEqual(await page.evaluate(function () { return window.__pushes.length; }), 1);
  await page.evaluate(function () { location.hash = '#/subscriptions'; });
  await page.waitForSelector('#redeem');
  await page.evaluate(function () { location.hash = '#/account'; });
  await page.waitForFunction(function () {
    var el = document.getElementById('share-account');
    return el && !el.disabled && el.getAttribute('aria-checked') === 'true';
  });
  await page.waitForFunction(function () { return window.__pushes.length === 2; });

  await boot({ who: 'trainer', linked: false, mode: 'ok', on: true }, '#/client/' + E);
  await page.waitForSelector('#client-view');
  var viewText = await page.$eval('#client-view', function (el) { return el.textContent; });
  assert.ok(viewText.includes('Saturday easy'));
  assert.ok(viewText.includes('Squat · 3 sets'));
  assert.ok(viewText.includes('Squat · set 1 of 3 · 8 reps · 135 lb'));
  assert.ok(viewText.includes('Squat · set 2 of 3 · 8 reps · 140 lb'));
  assert.ok(viewText.includes('Read only'));
  assert.strictEqual(await page.$('#client-view input, #client-view textarea, #client-view select, #client-view button'), null);
  await shot('share-trainer-view.png', '#client-view');

  await boot({ who: 'trainer', linked: false, mode: 'view-off', on: false }, '#/client/' + E);
  await page.waitForSelector('#client-private');
  var privateText = await page.evaluate(function () { return document.body.innerText; });
  assert.ok(privateText.includes('Not shared'));
  assert.ok(privateText.indexOf('Saturday easy') === -1);
  assert.strictEqual(await page.evaluate(function () { return window.__workoutCalls; }), 0);

  await boot({ who: 'trainer', linked: false, mode: 'view-error', on: true }, '#/client/' + E);
  await page.waitForSelector('#client-error');
  privateText = await page.evaluate(function () { return document.body.innerText; });
  assert.ok(privateText.indexOf('Not shared') === -1);
  assert.ok(privateText.indexOf('Saturday easy') === -1);
  assert.ok(privateText.indexOf('No workouts of their own') === -1);

  await boot({ who: 'trainer', linked: false, mode: 'rows-fail', on: true }, '#/client/' + E);
  await page.waitForSelector('#client-error');
  privateText = await page.evaluate(function () { return document.body.innerText; });
  assert.ok(privateText.indexOf('Saturday easy') === -1);
  assert.ok(privateText.indexOf('No workouts of their own') === -1);

  await boot({ who: 'trainer', linked: false, mode: 'view-bad', on: true }, '#/client/' + E);
  await page.waitForSelector('#client-error');
  assert.strictEqual(await page.evaluate(function () { return window.__workoutCalls; }), 0);
  assert.ok((await page.evaluate(function () { return document.body.innerText; })).indexOf('Saturday easy') === -1);

  await boot({ who: 'trainer', linked: false, mode: 'ok', on: true }, '#/client/' + C);
  await page.waitForSelector('#client-free');
  privateText = await page.evaluate(function () { return document.body.innerText; });
  assert.ok(privateText.includes('Free Clients'));
  assert.ok(privateText.indexOf('Saturday easy') === -1);
  assert.strictEqual(await page.evaluate(function () { return window.__workoutCalls; }), 0);

  await boot({ who: 'trainer', linked: false, mode: 'view-down', on: true }, '#/client/' + E);
  await page.waitForSelector('#client-wait');
  assert.ok((await page.$eval('#client-wait', function (el) { return el.textContent; })).includes('Not available yet'));
  assert.strictEqual(await page.$('#client-view'), null);

  await boot({ who: 'trainer', linked: false, mode: 'ok', on: true }, '#/account');
  await page.waitForSelector('[data-client-view="' + E + '"]');
  assert.ok((await page.$eval('#invites', function (el) { return el.textContent; })).includes('2 of 15 clients'));
  assert.ok((await page.evaluate(function () { return document.body.innerText; })).includes('fan@example.com'));
  await page.click('[data-client-view="' + E + '"]');
  await page.waitForSelector('#client-view');
  await page.click('#back');
  await page.waitForSelector('#invites');

  assert.deepStrictEqual(errs, []);
  console.log('SHARING UI OK');
  await browser.close();
})().catch(function (err) { console.error(err); process.exit(1); });
