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
        ['workoutCopies', 'accountPull', 'accountPush', 'accountImport', 'saveWorkoutCopy', 'deleteWorkoutCopy', 'freshSession', 'myConnection', 'roster', 'shareSetting', 'programEntries', 'myShares', 'clientHistory', 'clientSchedule', 'shareDashboard', 'markShareViewed'].forEach(function (name) {
          value[name] = function () { return Promise.resolve(null); };
        });
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
      goal: document.getElementById('dashboard-goal').textContent,
      volume: document.getElementById('dashboard-volume-now').textContent,
      calendar: document.getElementById('dashboard-calendar-note').textContent,
      titles: titles,
      ringLabel: ring.getAttribute('aria-label'),
      chartRows: document.querySelectorAll('#dashboard-volume-table tbody tr').length,
      sheetBg: sheet.backgroundColor,
      pass: text.indexOf('pass rate') >= 0 || text.indexOf('Stopwatch') >= 0,
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
  assert.strictEqual(filled.goal, "This week's goal: 4 workouts");
  assert.ok(/kg this week$/.test(filled.volume));
  assert.strictEqual(filled.calendar, '12 training days so far this month');
  assert.deepStrictEqual(filled.titles, [
    'Hit the plan',
    'Workouts and streak',
    'Total volume',
    'Recent personal records',
    'Consistency · November 2026'
  ]);
  assert.ok(filled.ringLabel.indexOf('65 percent') >= 0);
  assert.ok(filled.ringLabel.indexOf('Keep trying') >= 0);
  assert.strictEqual(filled.chartRows, 8);
  assert.ok(filled.sheetBg.indexOf('rgba(30, 41, 59') === 0, filled.sheetBg);
  assert.strictEqual(filled.pass, false);
  assert.strictEqual(filled.example, false);
  assert.strictEqual(filled.buttons, 0);
  assert.strictEqual(filled.badgeHidden, true);
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
  await free.waitForSelector('#dashboard-empty-client');
  const freeText = await free.$eval('#dashboard-empty-client', function (el) { return el.innerText; });
  assert.ok(freeText.indexOf('No dashboard yet') >= 0);
  assert.ok(freeText.indexOf('Find a trainer') >= 0);
  assert.ok(freeText.indexOf('The Trainer Hub is coming soon.') >= 0);
  assert.ok(freeText.indexOf('Upgrade to Enthusiast') >= 0);
  assert.strictEqual(await free.$eval('#dashboard-upgrade', function (el) { return el.getAttribute('href'); }), '#/subscriptions');
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
      programDrops: { 'pg-13': { at: dropAt, ownerId: 'test-enthusiast' } },
      sessions: [
        { id: 's14', local_date: '2026-11-14', started_at: '2026-11-14T15:00:00.000Z', workout_name: 'Day', status: 'completed', program_id: 'pg-14', workout_id: 'wo' },
        { id: 's12', local_date: '2026-11-12', started_at: '2026-11-12T15:00:00.000Z', workout_name: 'Day', status: 'completed', program_id: 'pg-12', workout_id: 'wo' }
      ],
      schedule: ['2026-11-14', '2026-11-13', '2026-11-12'].map(function (day, i) {
        return {
          id: '00000000-0000-4000-8000-00000000001' + (i + 1),
          local_id: day === '2026-11-13' ? 'pg-13' : (day === '2026-11-14' ? 'pg-14' : 'pg-12'),
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
  assert.deepStrictEqual(dropped.__errors, []);
  await dropped.close();

  const revived = await openPage(browser, 'enthusiast', streakPayload('2026-11-16T00:00:00.000Z'));
  await revived.goto(URL + '#/tracking/dashboard', { waitUntil: 'domcontentloaded' });
  await revived.waitForSelector('#dashboard-streak');
  assert.strictEqual(await revived.$eval('#dashboard-streak b', function (el) { return el.textContent; }), '1');
  assert.deepStrictEqual(revived.__errors, []);
  await revived.close();

  console.log('DASHBOARD UI OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
