// Unscheduled workouts: grey name, blue check, original day left open, reschedule note.
// node tests/programs-unscheduled.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';

const TRAINER = 'trainer-1';
const MIA = 'fc-mia';
const OWEN = 'en-owen';
const JOY = '22222222-2222-4222-8222-222222222222';

function workout(name) {
  const w = M.newWorkout(name);
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Press', sets: 1, weight: { unit: 'lb', value: 20 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
  }))];
  return w;
}

function entry(id, ownerId, wo, start, end, presence, when) {
  return {
    id: id, ownerId: ownerId, workoutId: wo.id, workoutName: wo.name,
    items: wo.items, date: when, presence: presence, start: start, end: end, updatedAt: 1
  };
}

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  const desktop = { width: 1400, height: 1000, deviceScaleFactor: 1 };
  const morning = workout('Morning lift');
  const extra = workout('Evening extra');
  const miaWo = workout('Mia legs');
  const owenWo = workout('Owen secret');
  const open = workout('Open gym');

  const roster = {
    role: 'trainer',
    clients: [
      { id: MIA, display_name: 'Mia Chen', name: 'Mia Chen', plan: 'Free Client', membership: 'free_client' },
      { id: OWEN, display_name: 'Owen Blake', name: 'Owen Blake', plan: 'Enthusiast', membership: 'enthusiast' }
    ]
  };
  const status = {
    [MIA]: { shared: false, enthusiast: false, linked: true, plan: 'Free Client' },
    [OWEN]: { shared: false, enthusiast: true, linked: true, plan: 'Enthusiast' }
  };
  const dbSessions = [
    {
      id: 'srv-mia', client_id: MIA, local_id: 'ses-mia', workout_id: miaWo.id, workout_name: 'Mia legs',
      program_id: 'pg-mia', local_date: 'TODAY', started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
      status: 'completed'
    },
    {
      id: 'srv-owen', client_id: OWEN, local_id: 'ses-owen', workout_id: owenWo.id, workout_name: 'Owen secret',
      program_id: 'pg-owen', local_date: 'TODAY', status: 'completed'
    }
  ];

  async function stub(page, profile, session, pack) {
    await require('./allow.js').stubAuth(page, { profile: profile, session: session });
    await page.evaluateOnNewDocument(function (pack) {
      window.__wbSessionCalls = [];
      var desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
      if (!desc || !desc.set) return;
      var prev = desc.set;
      function today() {
        var now = new Date();
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      }
      Object.defineProperty(window, 'WBAuth', {
        configurable: true,
        enumerable: true,
        get: desc.get,
        set: function (value) {
          prev(value);
          if (!value) return;
          value.shareSetting = function () { return Promise.resolve(pack.share); };
          value.roster = function () { return Promise.resolve(pack.roster); };
          value.clientStatus = function (id) { return Promise.resolve(pack.status[id] || { shared: false, enthusiast: false, linked: false }); };
          value.programEntries = function () { return Promise.resolve([]); };
          value.programEntriesFor = function () { return Promise.resolve([]); };
          value.saveProgramEntry = function () { return Promise.resolve(true); };
          value.deleteProgramEntry = function () { return Promise.resolve(true); };
          value.calendarSessions = function (ids) {
            var list = (ids || []).slice();
            window.__wbSessionCalls.push(list);
            var day = today();
            return Promise.resolve((pack.sessions || []).filter(function (row) {
              return list.indexOf(row.client_id) >= 0;
            }).map(function (row) {
              var copy = JSON.parse(JSON.stringify(row));
              copy.local_date = day;
              return copy;
            }));
          };
          value.myConnection = function () { return Promise.resolve(pack.connection || null); };
          value.threads = function () {
            return Promise.resolve({ threads: pack.threads || [], requests: [], role: 'enthusiast' });
          };
          value.messages = function (id) {
            return Promise.resolve({
              messages: [],
              person: { id: id, display_name: 'Alex Rivera', plan: 'Trainer' }
            });
          };
          value.markRead = function () { return Promise.resolve(); };
          value.watchMessages = function () { return Promise.resolve(function () {}); };
          value.sendMessage = function () { return Promise.resolve({ id: 'm1', body: '', at: new Date().toISOString(), mine: true }); };
          value.saveTrackedSession = function () { return Promise.resolve({ ok: true }); };
        }
      });
    }, pack);
  }

  async function boot(page, data) {
    await page.goto(URL + '#/', { waitUntil: 'domcontentloaded' });
    return page.evaluate(function (key, value) {
      var stored = JSON.parse(value);
      var now = new Date();
      var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      var ahead = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
      var future = ahead.getFullYear() + '-' + String(ahead.getMonth() + 1).padStart(2, '0') + '-' + String(ahead.getDate()).padStart(2, '0');
      (stored.programs || []).forEach(function (row) {
        if (row.date === 'TODAY') row.date = today;
        if (row.date === 'FUTURE') row.date = future;
      });
      (stored.sessions || []).forEach(function (row) {
        row.endedAt = Date.now();
        row.startedAt = Date.now() - 1000;
      });
      localStorage.setItem(key, JSON.stringify(stored));
      return future;
    }, M.STORAGE_KEY, JSON.stringify(data));
  }

  async function openPrograms(page) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#programs-open');
    await page.click('#programs-open');
    await page.waitForFunction(function () {
      var root = document.getElementById('pv-root');
      return root && !document.getElementById('pv-loading') && document.querySelector('.pv-day.today');
    });
  }

  function color(page, sel) {
    return page.$eval(sel, function (el) { return getComputedStyle(el).color; });
  }

  const trainerData = M.emptyData();
  trainerData.workouts.push(morning, extra, miaWo);
  trainerData.programs = [
    entry('pg-am', TRAINER, morning, '07:00', '08:00', 'solo', 'TODAY'),
    entry('pg-extra', TRAINER, extra, '18:00', '19:00', 'solo', 'FUTURE'),
    entry('pg-mia', MIA, miaWo, '09:00', '10:00', 'trainer', 'FUTURE')
  ];
  trainerData.sessions = [
    {
      id: 'ses-am', workoutId: morning.id, workoutName: 'Morning lift', programId: 'pg-am',
      startedAt: 1, endedAt: 2, results: [{ logged: true, name: 'Press' }]
    },
    {
      id: 'ses-extra', workoutId: extra.id, workoutName: 'Evening extra', programId: 'pg-extra',
      startedAt: 1, endedAt: 2, results: [{ logged: true, name: 'Press' }]
    }
  ];

  const trainer = await browser.newPage();
  trainer.on('pageerror', function (err) { errors.push('trainer ' + err); });
  await trainer.setViewport(desktop);
  await stub(trainer, {
    id: TRAINER, email: 'kinisiathletics@gmail.com', membership: 'trainer', intended_plan: 'trainer', display_name: 'Alex Rivera'
  }, { user: { id: TRAINER, email: 'kinisiathletics@gmail.com' } }, {
    roster: roster,
    status: status,
    share: { on: true, enthusiast: true, linked: true },
    sessions: dbSessions,
    connection: null
  });
  const future = await boot(trainer, trainerData);
  await openPrograms(trainer);
  await trainer.waitForFunction(function () {
    var today = document.querySelector('.pv-day.today');
    return today && today.textContent.indexOf('Self') !== -1 && today.textContent.indexOf('Mia Chen') !== -1 &&
      today.textContent.indexOf('Owen') === -1 && today.textContent.indexOf('Evening extra') === -1 && today.querySelector('.pv-session.is-extra');
  });

  const calls = await trainer.evaluate(function () { return window.__wbSessionCalls; });
  calls.forEach(function (ids) {
    assert.ok(ids.indexOf(MIA) >= 0 && ids.indexOf(TRAINER) >= 0);
    assert.strictEqual(ids.indexOf(OWEN), -1);
  });
  assert.strictEqual(await color(trainer, '.pv-day.today .pv-session.is-extra .pv-who'), 'rgb(107, 114, 128)');
  assert.strictEqual(await color(trainer, '.pv-day.today .pv-session:not(.is-extra) .pv-who'), 'rgb(17, 24, 39)');
  assert.strictEqual(await color(trainer, '.pv-day.today .pv-day-h .pv-check'), 'rgb(5, 150, 105)');
  const weekCards = await trainer.$$eval('.pv-day.today .pv-session', function (rows) {
    return rows.map(function (row) {
      var who = row.querySelector('.pv-who');
      var name = row.querySelector('.name');
      return {
        name: name ? name.textContent : '',
        who: who ? who.textContent : '',
        extra: row.classList.contains('is-extra'),
        drag: row.hasAttribute('data-drag')
      };
    });
  });
  assert.deepStrictEqual(weekCards, [
    { name: '', who: 'Self', extra: false, drag: true },
    { name: '', who: 'Self', extra: true, drag: false },
    { name: '', who: 'Mia Chen', extra: true, drag: false }
  ]);
  assert.ok((await trainer.$eval('.pv-legend', function (el) { return el.textContent; })).indexOf('Unscheduled') !== -1);
  await trainer.evaluate(function () {
    var day = document.querySelector('.pv-day.today');
    if (day) day.scrollIntoView({ inline: 'center', block: 'center' });
  });
  await trainer.screenshot({ path: path.join(ART, 'unscheduled_week.png') });

  await trainer.click('[data-cal=month]');
  await trainer.waitForSelector('.pv-cell.today .pv-ico');
  assert.strictEqual(await trainer.$$eval('.pv-cell.today .pv-ico', function (els) { return els.length; }), 3);
  assert.strictEqual(await trainer.$('.pv-cell.today .pv-uname'), null);
  assert.strictEqual(await trainer.$('.pv-cell.today .pv-names'), null);
  const monthText = await trainer.$eval('.pv-cell.today', function (el) { return el.textContent; });
  assert.strictEqual(monthText.indexOf('Evening extra'), -1);
  assert.strictEqual(monthText.indexOf('Mia'), -1);
  assert.ok((await trainer.$eval('.pv-cell.today', function (el) { return el.getAttribute('aria-label'); })).indexOf('not scheduled') !== -1);
  await trainer.evaluate(function () {
    var cell = document.querySelector('.pv-cell.today');
    if (cell) cell.scrollIntoView({ block: 'center' });
  });
  await trainer.screenshot({ path: path.join(ART, 'unscheduled_month.png') });

  await trainer.click('.pv-cell.today');
  await trainer.waitForSelector('#pv-day-sheet .pv-day-row.is-extra');
  const dayRows = await trainer.$$eval('#pv-day-sheet .pv-day-row', function (rows) {
    return rows.map(function (row) {
      var who = row.querySelector('.pv-row-client');
      var mark = row.querySelector('.pv-check');
      return {
        name: row.querySelector('.name').textContent,
        who: who ? who.textContent : '',
        extra: row.classList.contains('is-extra'),
        blue: !!(mark && mark.classList.contains('is-extra'))
      };
    });
  });
  assert.deepStrictEqual(dayRows, [
    { name: 'Morning lift', who: '', extra: false, blue: false },
    { name: 'Evening extra', who: '', extra: true, blue: true },
    { name: 'Mia legs', who: 'Mia', extra: true, blue: true }
  ]);
  assert.strictEqual(await color(trainer, '#pv-day-sheet .pv-day-row.is-extra .name'), 'rgb(107, 114, 128)');
  assert.strictEqual(await trainer.$eval('#pv-day-sheet .pv-day-row.is-extra', function (el) { return el.getAttribute('aria-label'); }), 'Evening extra, completed, not scheduled');
  await trainer.screenshot({ path: path.join(ART, 'unscheduled_day.png') });

  await trainer.click('#pv-day-sheet .pv-day-row.is-extra');
  await trainer.waitForSelector('#pv-day-sheet [data-view-wo]');
  const detail = await trainer.evaluate(function () {
    return {
      text: document.getElementById('pv-day-sheet').innerText,
      buttons: Array.prototype.map.call(document.querySelectorAll('#pv-day-sheet button'), function (node) { return node.textContent; })
    };
  });
  assert.ok(detail.text.indexOf('Evening extra') !== -1 && detail.text.indexOf('Completed, not scheduled') !== -1);
  assert.deepStrictEqual(detail.buttons, ['View', 'Run']);
  await trainer.click('#back');
  await trainer.waitForSelector('#pv-day-sheet .pv-day-row.is-extra');
  await trainer.click('#back');
  await trainer.waitForFunction(function () { return !document.getElementById('pv-sheet') && document.querySelector('.pv-month'); });

  for (var hop = 0; hop < 3 && !(await trainer.$('.pv-cell[data-date="' + future + '"]')); hop++) {
    await trainer.click('[data-unit="month"][data-shift="1"]');
    await trainer.waitForSelector('.pv-month');
  }
  await trainer.click('.pv-cell[data-date="' + future + '"]');
  await trainer.waitForSelector('#pv-day-sheet .pv-day-row');
  const futureRows = await trainer.$$eval('#pv-day-sheet .pv-day-row', function (rows) {
    return rows.map(function (row) {
      return {
        name: row.querySelector('.name').textContent,
        extra: row.classList.contains('is-extra'),
        done: !!row.querySelector('.pv-check')
      };
    });
  });
  assert.deepStrictEqual(futureRows, [
    { name: 'Mia legs', extra: false, done: false },
    { name: 'Evening extra', extra: false, done: false }
  ]);

  const freeData = M.emptyData();
  freeData.workouts.push(miaWo);
  freeData.programs = [entry('pg-mia', MIA, miaWo, '09:00', '10:00', 'trainer', 'FUTURE')];
  freeData.sessions = [{
    id: 'ses-mia', workoutId: miaWo.id, workoutName: 'Mia legs', programId: 'pg-mia',
    startedAt: 1, endedAt: 2, results: [{ logged: true, name: 'Press' }]
  }];
  const free = await browser.newPage();
  free.on('pageerror', function (err) { errors.push('free ' + err); });
  await free.setViewport(desktop);
  await stub(free, {
    id: MIA, email: 'kinisiathletics@gmail.com', membership: 'free_client', intended_plan: 'free_client', display_name: 'Mia Chen'
  }, { user: { id: MIA, email: 'kinisiathletics@gmail.com' } }, {
    roster: { role: null, clients: [] },
    status: {},
    share: { on: false, enthusiast: false, linked: true },
    sessions: [],
    connection: { trainerId: TRAINER, trainerName: 'Alex Rivera' }
  });
  await boot(free, freeData);
  await openPrograms(free);
  await free.waitForSelector('.pv-day.today .pv-session.is-extra');
  assert.strictEqual(await free.$eval('.pv-day.today .pv-session.is-extra .name', function (el) { return el.textContent; }), 'Mia legs');
  assert.strictEqual(await free.$('.pv-day.today .pv-session.is-extra[data-drag]'), null);
  assert.ok((await free.$eval('#pv-role-note', function (el) { return el.textContent; })).indexOf('Your trainer schedules') !== -1);
  await free.click('.pv-day.today .pv-day-h');
  await free.waitForSelector('#pv-day-sheet .pv-day-row.is-extra');
  assert.strictEqual(await free.$('[data-sheet=add-day]'), null);
  await free.click('#pv-day-sheet .pv-day-row.is-extra');
  await free.waitForSelector('[data-view-wo]');
  assert.deepStrictEqual(await free.$$eval('#pv-day-sheet button', function (nodes) {
    return nodes.map(function (node) { return node.textContent; });
  }), ['View', 'Run']);

  const joyData = M.emptyData();
  joyData.workouts.push(open);
  joyData.programs = [entry('pg-open', JOY, open, '18:00', '19:00', 'solo', 'FUTURE')];
  const joy = await browser.newPage();
  joy.on('pageerror', function (err) { errors.push('joy ' + err); });
  joy.on('dialog', function (dialog) {
    if (dialog.message().indexOf('End workout') !== -1 || dialog.message().indexOf('Logged sets') !== -1) { dialog.accept(); return; }
    errors.push('dialog ' + dialog.message());
    dialog.dismiss();
  });
  await joy.setViewport({ width: 900, height: 1100, deviceScaleFactor: 1 });
  await stub(joy, {
    id: JOY, email: 'kinisiathletics@gmail.com', membership: 'enthusiast', intended_plan: 'enthusiast', display_name: 'Joy Hale'
  }, { user: { id: JOY, email: 'kinisiathletics@gmail.com' } }, {
    roster: { role: null, clients: [] },
    status: {},
    share: { on: true, enthusiast: true, linked: true },
    sessions: [],
    connection: { trainerId: TRAINER, trainerName: 'Alex Rivera' },
    threads: [{ id: TRAINER, display_name: 'Alex Rivera', plan: 'Trainer' }]
  });
  await boot(joy, joyData);
  await joy.reload({ waitUntil: 'domcontentloaded' });
  await joy.waitForSelector('[data-a=run][data-id="' + open.id + '"]');
  await joy.click('[data-a=run][data-id="' + open.id + '"]');
  await joy.waitForSelector('.pl-screen');
  await joy.click('[data-p=primary]');
  await joy.waitForSelector('[data-p=endnow]');
  await joy.click('[data-p=endnow]');
  await joy.waitForFunction(function () {
    var note = document.getElementById('unscheduled-note');
    var saved = document.querySelector('[data-save-note]');
    return note && saved && saved.textContent.indexOf('Session saved') !== -1;
  });
  const note = await joy.$eval('#unscheduled-note', function (el) { return el.innerText; });
  assert.ok(note.indexOf('not on your calendar') !== -1);
  assert.ok(note.indexOf('Message your trainer') !== -1);
  assert.strictEqual(await joy.$eval('#unscheduled-message', function (el) { return el.textContent; }), 'Message your trainer');
  await joy.evaluate(function () {
    var el = document.getElementById('unscheduled-note');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await joy.screenshot({ path: path.join(ART, 'unscheduled_prompt.png') });
  await joy.click('#unscheduled-message');
  await joy.waitForFunction(function () { return location.hash.indexOf('#/messages/trainer-1') === 0; });
  await joy.waitForSelector('#msg-text');

  await joy.goto(URL + '#/programs', { waitUntil: 'domcontentloaded' });
  await joy.waitForFunction(function () {
    var today = document.querySelector('.pv-day.today .pv-session.is-extra');
    return today && today.textContent.indexOf('Open gym') !== -1;
  });
  assert.strictEqual(await color(joy, '.pv-day.today .pv-session.is-extra .name'), 'rgb(107, 114, 128)');
  assert.strictEqual(await color(joy, '.pv-day.today .pv-session.is-extra .pv-check'), 'rgb(217, 119, 6)');

  assert.deepStrictEqual(errors, []);
  console.log('UNSCHEDULED OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});