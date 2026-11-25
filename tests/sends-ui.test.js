// Trainer send, Enthusiast edit, and Free Client run-only. The live project is not used.
// node tests/sends-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');
const M = require('../model.js');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';
const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const COPY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

function workout() {
  const w = M.newWorkout('Friday full body');
  w.id = 'wo_friday';
  M.upsertExercise(w, M.newExercise({
    id: 'ex_squat', name: 'Squat', sets: 3,
    weight: { unit: 'lb', value: 135 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 60 }
  }));
  w.items[0].id = 'ex_squat';
  return w;
}
function ownWorkout() {
  const w = M.newWorkout('Saturday easy');
  w.id = 'wo_sat';
  return w;
}
function dataWith(list) {
  const data = M.emptyData();
  data.workouts = list;
  return JSON.stringify(data);
}

const box = { copies: [], calls: [], saves: [], mode: 'ok', saveMode: 'ok', profileDown: false, wait: null };

function shape(row) {
  return {
    id: row.id,
    name: row.name,
    items: row.items,
    sourceTrainerId: row.trainerId,
    sourceTrainerEmail: 'kinisiathletics@gmail.com',
    sourceWorkoutId: row.sourceWorkoutId || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
async function handleSend(deliveries, name, items, source) {
  box.calls.push({
    deliveries: deliveries.map(function (d) { return { id: d.id, clientId: d.clientId }; }),
    name: name,
    items: JSON.parse(JSON.stringify(items)),
    source: source
  });
  if (box.holds && box.holds.length) {
    const slot = box.holds.shift();
    await slot.promise;
    if (slot.fail) throw new Error('Failed to fetch');
  }
  if (box.mode === 'slow') {
    const wait = box.wait;
    box.mode = 'ok';
    box.wait = null;
    await wait;
  }
  if (box.mode === 'fail') {
    box.mode = 'ok';
    throw new Error('Failed to fetch');
  }
  if (box.failAfter != null) {
    if (box.failAfter > 0) box.failAfter -= 1;
    else {
      box.failAfter = null;
      throw new Error('Failed to fetch');
    }
  }
  deliveries.forEach(function (d) {
    const existing = box.copies.filter(function (c) { return c.id === d.id; })[0];
    if (existing) {
      if (existing.ownerId !== d.clientId || existing.trainerId !== T) throw new Error('Could not send that workout.');
      return;
    }
    box.copies.push({
      id: d.id,
      ownerId: d.clientId,
      trainerId: T,
      name: name,
      items: JSON.parse(JSON.stringify(items)),
      sourceWorkoutId: source || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });
  return { name: name, count: deliveries.length };
}
function copiesFor(ownerId) {
  return box.copies.filter(function (c) { return c.ownerId === ownerId; }).map(shape);
}
async function handleSave(who, id, name, items) {
  box.saves.push({ id: id, name: name });
  if (box.saveMode === 'fail') throw new Error('Could not save that copy');
  if (who.membership !== 'enthusiast' && who.intended !== 'enthusiast') {
    throw new Error('Only an Enthusiast can edit a workout from a trainer.');
  }
  const row = box.copies.filter(function (c) { return c.id === id && c.ownerId === who.id; })[0];
  if (!row) throw new Error('That copy was not found.');
  row.name = name;
  row.items = JSON.parse(JSON.stringify(items));
  row.updatedAt = new Date().toISOString();
  return { id: row.id, name: row.name, updatedAt: row.updatedAt };
}

function install(page, who, opts) {
  opts = opts || {};
  return Promise.all([
    page.exposeFunction('__wbSend', handleSend),
    page.exposeFunction('__wbCopies', function (ownerId) { return copiesFor(ownerId); }),
    page.exposeFunction('__wbSave', function (id, name, items) { return handleSave(who, id, name, items); }),
    page.exposeFunction('__wbProfile', function () {
      if (box.profileDown) throw new Error('offline');
      return { id: E, email: 'hempled@gmail.com', membership: 'enthusiast', intended_plan: 'enthusiast' };
    }),
    page.evaluateOnNewDocument(function (who, opts) {
      var stub = {
        session: function () { return Promise.resolve({ user: { id: who.id, email: who.email } }); },
        profile: function () {
          if (opts.uncertainProfile) return window.__wbProfile();
          return Promise.resolve({ id: who.id, email: who.email, membership: who.membership, intended_plan: who.intended || null });
        },
        signOut: function () { return Promise.resolve(); },
        saveIntended: function () { return stub.profile(); },
        myConnection: function () {
          if (who.membership === 'trainer' || who.membership === 'master_trainer') return Promise.resolve(null);
          return Promise.resolve({ trainerId: '11111111-1111-4111-8111-111111111111', trainerEmail: 'kinisiathletics@gmail.com' });
        },
        roster: function () {
          if (who.membership !== 'trainer' && who.membership !== 'master_trainer') return Promise.resolve({ role: null });
          return Promise.resolve({
            role: 'trainer', cap: 15, clientCount: 2, canCreate: true, invites: [],
            clients: [
              { id: '33333333-3333-4333-8333-333333333333', email: 'hempled@gmail.com', plan: 'Enthusiast' },
              { id: '22222222-2222-4222-8222-222222222222', email: 'ada@example.com', plan: 'Free Client' }
            ]
          });
        },
        createInvite: function () { return Promise.resolve({ code: 'ABCD2345' }); },
        cancelInvite: function () { return Promise.resolve({}); },
        redeemInvite: function () { return Promise.resolve({ message: 'You are connected.' }); },
        endConnection: function () { return Promise.resolve({ message: 'Connection ended.' }); },
        threads: function () { return Promise.resolve({ role: 'client', threads: [] }); },
        messages: function () { return Promise.resolve({ person: null, messages: [] }); },
        sendMessage: function () { return Promise.resolve({}); },
        markRead: function () { return Promise.resolve({ ok: true }); },
        watchMessages: function () { return Promise.resolve(function () {}); },
        workoutCopies: function () {
          if (opts.unavailable) return Promise.reject(new Error('Sending workouts is not available yet. Apply the workout SQL in the Supabase SQL editor.'));
          return window.__wbCopies(who.id);
        },
        sendWorkout: function (deliveries, name, items, source) {
          if (opts.unavailable) return Promise.reject(new Error('Sending workouts is not available yet. Apply the workout SQL in the Supabase SQL editor.'));
          return window.__wbSend(deliveries, name, items, source);
        },
        saveWorkoutCopy: function (id, name, items) { return window.__wbSave(id, name, items); },
        deleteWorkoutCopy: function () { return Promise.resolve({ id: 'x' }); }
      };
      Object.defineProperty(window, 'WBAuth', {
        configurable: true, enumerable: true,
        get: function () { return stub; },
        set: function () {}
      });
    }, who, opts)
  ]);
}

function localCopy(id, name) {
  const data = M.emptyData();
  const at = Date.parse('2026-06-01T00:00:00.000Z');
  data.workouts = [{
    id: id, name: name, items: [],
    sourceTrainerId: T, sourceTrainerEmail: 'kinisiathletics@gmail.com', sourceWorkoutId: 'wo_friday',
    createdAt: at, updatedAt: at
  }];
  return JSON.stringify(data);
}
function serverRow(id, ownerId, name) {
  return {
    id: id, ownerId: ownerId, trainerId: T, name: name, items: [], sourceWorkoutId: 'wo_friday',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z'
  };
}

function seed(page, raw) {
  return page.evaluateOnNewDocument(function (raw) {
    try { localStorage.setItem('wb.data.v1', raw); } catch (e) {}
  }, raw);
}

function armHold() {
  var slot = { fail: false };
  slot.promise = new Promise(function (resolve) { slot.release = function () { resolve(); }; });
  return slot;
}

function armSlow() {
  box.mode = 'slow';
  var release;
  box.wait = new Promise(function (resolve) { release = resolve; });
  return release;
}

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  const friday = workout();

  const trainerCtx = await browser.createBrowserContext();
  const trainer = await trainerCtx.newPage();
  trainer.on('pageerror', function (e) { errs.push('trainer ' + e); });
  await trainer.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await install(trainer, { id: T, email: 'kinisiathletics@gmail.com', membership: 'trainer' });
  const saturday = M.newWorkout('Saturday easy');
  saturday.id = 'wo_sat';
  await seed(trainer, dataWith([friday, saturday]));
  await trainer.goto(URL + '#/send');
  await trainer.waitForSelector('[data-pick-client="' + E + '"]');
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    return btn && btn.disabled && btn.textContent === 'Send 0 workouts to 0 clients';
  });
  await trainer.click('[data-pick-workout="wo_friday"]');
  await trainer.click('[data-pick-client="' + E + '"]');
  await trainer.click('[data-pick-client="' + C + '"]');
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    return btn && !btn.disabled && btn.textContent === 'Send 1 workout to 2 clients';
  });
  const mark = await trainer.$eval('[data-pick-workout="wo_friday"].on .mark', function (el) {
    var s = getComputedStyle(el);
    return { radius: s.borderRadius, bg: s.backgroundColor };
  });
  assert.strictEqual(mark.radius, '6px');
  assert.strictEqual(mark.bg, 'rgb(37, 99, 235)');
  const intro = await trainer.evaluate(function () { return document.body.innerText; });
  assert.ok(intro.indexOf('Pick one or more of your workouts and the clients who should get a copy. A linked Enthusiast counts as a client.') !== -1);
  assert.ok(intro.indexOf('Each person gets their own copy. An Enthusiast can edit it. A Free Client can run it. Your workout stays as it is.') !== -1);
  assert.strictEqual(await trainer.$eval('.sec', function (el) { return el.textContent; }), 'Workouts');
  await trainer.screenshot({ path: ART + '/trainer-send-workout.png', fullPage: true });

  await trainer.evaluate(function () { window.__wbVisit = 1; location.hash = '#/send/wo_sat'; });
  await trainer.waitForFunction(function () {
    var sat = document.querySelector('[data-pick-workout="wo_sat"]');
    var fri = document.querySelector('[data-pick-workout="wo_friday"]');
    return window.__wbVisit === 1 && sat && sat.classList.contains('on') && fri && !fri.classList.contains('on');
  });
  await trainer.evaluate(function () { location.hash = '#/'; });
  await trainer.waitForSelector('[data-a=new]');
  assert.strictEqual(await trainer.evaluate(function () { return window.__wbVisit; }), 1);
  await trainer.evaluate(function () { location.hash = '#/send'; });
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    var fri = document.querySelector('[data-pick-workout="wo_friday"]');
    var sat = document.querySelector('[data-pick-workout="wo_sat"]');
    return window.__wbVisit === 1 && btn && btn.textContent !== 'Sent' && !btn.disabled === false &&
      fri && !fri.classList.contains('on') && sat && !sat.classList.contains('on');
  });
  await trainer.click('[data-pick-workout="wo_friday"]');
  await trainer.click('[data-pick-client="' + E + '"]');
  await trainer.click('[data-pick-client="' + C + '"]');
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    return btn && !btn.disabled && btn.textContent === 'Send 1 workout to 2 clients';
  });

  const release = armSlow();
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () { return document.getElementById('send-go').disabled; });
  await trainer.click('[data-pick-client="' + C + '"]');
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    return btn && !btn.disabled && btn.textContent === 'Send 1 workout to 1 client';
  });
  assert.strictEqual(box.calls.length, 1);
  assert.deepStrictEqual(box.calls[0].deliveries.map(function (d) { return d.clientId; }).sort(), [C, E].sort());
  assert.strictEqual(await trainer.$('#sent-note'), null);
  const slowIds = box.calls[0].deliveries.map(function (d) { return d.id; });
  release();
  const slowDeadline = Date.now() + 4000;
  while (box.copies.length < 2 && Date.now() < slowDeadline) await new Promise(function (r) { setTimeout(r, 30); });
  assert.strictEqual(box.copies.length, 2);
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    return btn && !btn.disabled && btn.textContent === 'Send 1 workout to 1 client' && !document.getElementById('sent-note');
  });
  assert.deepStrictEqual(box.copies.map(function (c) { return c.id; }).sort(), slowIds.slice().sort());
  assert.ok((await trainer.evaluate(function () { return document.getElementById('toast').textContent; })).indexOf('Could not send') === -1);

  await trainer.click('[data-pick-client="' + C + '"]');
  await trainer.waitForFunction(function () { return document.getElementById('send-go').textContent === 'Send 1 workout to 2 clients' && !document.getElementById('send-go').disabled; });
  const beforeSecond = box.calls.length;
  const liveBox = await trainer.$eval('#send-go', function (el) {
    var s = getComputedStyle(el);
    return { h: s.height, font: s.fontSize, w: el.getBoundingClientRect().width };
  });
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    return btn && btn.disabled && btn.textContent === 'Sent' && btn.className.indexOf('pri') === -1 && !document.getElementById('sent-note');
  });
  const sentBox = await trainer.$eval('#send-go', function (el) {
    var s = getComputedStyle(el);
    return { h: s.height, font: s.fontSize, text: el.textContent, w: el.getBoundingClientRect().width };
  });
  assert.strictEqual(sentBox.text, 'Sent');
  assert.strictEqual(sentBox.h, '48px');
  assert.strictEqual(sentBox.font, '16px');
  assert.strictEqual(sentBox.h, liveBox.h);
  assert.strictEqual(sentBox.font, liveBox.font);
  assert.strictEqual(sentBox.w, liveBox.w);
  assert.strictEqual(box.calls.length, beforeSecond + 1);
  const secondIds = box.calls[beforeSecond].deliveries.map(function (d) { return d.id; });
  secondIds.forEach(function (id) { assert.strictEqual(slowIds.indexOf(id), -1); });
  assert.strictEqual(box.copies.length, 4);
  await trainer.screenshot({ path: ART + '/trainer-send-confirmation.png', fullPage: true });

  const stored = JSON.stringify(box.copies[0].items);
  await trainer.evaluate(function () {
    var data = JSON.parse(localStorage.getItem('wb.data.v1'));
    data.workouts[0].name = 'Changed later';
    data.workouts[0].items[0].name = 'Changed later';
    localStorage.setItem('wb.data.v1', JSON.stringify(data));
  });
  assert.strictEqual(JSON.stringify(box.copies[0].items), stored);
  assert.ok(box.copies.every(function (c) { return c.items[0].name === 'Squat' && c.name === 'Friday full body'; }));

  await trainer.click('[data-pick-client="' + E + '"]');
  await trainer.waitForFunction(function () { return document.getElementById('send-go').textContent === 'Send 1 workout to 1 client' && !document.getElementById('send-go').disabled; });
  box.mode = 'fail';
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    var err = document.getElementById('send-fail');
    return btn && !btn.disabled && btn.textContent === 'Send 1 workout to 1 client' && err && err.textContent.indexOf('Failed to fetch') !== -1;
  });
  const failed = box.calls[box.calls.length - 1];
  assert.strictEqual(failed.deliveries.length, 1);
  assert.strictEqual(failed.deliveries[0].clientId, C);
  assert.strictEqual(box.copies.filter(function (c) { return c.id === failed.deliveries[0].id; }).length, 0);
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    return btn && btn.disabled && btn.textContent === 'Sent' && !document.getElementById('sent-note');
  });
  assert.strictEqual(box.calls[box.calls.length - 1].deliveries[0].id, failed.deliveries[0].id);
  assert.strictEqual(box.copies.filter(function (c) { return c.id === failed.deliveries[0].id; }).length, 1);
  const retriedCount = box.copies.length;
  await trainer.click('[data-pick-client="' + E + '"]');
  await trainer.click('[data-pick-client="' + E + '"]');
  await trainer.waitForFunction(function () { return document.getElementById('send-go').textContent === 'Send 1 workout to 1 client' && !document.getElementById('send-go').disabled; });
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () { return document.getElementById('send-go') && document.getElementById('send-go').textContent === 'Sent'; });
  assert.ok(box.copies.length > retriedCount);
  assert.notStrictEqual(box.calls[box.calls.length - 1].deliveries[0].id, failed.deliveries[0].id);

  await trainer.click('[data-pick-client="' + E + '"]');
  await trainer.waitForFunction(function () { return document.getElementById('send-go').textContent === 'Send 1 workout to 2 clients' && !document.getElementById('send-go').disabled; });
  const releaseNav = armSlow();
  await trainer.click('#send-go');
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () { return document.getElementById('send-go').disabled; });
  assert.strictEqual(box.calls.filter(function (call) { return call.name === 'Friday full body'; }).length > 0, true);
  await trainer.goto(URL + '#/');
  await trainer.waitForSelector('[data-a=new]');
  assert.strictEqual(await trainer.$('#received-open'), null);
  releaseNav();
  await new Promise(function (r) { setTimeout(r, 500); });
  await trainer.goto(URL + '?preset=1#/send/wo_sat');
  await trainer.waitForFunction(function () {
    var sat = document.querySelector('[data-pick-workout="wo_sat"]');
    var friday = document.querySelector('[data-pick-workout="wo_friday"]');
    return sat && sat.className.indexOf('on') !== -1 && friday && friday.className.indexOf('on') === -1;
  });
  await trainer.click('[data-pick-workout="wo_friday"]');
  await trainer.click('[data-pick-client="' + C + '"]');
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    return btn && !btn.disabled && btn.textContent === 'Send 2 workouts to 1 client';
  });
  const beforeMulti = box.copies.length;
  const callsBeforePartial = box.calls.length;
  box.failAfter = 1;
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    var err = document.getElementById('send-fail');
    return btn && !btn.disabled && btn.textContent === 'Send 2 workouts to 1 client' && err &&
      err.textContent === 'Sent 1 workout. Could not send Saturday easy.' && err.textContent.indexOf('@') === -1;
  });
  assert.strictEqual(box.copies.length, beforeMulti + 1);
  assert.strictEqual(box.calls.length, callsBeforePartial + 2);
  const partialId = box.copies[box.copies.length - 1].id;
  const failedCall = box.calls[box.calls.length - 1];
  assert.strictEqual(failedCall.name, 'Saturday easy');
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () { return document.getElementById('send-go').textContent === 'Sent'; });
  assert.strictEqual(box.calls.length, callsBeforePartial + 3);
  assert.strictEqual(box.calls[box.calls.length - 1].name, 'Saturday easy');
  assert.strictEqual(box.calls[box.calls.length - 1].deliveries[0].id, failedCall.deliveries[0].id);
  assert.strictEqual(box.copies.filter(function (c) { return c.id === partialId; }).length, 1);
  assert.strictEqual(box.copies.length, beforeMulti + 2);
  assert.strictEqual(await trainer.$('#sent-note'), null);

  await trainer.click('[data-pick-client="' + E + '"]');
  await trainer.waitForFunction(function () {
    return document.getElementById('send-go').textContent === 'Send 2 workouts to 2 clients' && !document.getElementById('send-go').disabled;
  });
  const releaseOverlap = armSlow();
  const satBefore = box.copies.filter(function (c) { return c.name === 'Saturday easy'; }).length;
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () { return document.getElementById('send-go').disabled; });
  await trainer.click('[data-pick-workout="wo_sat"]');
  await trainer.waitForFunction(function () {
    return document.getElementById('send-go').textContent === 'Send 1 workout to 2 clients' && !document.getElementById('send-go').disabled;
  });
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () { return document.getElementById('send-go').textContent === 'Sent'; });
  releaseOverlap();
  const overlapDeadline = Date.now() + 4000;
  while (box.copies.filter(function (c) { return c.name === 'Saturday easy'; }).length < satBefore + 2 && Date.now() < overlapDeadline) {
    await new Promise(function (r) { setTimeout(r, 30); });
  }
  assert.strictEqual(box.copies.filter(function (c) { return c.name === 'Saturday easy'; }).length, satBefore + 2);
  assert.strictEqual(box.copies.filter(function (c) { return c.name === 'Saturday easy' && c.ownerId === E; }).length, 1);

  await trainer.goto(URL + '?ids=1#/send');
  await trainer.waitForSelector('[data-pick-workout="wo_friday"]');
  await trainer.click('[data-pick-workout="wo_friday"]');
  await trainer.click('[data-pick-workout="wo_sat"]');
  await trainer.click('[data-pick-client="' + C + '"]');
  await trainer.waitForFunction(function () {
    return document.getElementById('send-go').textContent === 'Send 2 workouts to 1 client' && !document.getElementById('send-go').disabled;
  });
  const satHold = armHold();
  box.holds = [{ promise: Promise.resolve(), fail: false }, satHold];
  const fridayBefore = box.copies.filter(function (c) { return c.name === 'Friday full body' && c.ownerId === C; }).length;
  await trainer.click('#send-go');
  const heldDeadline = Date.now() + 4000;
  while (box.calls.filter(function (call) { return call.name === 'Saturday easy'; }).length < 1 && Date.now() < heldDeadline) {
    await new Promise(function (r) { setTimeout(r, 30); });
  }
  const sharedFridayId = box.calls.filter(function (call) { return call.name === 'Friday full body'; }).pop().deliveries[0].id;
  await trainer.click('[data-pick-workout="wo_sat"]');
  await trainer.waitForFunction(function () {
    return document.getElementById('send-go').textContent === 'Send 1 workout to 1 client' && !document.getElementById('send-go').disabled;
  });
  const friHold = armHold();
  box.holds = [friHold];
  await trainer.click('#send-go');
  const friDeadline = Date.now() + 4000;
  while (box.calls[box.calls.length - 1].name !== 'Friday full body' && Date.now() < friDeadline) {
    await new Promise(function (r) { setTimeout(r, 30); });
  }
  satHold.release();
  const satDeadline = Date.now() + 4000;
  while (!box.copies.some(function (c) { return c.name === 'Saturday easy' && c.ownerId === C && box.calls.some(function (call) { return call.deliveries[0] && call.deliveries[0].id === c.id && call.name === 'Saturday easy'; }); }) && Date.now() < satDeadline) {
    await new Promise(function (r) { setTimeout(r, 30); });
  }
  friHold.fail = true;
  friHold.release();
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    var err = document.getElementById('send-fail');
    return btn && !btn.disabled && btn.textContent === 'Send 1 workout to 1 client' && err && err.textContent.indexOf('Failed to fetch') !== -1;
  });
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () { return document.getElementById('send-go').textContent === 'Sent'; });
  assert.strictEqual(box.calls[box.calls.length - 1].deliveries[0].id, sharedFridayId);
  assert.strictEqual(box.copies.filter(function (c) { return c.name === 'Friday full body' && c.ownerId === C; }).length, fridayBefore + 1);
  box.holds = [];

  await trainer.goto(URL + '?stale=1#/send');
  await trainer.waitForSelector('[data-pick-workout="wo_friday"]');
  await trainer.click('[data-pick-workout="wo_friday"]');
  await trainer.click('[data-pick-workout="wo_sat"]');
  await trainer.click('[data-pick-client="' + C + '"]');
  await trainer.waitForFunction(function () {
    return document.getElementById('send-go').textContent === 'Send 2 workouts to 1 client' && !document.getElementById('send-go').disabled;
  });
  const staleHold = armHold();
  box.holds = [{ promise: Promise.resolve(), fail: false }, staleHold];
  await trainer.click('#send-go');
  const staleCalls = box.calls.filter(function (call) { return call.name === 'Saturday easy'; }).length;
  const staleDeadline = Date.now() + 4000;
  while (box.calls.filter(function (call) { return call.name === 'Saturday easy'; }).length < staleCalls + 1 && Date.now() < staleDeadline) {
    await new Promise(function (r) { setTimeout(r, 30); });
  }
  await trainer.click('[data-pick-workout="wo_sat"]');
  await trainer.waitForFunction(function () {
    return document.getElementById('send-go').textContent === 'Send 1 workout to 1 client' && !document.getElementById('send-go').disabled;
  });
  box.holds = [];
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () { return document.getElementById('send-go').textContent === 'Sent'; });
  await trainer.click('[data-pick-workout="wo_sat"]');
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    return btn && btn.disabled && btn.textContent === 'Send 2 workouts to 1 client';
  });
  staleHold.release();
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    return btn && btn.disabled && btn.textContent === 'Sent' && btn.className.indexOf('pri') === -1;
  });
  box.holds = [];

  await trainer.evaluate(function () { window.__wbVisit = 2; location.hash = '#/'; });
  await trainer.waitForSelector('[data-a=new]');
  assert.strictEqual(await trainer.evaluate(function () { return window.__wbVisit; }), 2);
  await trainer.evaluate(function () { location.hash = '#/send'; });
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    var picked = document.querySelector('.pick.on');
    return window.__wbVisit === 2 && btn && btn.textContent === 'Send 0 workouts to 0 clients' && !picked;
  });

  await trainer.click('[data-pick-workout="wo_friday"]');
  await trainer.click('[data-pick-workout="wo_sat"]');
  await trainer.click('[data-pick-client="' + C + '"]');
  await trainer.waitForFunction(function () {
    return document.getElementById('send-go').textContent === 'Send 2 workouts to 1 client' && !document.getElementById('send-go').disabled;
  });
  const countHold = armHold();
  const callsAtCount = box.calls.length;
  box.holds = [countHold];
  await trainer.click('#send-go');
  const countDeadline = Date.now() + 4000;
  while (box.calls.length < callsAtCount + 1 && Date.now() < countDeadline) await new Promise(function (r) { setTimeout(r, 30); });
  await trainer.click('[data-pick-workout="wo_sat"]');
  await trainer.waitForFunction(function () {
    return document.getElementById('send-go').textContent === 'Send 1 workout to 1 client' && !document.getElementById('send-go').disabled;
  });
  box.failAfter = 1;
  countHold.release();
  const countDone = Date.now() + 4000;
  while (box.calls.length < callsAtCount + 2 && Date.now() < countDone) await new Promise(function (r) { setTimeout(r, 30); });
  await trainer.waitForFunction(function () {
    var btn = document.getElementById('send-go');
    return btn && !btn.disabled && btn.textContent === 'Send 1 workout to 1 client';
  });
  box.mode = 'fail';
  await trainer.click('#send-go');
  await trainer.waitForFunction(function () {
    var err = document.getElementById('send-fail');
    var btn = document.getElementById('send-go');
    return err && err.textContent.indexOf('Failed to fetch') !== -1 && err.textContent.indexOf('Sent 1 workout') === -1 &&
      btn && !btn.disabled && btn.textContent === 'Send 1 workout to 1 client';
  });
  box.holds = [];

  await trainer.click('[data-pick-workout="wo_sat"]');
  await trainer.waitForFunction(function () {
    return document.getElementById('send-go').textContent === 'Send 2 workouts to 1 client' && !document.getElementById('send-go').disabled;
  });
  const midHold = armHold();
  const callsAtMid = box.calls.length;
  box.holds = [{ promise: Promise.resolve(), fail: false }, midHold];
  await trainer.click('#send-go');
  const midDeadline = Date.now() + 4000;
  while (box.calls.length < callsAtMid + 2 && Date.now() < midDeadline) await new Promise(function (r) { setTimeout(r, 30); });
  await trainer.click('[data-pick-client="' + E + '"]');
  await trainer.click('[data-pick-client="' + E + '"]');
  midHold.fail = true;
  midHold.release();
  await trainer.waitForFunction(function () {
    var err = document.getElementById('send-fail');
    return err && err.textContent === 'Sent 1 workout. Could not send Saturday easy.';
  });
  box.holds = [];

  const cleanItems = JSON.parse(JSON.stringify(box.copies[0].items));
  box.copies = [
    { id: COPY, ownerId: E, trainerId: T, name: 'Friday full body', items: cleanItems, sourceWorkoutId: 'wo_friday', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ownerId: C, trainerId: T, name: 'Friday full body', items: JSON.parse(JSON.stringify(cleanItems)), sourceWorkoutId: 'wo_friday', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  ];

  const enthusiastCtx = await browser.createBrowserContext();
  const enthusiast = await enthusiastCtx.newPage();
  enthusiast.on('pageerror', function (e) { errs.push('enthusiast ' + e); });
  enthusiast.on('dialog', function (d) { errs.push('dialog ' + d.message()); d.dismiss(); });
  await enthusiast.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await install(enthusiast, { id: E, email: 'hempled@gmail.com', membership: 'enthusiast', intended: 'enthusiast' });
  await seed(enthusiast, dataWith([ownWorkout()]));
  await enthusiast.goto(URL + '#/send');
  await enthusiast.waitForFunction(function () {
    return !document.getElementById('send-go') && (document.getElementById('level-note') || document.getElementById('send-locked'));
  });
  await enthusiast.goto(URL + '#/');
  await enthusiast.waitForFunction(function () {
    return document.body.innerText.indexOf('From Trainer') === -1 &&
      document.body.innerText.indexOf('Friday full body') !== -1 &&
      document.body.innerText.indexOf('kinisiathletics@gmail.com') === -1 &&
      document.body.innerText.indexOf('You can edit it') !== -1 &&
      document.body.innerText.indexOf('Saturday easy') !== -1;
  });
  const copyId = box.copies.filter(function (c) { return c.ownerId === E; })[0].id;
  assert.strictEqual(await enthusiast.$('[data-a=rename]'), null);
  assert.ok(await enthusiast.$('[data-a=del][data-id="' + copyId + '"]'));
  assert.strictEqual(await enthusiast.$('#received-open'), null);
  assert.strictEqual(await enthusiast.$eval('#workouts-nav .request-count', function (el) { return el.textContent; }), '1');
  assert.ok((await enthusiast.$eval('#app', function (el) { return el.innerText; })).indexOf('Workouts from your trainer') === -1);
  await enthusiast.screenshot({ path: ART + '/enthusiast-received-list.png', fullPage: true });
  await enthusiast.click('[data-a=open][data-id="' + copyId + '"]');
  await enthusiast.waitForSelector('#copy-note');
  assert.ok((await enthusiast.evaluate(function () { return document.getElementById('copy-note').textContent; })).indexOf('do not change their workout') !== -1);
  assert.ok(await enthusiast.$('[data-a=add], [data-a=edit]'));
  await enthusiast.waitForSelector('#wo-name');
  await enthusiast.click('#wo-name');
  await enthusiast.waitForSelector('#wo-name-input');
  await enthusiast.evaluate(function () {
    var input = document.getElementById('wo-name-input');
    input.value = 'Friday edited';
    input.blur();
  });
  await enthusiast.waitForFunction(function () { return document.body.innerText.indexOf('Friday edited') !== -1; });
  const saveDeadline = Date.now() + 3000;
  while (!box.saves.some(function (s) { return s.id === copyId && s.name === 'Friday edited'; }) && Date.now() < saveDeadline) {
    await new Promise(function (r) { setTimeout(r, 50); });
  }
  assert.ok(box.saves.some(function (s) { return s.id === copyId && s.name === 'Friday edited'; }));

  const clientCtx = await browser.createBrowserContext();
  const client = await clientCtx.newPage();
  client.on('pageerror', function (e) { errs.push('client ' + e); });
  await client.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await install(client, { id: C, email: 'ada@example.com', membership: 'free_client' });
  await client.goto(URL + '#/subscriptions');
  await client.waitForSelector('#workouts-nav');
  assert.strictEqual(await client.$('[data-a=new], [data-a=run], .pl-screen'), null);
  await client.goto(URL + '#/');
  await client.waitForFunction(function () {
    return document.body.innerText.indexOf('From Trainer') === -1 &&
      document.body.innerText.indexOf('Friday full body') !== -1 &&
      document.body.innerText.indexOf('@') === -1 &&
      document.body.innerText.indexOf('You can run it') !== -1 &&
      document.body.innerText.indexOf('You can edit it') === -1;
  });
  const clientCopy = box.copies.filter(function (c) { return c.ownerId === C && c.name === 'Friday full body'; })[0];
  assert.ok(clientCopy);
  assert.strictEqual(await client.$('[data-a=rename], [data-a=del]'), null);
  await client.screenshot({ path: ART + '/free-client-received-list.png', fullPage: true });
  await client.click('[data-a=open][data-id="' + clientCopy.id + '"]');
  await client.waitForSelector('#copy-run');
  assert.ok((await client.evaluate(function () { return document.getElementById('copy-note').textContent; })).indexOf('Only an Enthusiast can edit it') !== -1);
  assert.strictEqual(await client.$('[data-a=edit], [data-a=add], [data-b=name]'), null);
  const blocked = await client.evaluate(function () {
    return window.WBAuth.saveWorkoutCopy('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Hack', []).then(function () { return 'saved'; }, function (err) { return err.message; });
  });
  assert.ok(blocked.indexOf('Only an Enthusiast') !== -1);

  const closedCtx = await browser.createBrowserContext();
  const closed = await closedCtx.newPage();
  closed.on('pageerror', function (e) { errs.push('closed ' + e); });
  await closed.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await install(closed, { id: T, email: 'kinisiathletics@gmail.com', membership: 'trainer' }, { unavailable: true });
  await closed.goto(URL + '#/');
  await closed.waitForSelector('[data-a=new]');
  await closed.goto(URL + '#/send');
  await closed.waitForFunction(function () { return document.body.innerText.indexOf('Not available yet') !== -1; });
  assert.ok(await closed.$('#feature-wait'));
  await closed.goto(URL + '#/');
  await closed.waitForSelector('[data-a=new]');
  assert.ok((await closed.evaluate(function () { return document.body.innerText; })).indexOf('New workout') !== -1);

  const LOCAL = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  box.copies = [serverRow(LOCAL, E, 'Server copy')];
  box.profileDown = true;
  const unknownCtx = await browser.createBrowserContext();
  const unknown = await unknownCtx.newPage();
  unknown.on('pageerror', function (e) { errs.push('unknown ' + e); });
  await unknown.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await install(unknown, { id: E, email: 'hempled@gmail.com', membership: 'enthusiast', intended: 'enthusiast' }, { uncertainProfile: true });
  await seed(unknown, localCopy(LOCAL, 'Local edit'));
  await unknown.goto(URL + '#/');
  await unknown.waitForFunction(function () {
    return location.hash === '#/subscriptions' && document.getElementById('level-lock') && document.getElementById('back').hidden && document.getElementById('nav-links').hidden;
  });
  assert.ok((await unknown.evaluate(function () { return localStorage.getItem('wb.data.v1'); })).indexOf('Local edit') !== -1);
  box.profileDown = false;
  await unknown.evaluate(function () { location.hash = '#/'; });
  await unknown.waitForFunction(function () {
    var text = document.body.innerText;
    return text.indexOf('Local edit') !== -1 && text.indexOf('You can edit it') !== -1 && text.indexOf('Server copy') === -1;
  });

  const PENDING = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
  box.copies = [serverRow(PENDING, E, 'Server name')];
  box.saveMode = 'fail';
  box.saves = [];
  const pendingCtx = await browser.createBrowserContext();
  const pending = await pendingCtx.newPage();
  pending.on('pageerror', function (e) { errs.push('pending ' + e); });
  await pending.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await install(pending, { id: E, email: 'hempled@gmail.com', membership: 'enthusiast', intended: 'enthusiast' });
  await seed(pending, localCopy(PENDING, 'Pending edit'));
  await pending.goto(URL + '#/');
  await pending.waitForFunction(function () {
    var text = document.body.innerText;
    return text.indexOf('Pending edit') !== -1 && text.indexOf('You can edit it') !== -1 && text.indexOf('Server name') === -1;
  });
  const pendingDeadline = Date.now() + 4000;
  while (!box.saves.length && Date.now() < pendingDeadline) await new Promise(function (r) { setTimeout(r, 30); });
  assert.ok(box.saves.length >= 1);
  assert.ok(box.saves.every(function (s) { return s.id === PENDING && s.name === 'Pending edit'; }));
  const beforeRetry = box.saves.length;
  await pending.click('[data-a=open]');
  await pending.waitForSelector('#copy-note');
  await pending.click('#back');
  await pending.waitForFunction(function () {
    var text = document.body.innerText;
    return text.indexOf('Pending edit') !== -1 && text.indexOf('Server name') === -1;
  });
  const retryDeadline = Date.now() + 4000;
  while (box.saves.length <= beforeRetry && Date.now() < retryDeadline) await new Promise(function (r) { setTimeout(r, 30); });
  assert.ok(box.saves.length > beforeRetry);
  assert.ok(box.saves.every(function (s) { return s.id === PENDING && s.name === 'Pending edit'; }));
  box.saveMode = 'ok';

  assert.deepStrictEqual(errs, []);
  console.log('SENDS UI OK');
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
