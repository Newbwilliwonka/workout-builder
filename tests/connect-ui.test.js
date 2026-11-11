// Real coaching screens with an in-memory book, plus the harmless preview.
// node tests/connect-ui.test.js [url]
const assert = require('assert');
const pp = require('puppeteer-core');
const stubAuth = require('./allow.js').stubAuth;
const M = require('../model.js');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const COPY = '11111111-1111-1111-1111-111111111111';

function received() {
  const w = M.newWorkout('Friday full body');
  w.id = COPY;
  w.sourceTrainerId = 'alex';
  w.sourceTrainerEmail = 'alex@example.com';
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Back squat', sets: 2, weight: { unit: 'lb', value: 95 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
  }))];
  return w;
}

async function installBook(page, who) {
  await page.evaluateOnNewDocument(function (who) {
    var desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
    var state = {
      share: true,
      threads: [
        { id: 'maya', name: 'maya@example.com', plan: 'Enthusiast', preview: 'Can we move Thursday?', at: new Date().toISOString(), unread: 1,
          messages: [
            { id: 'm1', senderId: 'maya', mine: false, body: 'Can we move Thursday?', at: new Date().toISOString(), readAt: null },
            { id: 'm2', senderId: 'coach', mine: true, body: 'Friday at 8 works.', at: new Date().toISOString(), readAt: null }
          ] },
        { id: 'jordan', name: 'jordan@example.com', plan: 'Free Client', preview: '', at: '', unread: 0, messages: [] }
      ],
      sent: []
    };
    function apiOf(base) {
      base.roster = function () {
        return Promise.resolve({
          role: who === 'trainer' ? 'trainer' : null,
          clients: [
            { id: 'maya', email: 'maya@example.com', plan: 'Enthusiast' },
            { id: 'jordan', email: 'jordan@example.com', plan: 'Free Client' }
          ],
          invites: [], clientCount: 2, cap: 15, canCreate: true
        });
      };
      base.myConnection = function () {
        if (who === 'trainer') return Promise.resolve(null);
        return Promise.resolve({ trainerId: 'alex', trainerEmail: 'alex@example.com' });
      };
      base.threads = function () {
        return Promise.resolve({
          role: who === 'trainer' ? 'trainer' : 'client',
          threads: who === 'trainer' ? state.threads.map(function (t) {
            return { id: t.id, name: t.name, plan: t.plan, preview: t.preview, at: t.at, unread: t.unread };
          }) : [{ id: 'alex', name: 'alex@example.com', plan: 'Trainer', preview: 'Sent Friday full body.', at: new Date().toISOString(), unread: 0 }]
        });
      };
      base.messages = function (id) {
        var t = state.threads.filter(function (row) { return row.id === id; })[0];
        if (!t && id === 'alex') t = { id: 'alex', name: 'alex@example.com', plan: 'Trainer', messages: state.threads[0].messages.map(function (m) { return { id: m.id, body: m.body, at: m.at, mine: !m.mine, readAt: m.readAt }; }) };
        if (!t) return Promise.reject(new Error('There is no connection.'));
        return Promise.resolve({ person: { id: t.id, name: t.name, plan: t.plan }, messages: t.messages });
      };
      base.sendMessage = function (id, body) {
        var t = state.threads.filter(function (row) { return row.id === id; })[0];
        if (!t) return Promise.reject(new Error('There is no connection.'));
        t.messages.push({ id: 'm' + t.messages.length, senderId: 'coach', mine: true, body: body, at: new Date().toISOString(), readAt: null });
        t.preview = body;
        return Promise.resolve({ ok: true });
      };
      base.markRead = function (id) {
        var t = state.threads.filter(function (row) { return row.id === id; })[0];
        if (t) { t.unread = 0; t.messages.forEach(function (m) { if (!m.mine) m.readAt = new Date().toISOString(); }); }
        return Promise.resolve({ ok: true });
      };
      base.sendWorkout = function (ids, name, items, sourceId) {
        state.sent.push({ ids: ids, name: name, items: items, sourceId: sourceId });
        return Promise.resolve({ name: name, sent: ids.map(function (id) { return { clientId: id, workoutId: 'copy-' + id }; }) });
      };
      base.myWorkouts = function () {
        try {
          var data = JSON.parse(localStorage.getItem('wb.data.v1') || '{}');
          return Promise.resolve((data.workouts || []).filter(function (w) { return w && w.sourceTrainerId; }));
        } catch (e) { return Promise.resolve([]); }
      };
      base.shareSetting = function () { return Promise.resolve({ on: state.share, enthusiast: who === 'enthusiast' }); };
      base.setShare = function (on) { state.share = !!on; return Promise.resolve({ on: state.share }); };
      base.clientView = function () {
        if (!state.share) return Promise.resolve({ shared: false, email: 'maya@example.com', plan: 'Enthusiast', workouts: [], logs: [] });
        return Promise.resolve({
          shared: true, email: 'maya@example.com', plan: 'Enthusiast',
          workouts: [{ id: 'own', name: 'Easy bike day', exerciseCount: 1 }],
          logs: [{ workoutName: 'Easy bike day', endedAt: new Date().toISOString() }]
        });
      };
      base.watchMessages = function () { return Promise.resolve(function () {}); };
      return base;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return desc.get(); },
      set: function (v) { desc.set(v); apiOf(desc.get()); }
    });
  }, who);
}

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  const copy = received();

  const trainer = await b.newPage();
  trainer.on('pageerror', e => errs.push('trainer ' + e));
  await trainer.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 1 });
  await stubAuth(trainer, {
    session: { user: { id: 'coach', email: 'kinisiathletics@gmail.com' } },
    profile: { membership: 'trainer', intended_plan: 'trainer' }
  });
  await installBook(trainer, 'trainer');
  const local = M.emptyData();
  const lower = M.newWorkout('Lower body strength');
  lower.items = [M.normalizeExercise(M.newExercise({ name: 'Squat', sets: 3, weight: { unit: 'lb', value: 135 }, mode: 'reps', modeConfig: { repsType: 'number', count: 5, restSec: 60 } }))];
  local.workouts.push(lower);
  await trainer.goto(URL);
  await trainer.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(local));
  const before = await trainer.evaluate(k => localStorage.getItem(k), M.STORAGE_KEY);
  await trainer.goto(URL + '#/messages');
  await trainer.waitForSelector('[data-thread=maya]');
  assert.strictEqual(await trainer.$('#sample-role'), null);
  assert.ok((await trainer.$eval('#thread-list', e => e.innerText)).includes('maya@example.com'));
  assert.strictEqual(await trainer.$eval('.count', e => e.textContent), '1');
  await trainer.click('[data-thread=maya]');
  await trainer.waitForSelector('#thread');
  assert.ok((await trainer.$eval('#thread', e => e.innerText)).includes('Can we move Thursday?'));
  assert.ok((await trainer.$eval('#thread', e => e.innerText)).includes('Friday at 8 works.'));
  await trainer.type('#msg-text', 'Friday still works');
  await trainer.click('#msg-send');
  await trainer.waitForFunction(() => document.body.innerText.includes('Friday still works'));
  await trainer.click('#back');
  await trainer.waitForFunction(() => !document.querySelector('.count'));

  await trainer.goto(URL + '#/send');
  await trainer.reload();
  await trainer.waitForSelector('#send-go');
  await trainer.click('[data-pick-client=maya]');
  await trainer.click('[data-pick-client=jordan]');
  await trainer.waitForFunction(() => document.getElementById('send-go').textContent === 'Send to 2 clients');
  await trainer.click('#send-go');
  await trainer.waitForSelector('#sent-note');
  const sent = await trainer.$eval('#sent-note', e => e.innerText);
  assert.ok(sent.includes('maya@example.com'));
  assert.ok(sent.includes('editable copy'));
  assert.ok(sent.includes('jordan@example.com'));
  assert.ok(sent.includes('can run'));
  assert.ok(sent.includes('was not changed'));
  assert.strictEqual(await trainer.evaluate(k => localStorage.getItem(k), M.STORAGE_KEY), before);
  await trainer.goto(URL + '#/client/maya');
  await trainer.waitForSelector('#client-view');
  assert.ok((await trainer.$eval('#client-view', e => e.innerText)).includes('Easy bike day'));

  const free = await b.newPage();
  free.on('pageerror', e => errs.push('free ' + e));
  await free.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 1 });
  await stubAuth(free, {
    session: { user: { id: 'jordan', email: 'jordan@example.com' } },
    profile: { membership: 'free_client', intended_plan: null }
  });
  await installBook(free, 'free');
  const freeData = M.emptyData();
  freeData.workouts.push(copy);
  await free.goto(URL);
  await free.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(freeData));
  await free.goto(URL + '#/received');
  await free.reload();
  await free.waitForSelector('[data-open-copy]');
  assert.ok((await free.$eval('#app', e => e.innerText)).includes('You can run it'));
  assert.strictEqual(await free.$('#sample-role'), null);
  assert.strictEqual(await free.$('[data-a=rename]'), null);
  await free.click('[data-open-copy]');
  await free.waitForSelector('#copy-note');
  assert.ok((await free.$eval('#copy-note', e => e.textContent)).includes('Only an Enthusiast can edit'));
  await free.click('#copy-run');
  await free.waitForSelector('.pl-screen');
  assert.strictEqual(await free.$('[data-a=add]'), null);

  const fan = await b.newPage();
  fan.on('pageerror', e => errs.push('fan ' + e));
  await fan.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 1 });
  await stubAuth(fan, {
    session: { user: { id: 'maya', email: 'maya@example.com' } },
    profile: { membership: 'enthusiast', intended_plan: 'enthusiast' }
  });
  await installBook(fan, 'enthusiast');
  const fanData = M.emptyData();
  fanData.workouts.push(JSON.parse(JSON.stringify(copy)));
  await fan.goto(URL);
  await fan.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(fanData));
  await fan.goto(URL + '#/received');
  await fan.reload();
  await fan.waitForSelector('[data-open-copy]');
  assert.ok((await fan.$eval('#app', e => e.innerText)).includes('You can edit it'));
  await fan.click('[data-open-copy]');
  await fan.waitForSelector('#copy-note');
  assert.ok((await fan.$eval('#copy-note', e => e.textContent)).includes('do not change their workout'));
  assert.ok(await fan.$('[data-a=add]'));
  await fan.goto(URL + '#/account');
  await fan.waitForSelector('#share-account');
  assert.strictEqual(await fan.$eval('#share-account', e => e.getAttribute('aria-checked')), 'true');
  await fan.click('#share-account');
  await fan.waitForFunction(() => document.getElementById('share-account').getAttribute('aria-checked') === 'false');

  const offline = await b.newPage();
  offline.on('pageerror', e => errs.push('offline ' + e));
  await stubAuth(offline, {
    session: { user: { id: 'coach', email: 'kinisiathletics@gmail.com' } },
    profile: { membership: 'trainer', intended_plan: 'trainer' }
  });
  await offline.evaluateOnNewDocument(function () {
    var desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return desc.get(); },
      set: function (v) {
        desc.set(v);
        var api = desc.get();
        api.threads = function () { return Promise.reject(new Error('Coaching is not available yet. Apply the coaching SQL in the Supabase SQL editor.')); };
        api.roster = function () { return Promise.resolve({ role: null }); };
        api.myConnection = function () { return Promise.resolve(null); };
      }
    });
  });
  await offline.goto(URL + '#/messages');
  await offline.waitForSelector('#coaching-wait');
  assert.strictEqual(await offline.$('#sample-role'), null);
  assert.ok((await offline.$eval('#coaching-wait', e => e.innerText)).includes('Apply the coaching SQL'));

  const preview = await b.newPage();
  preview.on('pageerror', e => errs.push('preview ' + e));
  await preview.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 1 });
  await preview.goto(URL + '#/messages?preview=1');
  await preview.waitForSelector('#sample-role');
  assert.ok(await preview.$('[data-thread=maya]'));

  assert.deepStrictEqual(errs, []);
  console.log('CONNECT UI OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
