// Phone screens for the standard tracking dashboard.
// Rows are the history fixture or a rating case built in this file. No database.
// node tests/dashboard-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pp = require('puppeteer-core');
const M = require('../model.js');
const remoteHistory = require('./history-fixture').remoteHistory;

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const OUT = process.argv[3] || '/opt/cursor/artifacts';
const CHROME = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');

function workout() {
  const w = M.newWorkout('Lower strength');
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Barbell squat', sets: 3, weight: { unit: 'lb', value: 185 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 5, restSec: 90 }
  }))];
  return w;
}

function profile(membership) {
  return {
    id: 'test-' + membership,
    email: membership + '@example.com',
    membership: membership,
    intended_plan: membership,
    display_name: 'Test Person'
  };
}

function planPayload(hits, total) {
  const sets = [];
  const sessions = [];
  for (let i = 0; i < total; i++) {
    const id = 'rate-' + i;
    sessions.push({
      id: id,
      local_date: '2026-11-10',
      started_at: new Date(2026, 10, 10, 8, 0, i).toISOString(),
      workout_name: 'Day',
      status: 'completed'
    });
    sets.push({
      session_id: id,
      library_exercise_id: 'rate',
      exercise_name: 'Back squat',
      mode: 'reps',
      set_number: i + 1,
      status: 'completed',
      removed: false,
      display_unit: 'kg',
      planned_reps: 5,
      planned_weight_kg: 20,
      actual_reps: i < hits ? 5 : 1,
      actual_weight_kg: 20
    });
  }
  return { sessions: sessions, sets: sets, exercises: [] };
}

function enthusiastPayload() {
  const payload = remoteHistory();
  const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-14'];
  payload.schedule = days.map(function (day, i) {
    return {
      id: '00000000-0000-4000-8000-00000000000' + (i + 1),
      local_id: 'pg' + i,
      owner_id: 'test-enthusiast',
      workout_local_id: 'wo-day',
      day: day,
      presence: 'solo'
    };
  });
  payload.sessions.forEach(function (session) {
    const i = days.indexOf(String(session.local_date).slice(0, 10));
    if (i >= 0) session.program_id = 'pg' + i;
  });
  return payload;
}

async function shot(page, name, full) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: 'png', fullPage: !!full });
  const stat = fs.statSync(file);
  assert.ok(stat.size > 1000, name + ' screenshot is empty');
  return file;
}

async function openPage(browser, membership, payload) {
  const page = await browser.newPage();
  page.__errors = [];
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on('pageerror', function (err) { page.__errors.push(String(err)); });
  page.on('request', function (req) {
    if (/supabase\.co/i.test(req.url())) page.__errors.push('live database request ' + req.url());
  });
  await require('./allow.js').stubAuth(page, {
    session: { user: { id: 'test-' + membership, email: membership + '@example.com' } },
    profile: profile(membership)
  });
  await page.evaluateOnNewDocument(function (rows) {
    window.__wbDashboardNow = new Date(2026, 10, 16, 12, 0, 0).getTime();
    window.__wbHistoryPayload = { sets: rows.sets, sessions: rows.sessions, exercises: rows.exercises || [] };
    window.__wbSchedulePayload = { entries: rows.schedule || [] };
    window.__wbShares = rows.shares || null;
    var desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
    if (!desc || !desc.set) return;
    var prev = desc.set;
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: desc.get,
      set: function (value) {
        prev(value);
        if (!value) return;
        value.myHistory = function () {
          return Promise.resolve(window.__wbHistoryPayload);
        };
        value.mySchedule = function () {
          return Promise.resolve(window.__wbSchedulePayload);
        };
        value.myDashboardLayout = function () {
          window.__layoutReads = (window.__layoutReads || 0) + 1;
          if (window.__layoutFail) return Promise.resolve({ error: true, cards: null });
          if (!window.__layoutState) return Promise.resolve({ cards: null });
          return Promise.resolve({ cards: window.__layoutState.cards });
        };
        value.saveDashboardLayout = function (cards) {
          var finish = function () {
            window.__layoutState = { cards: cards.slice() };
            window.__layoutSaved = cards.slice();
            window.__saveCount = (window.__saveCount || 0) + 1;
            return { ok: true, cards: cards };
          };
          if (window.__layoutHoldSave) {
            return new Promise(function (resolve) {
              window.__layoutRelease = function () { resolve(finish()); };
            });
          }
          return Promise.resolve(finish());
        };
        value.resetDashboardLayout = function () {
          window.__layoutState = { cards: null };
          window.__layoutReset = true;
          return Promise.resolve({ ok: true });
        };
        ['workoutCopies', 'accountPull', 'accountPush', 'accountImport', 'saveWorkoutCopy', 'deleteWorkoutCopy', 'freshSession', 'myConnection', 'shareSetting', 'programEntries', 'myShares', 'clientTracking', 'clientSchedule'].forEach(function (name) {
          value[name] = function () { return Promise.resolve(null); };
        });
        value.myShares = function () {
          if (!window.__wbShares) return Promise.resolve(null);
          return Promise.resolve({ shares: window.__wbShares });
        };
        value.markShareViewed = function () {
          return Promise.resolve({ ok: true, viewed_at: '2026-11-16T18:00:00.000Z' });
        };
        value.roster = function () {
          return Promise.resolve(window.__roster || { clients: [] });
        };
      }
    });
  }, payload || { sets: [], sessions: [], exercises: [], schedule: [] });
  const data = M.emptyData();
  data.workouts.push(workout());
  if (payload && payload.programDrops) data.programDrops = payload.programDrops;
  await page.evaluateOnNewDocument(function (key, value) {
    localStorage.setItem(key, value);
  }, M.STORAGE_KEY, JSON.stringify(data));
  return page;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pp.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const enthusiast = await openPage(browser, 'enthusiast', enthusiastPayload());
  await enthusiast.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await enthusiast.waitForSelector('#dashboard-sheet');
  await enthusiast.waitForSelector('#dashboard-rating');
  const filled = await enthusiast.evaluate(function () {
    var text = document.getElementById('app').innerText;
    var sheet = getComputedStyle(document.getElementById('dashboard-sheet'));
    var rating = getComputedStyle(document.getElementById('dashboard-rating'));
    var ring = document.querySelector('#dashboard-plan svg');
    var titles = Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; });
    return {
      rating: document.getElementById('dashboard-rating').textContent,
      ratingColor: rating.color,
      plan: document.getElementById('dashboard-plan-note').textContent,
      week: document.getElementById('dashboard-week').textContent,
      month: document.getElementById('dashboard-month').textContent,
      streak: document.querySelector('#dashboard-streak b').textContent,
      streakNote: document.getElementById('dashboard-streak-note').textContent,
      goal: document.getElementById('dashboard-goal') ? document.getElementById('dashboard-goal').textContent : '',
      goalBars: document.querySelectorAll('#dashboard-goal-bars .db-bar').length,
      volume: document.getElementById('dashboard-volume-now').textContent,
      calendar: document.getElementById('dashboard-calendar-note').textContent,
      titles: titles,
      ringLabel: ring.getAttribute('aria-label'),
      chartRows: document.querySelectorAll('#dashboard-volume-table tbody tr').length,
      sheetBg: sheet.backgroundColor,
      sheetPos: sheet.position,
      sheetZ: sheet.zIndex,
      sheetBlur: sheet.backdropFilter,
      pass: text.indexOf('pass rate') >= 0,
      example: text.indexOf('Example data') >= 0 || text.indexOf('Test Person') >= 0 || text.indexOf('300') >= 0,
      removed: text.indexOf('300') >= 0,
      buttons: document.querySelectorAll('#dashboard button, #dashboard input, #dashboard [contenteditable]').length,
      badgeHidden: document.getElementById('dashboard-count').hidden
    };
  });
  assert.strictEqual(filled.rating, 'Keep trying');
  assert.strictEqual(filled.ratingColor, 'rgb(217, 119, 6)');
  assert.strictEqual(filled.plan, '11 of 17 sets met or beat the plan this month');
  assert.strictEqual(filled.week, '0');
  assert.strictEqual(filled.month, '13');
  assert.strictEqual(filled.streak, '5');
  assert.strictEqual(filled.streakNote, '5 scheduled workout days in a row. Rest days do not break this streak.');
  assert.strictEqual(filled.goal, '');
  assert.strictEqual(filled.goalBars, 0);
  assert.ok(/kg this week$/.test(filled.volume));
  assert.strictEqual(filled.calendar, '12 training days so far this month');
  assert.deepStrictEqual(filled.titles, [
    'Hit the plan',
    'Workouts and streak',
    'Total volume',
    'Strength and Capacity',
    'Consistency · November 2026',
    'Static holds'
  ]);
  assert.ok(filled.ringLabel.indexOf('65 percent') >= 0);
  assert.ok(filled.ringLabel.indexOf('Keep trying') >= 0);
  assert.strictEqual(filled.chartRows, 8);
  assert.ok(filled.sheetBg.indexOf('rgba(255, 255, 255') === 0, filled.sheetBg);
  assert.strictEqual(filled.sheetPos, 'relative');
  assert.strictEqual(filled.sheetZ, '1');
  assert.strictEqual(filled.sheetBlur, 'none');
  assert.strictEqual(filled.pass, false);
  const holdCard = await enthusiast.$eval('#dashboard-holds', function (el) { return el.innerText; });
  assert.strictEqual(await enthusiast.$('#dashboard-stopwatch'), null);
  assert.strictEqual(await enthusiast.$('#dashboard-records'), null);
  assert.strictEqual(await enthusiast.$('#dashboard-pass'), null);
  assert.ok(holdCard.indexOf('Plank') >= 0 && holdCard.indexOf('1:15') >= 0 && holdCard.indexOf('Nov 5') >= 0, holdCard);
  assert.ok(holdCard.indexOf('0:45') < 0, holdCard);
  await enthusiast.$eval('#dashboard-holds', function (el) { el.scrollIntoView({ block: 'center' }); });
  await (await enthusiast.$('#dashboard-holds')).screenshot({ path: path.join(OUT, 'static-holds-card.png'), type: 'png' });
  assert.ok(fs.statSync(path.join(OUT, 'static-holds-card.png')).size > 1000);
  assert.strictEqual(filled.example, false);
  assert.strictEqual(filled.buttons, 0);
  assert.strictEqual(filled.badgeHidden, true);
  await enthusiast.evaluate(function () {
    var bar = document.querySelector('header.bar');
    if (bar) bar.style.position = 'static';
  });
  await shot(enthusiast, 'dashboard-enthusiast.png', true);
  assert.deepStrictEqual(enthusiast.__errors, []);
  await enthusiast.close();

  const empty = await openPage(browser, 'enthusiast', { sets: [], sessions: [], exercises: [], schedule: [] });
  await empty.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await empty.waitForSelector('#dashboard-empty');
  assert.strictEqual(await empty.$eval('#dashboard-empty', function (el) { return el.innerText; }), 'Finish a workout and your dashboard will fill in.');
  assert.strictEqual(await empty.$('#dashboard-sheet'), null);
  assert.ok((await empty.$eval('#app', function (el) { return el.innerText; })).indexOf('Example data') < 0);
  await shot(empty, 'dashboard-empty.png', true);
  assert.deepStrictEqual(empty.__errors, []);
  await empty.close();

  const free = await openPage(browser, 'free_client', enthusiastPayload());
  await free.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await free.waitForSelector('#dashboard-find');
  const freeText = await free.$eval('#dashboard-soon', function (el) { return el.innerText; });
  assert.ok(freeText.indexOf('Your trainer can share a dashboard with you.') >= 0);
  assert.ok(freeText.indexOf('Find a trainer') >= 0);
  assert.ok(freeText.indexOf('Upgrade to Enthusiast') >= 0);
  assert.strictEqual(await free.$('#dashboard-sheet'), null);
  assert.strictEqual(await free.$eval('#dashboard-count', function (el) { return el.hidden; }), true);
  assert.ok((await free.$eval('#app', function (el) { return el.innerText; })).indexOf('Hit the plan') < 0);
  await shot(free, 'dashboard-free-client.png', true);
  assert.deepStrictEqual(free.__errors, []);
  await free.close();

  const ratings = [
    { name: 'elite', hits: 10, total: 11, label: 'Elite', color: 'rgb(15, 118, 110)' },
    { name: 'excellent', hits: 17, total: 20, label: 'Excellent', color: 'rgb(22, 163, 74)' },
    { name: 'good', hits: 3, total: 4, label: 'Good', color: 'rgb(37, 99, 235)' },
    { name: 'keep-trying', hits: 3, total: 5, label: 'Keep trying', color: 'rgb(217, 119, 6)' },
    { name: 'on-vacation', hits: 2, total: 5, label: 'On vacation?', color: 'rgb(220, 38, 38)' }
  ];
  for (const row of ratings) {
    const page = await openPage(browser, 'trainer', planPayload(row.hits, row.total));
    await page.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#dashboard-rating');
    const seen = await page.evaluate(function () {
      var el = document.getElementById('dashboard-rating');
      var arc = document.querySelector('#dashboard-plan svg circle + circle');
      return {
        label: el.textContent,
        color: getComputedStyle(el).color,
        stroke: arc ? arc.getAttribute('stroke') : ''
      };
    });
    assert.strictEqual(seen.label, row.label);
    assert.strictEqual(seen.color, row.color);
    const hex = {
      'rgb(15, 118, 110)': '#0f766e',
      'rgb(22, 163, 74)': '#16a34a',
      'rgb(37, 99, 235)': '#2563eb',
      'rgb(217, 119, 6)': '#d97706',
      'rgb(220, 38, 38)': '#dc2626'
    }[row.color];
    assert.strictEqual(seen.stroke.toLowerCase(), hex);
    await shot(page, 'dashboard-rating-' + row.name + '.png', false);
    assert.deepStrictEqual(page.__errors, []);
    await page.close();
  }

  const dropAt = Date.parse('2026-11-15T12:00:00Z');
  function streakPayload(serverUpdated) {
    return {
      sets: [],
      exercises: [],
      programDrops: {
        'pg-13': { at: dropAt, ownerId: 'test-enthusiast' },
        'pg-17': { at: dropAt, ownerId: 'test-enthusiast' }
      },
      sessions: [
        { id: 's14', local_date: '2026-11-14', started_at: '2026-11-14T15:00:00.000Z', workout_name: 'Day', status: 'completed', program_id: 'pg-14', workout_id: 'wo' },
        { id: 's12', local_date: '2026-11-12', started_at: '2026-11-12T15:00:00.000Z', workout_name: 'Day', status: 'completed', program_id: 'pg-12', workout_id: 'wo' }
      ],
      schedule: ['2026-11-18', '2026-11-17', '2026-11-16', '2026-11-14', '2026-11-13', '2026-11-12'].map(function (day, i) {
        return {
          id: '00000000-0000-4000-8000-00000000001' + (i + 1),
          local_id: day === '2026-11-13' ? 'pg-13' : (day === '2026-11-17' ? 'pg-17' : ('pg-' + day.slice(8))),
          owner_id: 'test-enthusiast',
          workout_local_id: 'wo',
          day: day,
          presence: 'solo',
          updated_at: day === '2026-11-13' ? serverUpdated : '2026-11-01T00:00:00.000Z'
        };
      })
    };
  }
  const dropped = await openPage(browser, 'enthusiast', streakPayload('2026-11-01T00:00:00.000Z'));
  await dropped.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await dropped.waitForSelector('#dashboard-streak');
  assert.strictEqual(await dropped.$eval('#dashboard-streak b', function (el) { return el.textContent; }), '2');
  assert.strictEqual(await dropped.$eval('#dashboard-goal', function (el) { return el.textContent; }), "This week's goal: 2 workouts");
  assert.strictEqual(await dropped.$$eval('#dashboard-goal-bars .db-bar', function (els) { return els.length; }), 2);
  assert.deepStrictEqual(dropped.__errors, []);
  await dropped.close();

  const revived = await openPage(browser, 'enthusiast', streakPayload('2026-11-16T00:00:00.000Z'));
  await revived.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await revived.waitForSelector('#dashboard-streak');
  assert.strictEqual(await revived.$eval('#dashboard-streak b', function (el) { return el.textContent; }), '1');
  assert.deepStrictEqual(revived.__errors, []);
  await revived.close();

  const LB = 0.45359237;
  function tracked(id, date, hour) {
    var parts = date.split('-');
    return {
      id: id,
      local_date: date,
      started_at: new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), hour, 0, 0).toISOString(),
      workout_name: 'Day',
      status: 'completed'
    };
  }
  function logged(sessionId, lib, name, unit, kg, reps) {
    const row = {
      session_id: sessionId,
      library_exercise_id: lib,
      exercise_name: name,
      mode: 'reps',
      set_number: 1,
      status: 'completed',
      removed: false,
      display_unit: unit,
      actual_reps: reps,
      planned_reps: reps
    };
    if (unit === 'bodyweight') {
      row.actual_bodyweight = true;
      row.planned_bodyweight = true;
      row.actual_weight_kg = null;
    } else {
      row.actual_weight_kg = kg;
      row.planned_weight_kg = kg;
    }
    return row;
  }
  const phone = await openPage(browser, 'enthusiast', {
    sessions: [
      tracked('sq-old', '2026-10-02', 8), tracked('sq-new', '2026-11-02', 8),
      tracked('fs-old', '2026-10-03', 8), tracked('fs-new', '2026-11-03', 8),
      tracked('pu-old', '2026-10-09', 8), tracked('pu-new', '2026-11-09', 8),
      tracked('now', '2026-11-16', 9)
    ],
    sets: [
      logged('sq-old', 'sq', 'Back squat', 'kg', 100, 5),
      logged('sq-new', 'sq', 'Back squat', 'kg', 110, 5),
      logged('fs-old', 'fs', 'Front squat', 'lb', 200 * LB, 8),
      logged('fs-new', 'fs', 'Front squat', 'lb', 220 * LB, 8),
      logged('pu-old', 'pu', 'Push-up', 'bodyweight', null, 100),
      logged('pu-new', 'pu', 'Push-up', 'bodyweight', null, 101)
    ],
    exercises: [],
    schedule: [
      { id: '00000000-0000-4000-8000-000000000101', local_id: 'pg-16', owner_id: 'test-enthusiast', workout_local_id: 'wo', day: '2026-11-16', presence: 'solo', updated_at: '2026-11-01T00:00:00.000Z' },
      { id: '00000000-0000-4000-8000-000000000102', local_id: 'pg-18', owner_id: 'test-enthusiast', workout_local_id: 'wo', day: '2026-11-18', presence: 'solo', updated_at: '2026-11-01T00:00:00.000Z' },
      { id: '00000000-0000-4000-8000-000000000103', local_id: 'pg-19', owner_id: 'test-enthusiast', workout_local_id: 'wo', day: '2026-11-19', presence: 'solo', updated_at: '2026-11-01T00:00:00.000Z' },
      { id: '00000000-0000-4000-8000-000000000104', local_id: 'pg-20', owner_id: 'test-enthusiast', workout_local_id: 'wo', day: '2026-11-20', presence: 'solo', updated_at: '2026-11-01T00:00:00.000Z' },
      { id: '00000000-0000-4000-8000-000000000105', local_id: 'pg-12', owner_id: 'test-enthusiast', workout_local_id: 'wo', day: '2026-11-12', presence: 'solo', updated_at: '2026-11-01T00:00:00.000Z' }
    ],
    programDrops: { 'pg-19': { at: Date.parse('2026-11-15T12:00:00Z'), ownerId: 'test-enthusiast' } }
  });
  await phone.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await phone.waitForSelector('#dashboard-strength');
  await phone.waitForSelector('#dashboard-goal');
  const shown = await phone.evaluate(function () {
    var sheet = getComputedStyle(document.getElementById('dashboard-sheet'));
    var bars = Array.prototype.map.call(document.querySelectorAll('#dashboard-strength .db-gain'), function (el) {
      var fill = el.querySelector('.db-gain-fill');
      return {
        name: el.querySelector('.name').textContent,
        rating: el.getAttribute('data-rating'),
        text: el.querySelector('.db-gain-pct').textContent,
        color: getComputedStyle(el.querySelector('.db-gain-pct')).color,
        width: fill.style.width,
        ratio: fill.getBoundingClientRect().width / el.querySelector('.db-gain-track').getBoundingClientRect().width
      };
    });
    return {
      goal: document.getElementById('dashboard-goal').textContent,
      segments: document.querySelectorAll('#dashboard-goal-bars .db-bar').length,
      filled: document.querySelectorAll('#dashboard-goal-bars .db-bar.on').length,
      sheetBg: sheet.backgroundColor,
      share: !!document.getElementById('dash-share'),
      add: !!document.getElementById('dash-add'),
      bars: bars
    };
  });
  assert.strictEqual(shown.goal, "This week's goal: 3 workouts");
  assert.strictEqual(shown.segments, 3);
  assert.strictEqual(shown.filled, 1);
  const sheetCss = await phone.evaluate(function () {
    return fetch('style.css').then(function (res) { return res.text(); });
  });
  assert.ok(/\.db-sheet\{[^}]*rgba\(255,255,255,\.9\)/.test(sheetCss), 'sheet fill is 90% opaque');
  assert.strictEqual(shown.sheetBg, 'rgba(255, 255, 255, 0.9)');
  assert.strictEqual(shown.share, false);
  assert.strictEqual(shown.add, false);
  assert.deepStrictEqual(shown.bars.map(function (row) { return row.name + ' ' + row.rating; }), [
    'Back squat Elite',
    'Front squat Elite',
    'Push-up Good'
  ]);
  assert.deepStrictEqual(shown.bars.map(function (row) { return row.width; }), ['100%', '100%', '10%']);
  assert.ok(shown.bars[0].ratio > 0.96 && shown.bars[1].ratio > 0.96, 'a 10% gain fills the track');
  assert.ok(shown.bars[2].ratio > 0.08 && shown.bars[2].ratio < 0.14, 'a 1% gain is about one tenth of the track');
  assert.strictEqual(shown.bars[0].color, shown.bars[1].color);
  assert.notStrictEqual(shown.bars[0].color, shown.bars[2].color);
  assert.ok((await phone.$eval('#dashboard-strength', function (el) { return el.innerText; })).indexOf('200 lb to 220 lb') >= 0);
  await shot(phone, 'dashboard-phone-strength.png', true);
  assert.deepStrictEqual(phone.__errors, []);
  await phone.close();

  const self = await openPage(browser, 'trainer', { sets: [], sessions: [], exercises: [], schedule: [] });
  await self.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await self.waitForSelector('#dash-reset');
  await self.waitForSelector('#client-pick option:checked');
  assert.strictEqual(await self.$eval('#client-pick', function (el) { return el.tagName; }), 'SELECT');
  assert.strictEqual(await self.$eval('#client-pick option:checked', function (el) { return el.textContent; }), 'Me · Test Person');
  assert.strictEqual(await self.$('#dash-share'), null);
  assert.strictEqual(await self.$('#dash-add'), null);
  assert.strictEqual(await self.$('[data-card-remove]'), null);
  assert.strictEqual(await self.$('[data-drag]'), null);
  assert.strictEqual(await self.$('#dashboard-records'), null);
  assert.strictEqual(await self.$('#dashboard-stopwatch'), null);
  assert.strictEqual(await self.$('#dashboard-pass'), null);
  await self.click('#dash-edit');
  await self.waitForSelector('[data-card-add="records"]');
  assert.strictEqual(await self.$eval('[data-card-up="plan"]', function (el) { return el.disabled; }), true);
  assert.strictEqual(await self.$eval('[data-card-down="holds"]', function (el) { return el.disabled; }), true);
  assert.strictEqual(await self.$eval('[data-card-add="records"]', function (el) { return el.textContent; }), 'Recent personal records');
  assert.strictEqual(await self.$eval('[data-card-add="stopwatch"]', function (el) { return el.textContent; }), 'Stopwatch');
  assert.strictEqual(await self.$eval('[data-card-add="pass"]', function (el) { return el.textContent; }), 'Stopwatch pass rate');
  await self.click('[data-card-remove="holds"]');
  await self.waitForSelector('[data-card-add="holds"]');
  assert.strictEqual(await self.$eval('[data-card-add="holds"]', function (el) { return el.textContent; }), 'Static holds');
  await self.click('[data-card-add="holds"]');
  await self.click('[data-card-add="records"]');
  await self.click('[data-card-add="stopwatch"]');
  await self.waitForSelector('#dashboard-stopwatch');
  assert.ok(await self.$('#dash-add'));
  assert.ok(await self.$('#dash-save'));
  await self.click('[data-card-remove="records"]');
  await self.waitForFunction(function () {
    return !document.getElementById('dashboard-records') && !window.__layoutSaved;
  });
  await self.click('#dash-save');
  await self.waitForFunction(function () {
    return window.__layoutSaved && window.__layoutSaved.indexOf('records') < 0 &&
      !document.getElementById('dashboard-records') && !document.getElementById('dash-save');
  });
  await self.click('#dash-edit');
  await self.waitForSelector('[data-card-up="volume"]');
  await self.click('[data-card-up="volume"]');
  await self.waitForFunction(function () {
    var titles = Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; });
    return titles[1] === 'Total volume' && window.__layoutSaved && window.__layoutSaved[1] !== 'volume';
  });
  await self.click('#dash-save');
  await self.waitForFunction(function () {
    return window.__layoutSaved && window.__layoutSaved[1] === 'volume' && !document.getElementById('dash-save');
  });
  const custom = await self.evaluate(function () {
    return {
      titles: Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; }),
      saved: window.__layoutSaved,
      share: !!document.getElementById('dash-share'),
      reset: document.getElementById('dash-reset').textContent,
      edit: document.getElementById('dash-edit').textContent,
      me: document.querySelector('#client-pick option:checked').textContent,
      tools: !!document.querySelector('[data-card-remove]')
    };
  });
  assert.deepStrictEqual(custom.me, 'Me · Test Person');
  assert.strictEqual(custom.share, false);
  assert.strictEqual(custom.reset, 'Reset');
  assert.strictEqual(custom.edit, 'Edit');
  assert.strictEqual(custom.tools, false);
  assert.ok(custom.saved.indexOf('records') < 0);
  assert.ok(custom.saved.indexOf('stopwatch') >= 0);
  assert.strictEqual(custom.saved[1], 'volume');
  await self.evaluate(function () {
    var bar = document.querySelector('header.bar');
    if (bar) bar.style.position = 'static';
  });
  await shot(self, 'trainer-own-dashboard.png', true);
  await self.click('#tracking-tab-history');
  await self.waitForSelector('#history-empty');
  await self.click('#tracking-tab-dashboard');
  await self.waitForFunction(function () {
    return !document.getElementById('dashboard-records') &&
      !!document.getElementById('dashboard-stopwatch') &&
      document.getElementById('dash-reset');
  });
  await self.click('#dash-reset');
  await self.waitForFunction(function () {
    return window.__layoutReset === true &&
      !document.getElementById('dashboard-records') &&
      !document.getElementById('dashboard-stopwatch') &&
      !document.getElementById('dashboard-pass') &&
      !!document.getElementById('dashboard-holds') &&
      !!document.getElementById('dashboard-volume');
  });
  assert.strictEqual(await self.evaluate(function () { return window.__layoutState.cards; }), null);
  const resetTitles = await self.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; });
  });
  assert.deepStrictEqual(resetTitles, [
    'Hit the plan',
    'Workouts and streak',
    'Total volume',
    'Strength and Capacity',
    'Consistency · November 2026',
    'Static holds'
  ]);
  assert.deepStrictEqual(self.__errors, []);
  await self.close();

  const kept = await openPage(browser, 'trainer', { sets: [], sessions: [], exercises: [], schedule: [] });
  await kept.evaluateOnNewDocument(function () {
    window.__layoutState = { cards: ['records', 'stopwatch', 'pass', 'holds'] };
  });
  await kept.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await kept.waitForSelector('#dashboard-pass');
  const keptTitles = await kept.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; });
  });
  assert.deepStrictEqual(keptTitles, [
    'Recent personal records',
    'Stopwatch',
    'Stopwatch pass rate',
    'Static holds'
  ]);
  assert.strictEqual(await kept.$('#dashboard-plan'), null);
  assert.deepStrictEqual(kept.__errors, []);
  await kept.close();

  const blocked = await openPage(browser, 'trainer', { sets: [], sessions: [], exercises: [], schedule: [] });
  await blocked.evaluateOnNewDocument(function () {
    window.__layoutState = { cards: ['volume', 'plan'] };
    window.__layoutFail = true;
  });
  await blocked.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await blocked.waitForSelector('#dashboard-holds');
  assert.strictEqual(await blocked.$('#dashboard-records'), null);
  await blocked.click('#dash-edit');
  await blocked.waitForSelector('[data-card-remove="holds"]');
  await blocked.click('[data-card-remove="holds"]');
  await blocked.click('#dash-save');
  await blocked.waitForFunction(function () {
    return document.getElementById('toast').textContent.indexOf('so this change was not saved') !== -1;
  });
  assert.deepStrictEqual(await blocked.evaluate(function () { return window.__layoutState.cards; }), ['volume', 'plan']);
  assert.strictEqual(await blocked.evaluate(function () { return window.__saveCount || 0; }), 0);
  await blocked.click('#dash-reset');
  assert.strictEqual(await blocked.$('#dashboard-holds'), null);
  assert.notStrictEqual(await blocked.evaluate(function () { return window.__layoutReset; }), true);
  assert.deepStrictEqual(await blocked.evaluate(function () { return window.__layoutState.cards; }), ['volume', 'plan']);
  assert.deepStrictEqual(blocked.__errors, []);
  await blocked.close();

  const raced = await openPage(browser, 'trainer', { sets: [], sessions: [], exercises: [], schedule: [] });
  await raced.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await raced.waitForSelector('#dash-edit');
  await raced.click('#dash-edit');
  await raced.waitForSelector('[data-card-remove="holds"]');
  await raced.evaluate(function () { window.__layoutHoldSave = true; });
  await raced.click('[data-card-remove="holds"]');
  await raced.waitForFunction(function () { return !document.getElementById('dashboard-holds') && !window.__saveCount; });
  await raced.click('#dash-save');
  await raced.click('#tracking-tab-history');
  await raced.waitForSelector('#history-empty');
  await raced.click('#tracking-tab-dashboard');
  await raced.waitForSelector('#dashboard[aria-busy="true"]');
  assert.strictEqual(await raced.evaluate(function () { return window.__saveCount || 0; }), 0);
  await raced.evaluate(function () { window.__layoutRelease(); window.__layoutHoldSave = false; });
  await raced.waitForFunction(function () {
    return document.getElementById('dash-reset') && !document.getElementById('dashboard-holds') && window.__saveCount === 1;
  });
  await raced.click('#dash-edit');
  await raced.waitForSelector('[data-card-remove="volume"]');
  await raced.click('[data-card-remove="volume"]');
  await raced.click('#dash-save');
  await raced.waitForFunction(function () {
    var cards = window.__layoutState && window.__layoutState.cards;
    return cards && cards.indexOf('volume') < 0 && cards.indexOf('holds') < 0 && window.__saveCount === 2;
  });
  assert.deepStrictEqual(raced.__errors, []);
  await raced.close();

  const switched = await openPage(browser, 'trainer', { sets: [], sessions: [], exercises: [], schedule: [] });
  await switched.evaluateOnNewDocument(function () {
    window.__layoutState = { cards: ['volume', 'plan'] };
    window.__roster = {
      role: 'trainer',
      clients: [{
        id: '00000000-0000-4000-8000-000000000201',
        display_name: 'Ada Client',
        membership: 'free_client',
        plan: 'Free Client'
      }]
    };
  });
  await switched.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await switched.waitForFunction(function () {
    var titles = Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; });
    return titles[0] === 'Total volume' && titles[1] === 'Hit the plan' && !document.getElementById('dashboard-records');
  });
  await switched.select('#client-pick', '00000000-0000-4000-8000-000000000201');
  await switched.waitForSelector('#dashboard-unavailable');
  await switched.evaluate(function () { window.__layoutFail = true; });
  await switched.select('#client-pick', '');
  await switched.waitForFunction(function () {
    var titles = Array.prototype.map.call(document.querySelectorAll('#dashboard-sheet h2'), function (el) { return el.textContent; });
    return document.getElementById('toast').textContent.indexOf('Could not refresh') !== -1 &&
      titles[0] === 'Total volume' && titles[1] === 'Hit the plan' && !document.getElementById('dashboard-records');
  });
  assert.deepStrictEqual(await switched.evaluate(function () { return window.__layoutState.cards; }), ['volume', 'plan']);
  assert.strictEqual(await switched.evaluate(function () { return window.__saveCount || 0; }), 0);
  assert.deepStrictEqual(switched.__errors, []);
  await switched.close();

  const half = await openPage(browser, 'enthusiast', {
    sessions: [tracked('bn-old', '2026-10-04', 8), tracked('bn-new', '2026-11-04', 8)],
    sets: [
      logged('bn-old', 'bn', 'Bench press', 'kg', 100, 8),
      logged('bn-new', 'bn', 'Bench press', 'kg', 105, 8)
    ],
    exercises: [],
    schedule: []
  });
  await half.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await half.waitForSelector('#dashboard-strength .db-gain-fill');
  const halfBar = await half.evaluate(function () {
    var row = document.querySelector('#dashboard-strength .db-gain');
    var fill = row.querySelector('.db-gain-fill');
    var track = row.querySelector('.db-gain-track');
    return {
      text: row.querySelector('.db-gain-pct').textContent,
      width: fill.style.width,
      ratio: fill.getBoundingClientRect().width / track.getBoundingClientRect().width
    };
  });
  assert.strictEqual(halfBar.text, '5% · Excellent');
  assert.strictEqual(halfBar.width, '50%');
  assert.ok(halfBar.ratio > 0.46 && halfBar.ratio < 0.54, 'a 5% gain fills half the track');
  assert.deepStrictEqual(half.__errors, []);
  await half.close();

  const trainerBars = await openPage(browser, 'trainer', {
    sessions: [
      tracked('sq-old', '2026-10-02', 8), tracked('sq-new', '2026-11-02', 8),
      tracked('pu-old', '2026-10-09', 8), tracked('pu-new', '2026-11-09', 8)
    ],
    sets: [
      logged('sq-old', 'sq', 'Back squat', 'kg', 100, 5),
      logged('sq-new', 'sq', 'Back squat', 'kg', 110, 5),
      logged('pu-old', 'pu', 'Push-up', 'bodyweight', null, 100),
      logged('pu-new', 'pu', 'Push-up', 'bodyweight', null, 101)
    ],
    exercises: [],
    schedule: []
  });
  await trainerBars.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await trainerBars.waitForSelector('#dash-reset');
  await trainerBars.waitForSelector('#dashboard-strength .db-gain-fill');
  const edited = await trainerBars.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#dashboard-strength .db-gain'), function (el) {
      var fill = el.querySelector('.db-gain-fill');
      return {
        text: el.querySelector('.db-gain-pct').textContent,
        width: fill.style.width,
        ratio: fill.getBoundingClientRect().width / el.querySelector('.db-gain-track').getBoundingClientRect().width,
        editor: !!el.closest('.db-edit')
      };
    });
  });
  assert.deepStrictEqual(edited.map(function (row) { return row.text + ' ' + row.width; }), [
    '10% · Elite 100%',
    '1% · Good 10%'
  ]);
  assert.ok(edited.every(function (row) { return !row.editor; }));
  assert.ok(edited[0].ratio > 0.96);
  assert.ok(edited[1].ratio > 0.08 && edited[1].ratio < 0.14);
  assert.deepStrictEqual(trainerBars.__errors, []);
  await trainerBars.close();

  const shareId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10';
  const frozen = await openPage(browser, 'enthusiast', {
    sets: [],
    sessions: [],
    exercises: [],
    schedule: [],
    shares: [{
      id: shareId,
      trainer_name: 'Coach Lee',
      as_of: '2026-11-16',
      created_at: '2026-11-16T15:00:00.000Z',
      viewed_at: '2026-11-16T16:00:00.000Z',
      cards: [{
        type: 'strength',
        strength: {
          weight: [
            { name: 'Bench press', pct: 5, rating: { label: 'Excellent', color: '#16A34A' }, detail: '100 kg to 105 kg' },
            { name: 'Back squat', pct: 10, rating: { label: 'Elite', color: '#0F766E' }, detail: '100 kg to 110 kg' },
            { name: 'Deadlift', pct: 15, rating: { label: 'Alien', color: '#0F766E' }, detail: '100 kg to 115 kg' }
          ],
          reps: []
        }
      }]
    }]
  });
  await frozen.goto(URL + '#/tracking/dashboard/share/' + shareId, { waitUntil: 'domcontentloaded' });
  await frozen.waitForSelector('#dashboard-stamp');
  await frozen.waitForSelector('#dashboard-strength .db-gain-fill');
  const frozenBars = await frozen.evaluate(function () {
    return {
      stamp: document.getElementById('dashboard-stamp').textContent,
      bars: Array.prototype.map.call(document.querySelectorAll('#dashboard-strength .db-gain'), function (el) {
        var fill = el.querySelector('.db-gain-fill');
        var pct = el.querySelector('.db-gain-pct');
        return {
          name: el.querySelector('.name').textContent,
          rating: el.getAttribute('data-rating'),
          text: pct.textContent,
          width: fill.style.width,
          color: getComputedStyle(pct).color,
          fill: fill.style.backgroundColor,
          ratio: fill.getBoundingClientRect().width / el.querySelector('.db-gain-track').getBoundingClientRect().width
        };
      })
    };
  });
  assert.strictEqual(frozenBars.stamp, 'As of November 16, 2026 from Coach Lee');
  assert.deepStrictEqual(frozenBars.bars.map(function (row) { return row.text + ' ' + row.width; }), [
    '5% · Excellent 50%',
    '10% · Elite 100%',
    '15% · Alien 100%'
  ]);
  assert.ok(frozenBars.bars[0].ratio > 0.46 && frozenBars.bars[0].ratio < 0.54);
  assert.ok(frozenBars.bars[1].ratio > 0.96 && frozenBars.bars[2].ratio > 0.96);
  assert.strictEqual(frozenBars.bars[2].color, frozenBars.bars[1].color);
  assert.strictEqual(frozenBars.bars[2].fill, frozenBars.bars[1].fill);
  assert.notStrictEqual(frozenBars.bars[0].color, frozenBars.bars[1].color);
  const cardShot = path.join(OUT, 'strength-bar-scale.png');
  await frozen.$eval('#dashboard-strength', function (el) { el.scrollIntoView({ block: 'center' }); });
  await (await frozen.$('#dashboard-strength')).screenshot({ path: cardShot, type: 'png' });
  assert.ok(fs.statSync(cardShot).size > 1000);
  assert.deepStrictEqual(frozen.__errors, []);
  await frozen.close();

  console.log('DASHBOARD UI OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
