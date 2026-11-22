// Phone screens for exercise history. The page reads a stubbed myHistory payload shaped
// like workout_sessions / workout_sets / personal_exercises. Does not call the database.
// node tests/history-ui.test.js [url]
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

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: 'png' });
  const stat = fs.statSync(file);
  assert.ok(stat.size > 1000, name + ' screenshot is empty');
  return file;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pp.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', function (err) { errors.push(String(err)); });
  page.on('request', function (req) {
    const url = req.url();
    if (/supabase\.co/i.test(url)) errors.push('live database request ' + url);
  });
  await require('./allow.js').stubAuth(page, {
    session: { user: { id: 'test-alex', email: 'alex.rivera@example.com' } },
    profile: {
      id: 'test-alex',
      email: 'alex.rivera@example.com',
      membership: 'free_client',
      intended_plan: 'free_client',
      display_name: 'Alex Rivera'
    }
  });
  await page.evaluateOnNewDocument(function () {
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
          window.__historyCalls = (window.__historyCalls || 0) + 1;
          return Promise.resolve(window.__wbHistoryPayload || { sets: [], sessions: [], exercises: [] });
        };
        ['workoutCopies', 'accountPull', 'accountPush', 'accountImport', 'saveWorkoutCopy', 'deleteWorkoutCopy', 'freshSession', 'myConnection', 'roster', 'shareSetting', 'myShares'].forEach(function (name) {
          value[name] = function () { return Promise.resolve(null); };
        });
      }
    });
  });

  const data = M.emptyData();
  data.workouts.push(workout());
  await page.evaluateOnNewDocument(function (key, value) {
    localStorage.setItem(key, value);
  }, M.STORAGE_KEY, JSON.stringify(data));
  await page.goto(URL + '#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tracking-open');
  await page.waitForFunction(function () { return document.body.innerText.indexOf('Lower strength') >= 0; });
  const placed = await page.$eval('#tracking-open', function (el) {
    var row = el.parentElement;
    var rect = el.getBoundingClientRect();
    var programs = document.getElementById('programs-open').getBoundingClientRect();
    return {
      text: el.textContent,
      action: el.getAttribute('data-a'),
      first: row.firstElementChild.getAttribute('data-a'),
      next: row.nextElementSibling.firstElementChild.id + ' ' + row.nextElementSibling.lastElementChild.id,
      inside: rect.left >= 0 && rect.right <= window.innerWidth && rect.width > 70,
      beside: rect.left >= programs.right - 1,
      historyButton: !!document.getElementById('history-open')
    };
  });
  assert.deepStrictEqual(placed, {
    text: 'Tracking',
    action: 'tracking',
    first: 'account',
    next: 'messages-nav send-nav',
    inside: true,
    beside: true,
    historyButton: false
  });
  await shot(page, 'history-entry.png');

  await page.click('#tracking-open');
  await page.waitForSelector('#history-empty');
  assert.strictEqual(await page.$eval('#title', function (el) { return el.textContent; }), 'Tracking');
  assert.strictEqual(await page.$eval('#tracking-tab-history', function (el) { return el.getAttribute('aria-selected'); }), 'true');
  assert.strictEqual(await page.$('#dashboard-soon'), null);
  assert.ok(!(await page.$('#history-sample')), 'a real visit has no test-account banner');
  const emptyVisit = await page.$eval('#app', function (el) { return el.innerText; });
  assert.ok(emptyVisit.indexOf('No history yet') >= 0);
  assert.ok(emptyVisit.indexOf('Test account') < 0);
  assert.ok(emptyVisit.indexOf('Alex Rivera') < 0);
  assert.strictEqual(await page.evaluate(function () { return window.__historyCalls; }), 1);
  await shot(page, 'history-empty.png');

  const payload = remoteHistory();
  await page.evaluateOnNewDocument(function (rows) { window.__wbHistoryPayload = rows; }, payload);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#history-by-workout.on');
  await page.waitForSelector('#history-list .hx-row');
  const workoutNames = await page.$$eval('.hx-row .name', function (els) { return els.map(function (el) { return el.textContent; }); });
  assert.strictEqual(await page.evaluate(function () { return window.__historyCalls; }), 1, 'history reads the signed-in rows');
  assert.strictEqual(workoutNames[0], 'Sat Nov 14 · Conditioning');
  const lowerRows = workoutNames.filter(function (name) { return name.indexOf('Lower strength') >= 0; });
  assert.ok(lowerRows.length >= 2, 'two runs of Lower strength are two rows');
  assert.notStrictEqual(lowerRows[0], lowerRows[1]);
  assert.strictEqual(await page.$eval('.hx-row .mute', function (el) { return el.textContent; }), '1 set');
  await shot(page, 'history-by-workout.png');
  await page.click('[data-session="sq-1112"]');
  await page.waitForSelector('.hx-set');
  assert.strictEqual(await page.$eval('#title', function (el) { return el.textContent; }), 'Lower strength');
  const sessionText = await page.$eval('#app', function (el) { return el.textContent; });
  assert.ok(sessionText.indexOf('Thu Nov 12 · Lower strength') >= 0);
  assert.ok(sessionText.indexOf('Barbell squat') >= 0);
  assert.ok(sessionText.indexOf('3 × 225 lb') >= 0);
  assert.ok(sessionText.indexOf('8 × 185 lb') >= 0);
  await shot(page, 'history-session.png');
  await page.click('#back');
  await page.waitForSelector('#history-by-workout.on');
  await page.click('#history-by-exercise');
  await page.waitForSelector('[data-history="lib-0101"]');
  await page.waitForSelector('#history-list');
  await page.waitForFunction(function () {
    var imgs = Array.prototype.slice.call(document.querySelectorAll('.hx-thumb img'));
    return imgs.length >= 4 && imgs.every(function (img) { return img.complete && img.naturalWidth > 0; });
  }, { timeout: 15000 });
  const names = await page.$$eval('.hx-row .name', function (els) { return els.map(function (el) { return el.textContent; }); });
  assert.ok(names.indexOf('Court sprint') === 0);
  assert.ok(names.indexOf('Barbell squat') >= 0);
  assert.ok(names.indexOf('Farmer carry') >= 0);
  const thumbs = await page.$$eval('.hx-row', function (rows) {
    return rows.slice(0, 3).map(function (row) {
      var img = row.querySelector('.hx-thumb img');
      return { name: row.querySelector('.name').textContent, thumb: img ? img.getAttribute('src').slice(0, 24) : '' };
    });
  });
  assert.strictEqual(thumbs[0].thumb, '');
  assert.ok(thumbs[1].thumb.indexOf('http') === 0);
  assert.strictEqual(thumbs[2].thumb, '');
  const listText = await page.$eval('#app', function (el) { return el.innerText; });
  assert.ok(listText.indexOf('Test account') < 0);
  assert.ok(listText.indexOf('Alex Rivera') < 0);
  await shot(page, 'history-list.png');
  await page.type('#history-q', 'squat');
  await page.waitForFunction(function () {
    return document.querySelectorAll('.hx-row').length === 2;
  });
  assert.deepStrictEqual(await page.$$eval('.hx-row .name', function (els) { return els.map(function (el) { return el.textContent; }); }), [
    'Barbell squat', 'Bulgarian split squat'
  ]);
  await page.$eval('#history-q', function (el) {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(function () { return document.querySelectorAll('.hx-row').length === 7; });

  await page.click('[data-history="lib-0101"]');
  await page.waitForSelector('.hx-set.is-skip');
  assert.strictEqual(await page.$('#tracking-tabs'), null, 'an exercise stays on the history detail');
  assert.strictEqual(await page.$eval('#title', function (el) { return el.textContent; }), 'Barbell squat');
  const squatText = await page.$eval('#app', function (el) { return el.innerText; });
  assert.ok(squatText.indexOf('3 × 225 lb') >= 0);
  assert.ok(squatText.indexOf('Heaviest') >= 0);
  assert.ok(squatText.indexOf('8 × 185 lb') >= 0);
  assert.ok(squatText.indexOf('Most reps') >= 0);
  assert.ok(squatText.indexOf('Skipped') >= 0);
  assert.ok(squatText.indexOf('planned 5 × 205 lb') >= 0);
  assert.ok(squatText.indexOf('300') < 0);
  assert.ok(squatText.indexOf('Test account') < 0);
  await shot(page, 'history-reps.png');

  await page.click('#back');
  await page.waitForSelector('#history-list');
  assert.strictEqual(await page.evaluate(function () { return location.hash; }), '#/tracking');
  assert.strictEqual(await page.$eval('#tracking-tab-history', function (el) { return el.getAttribute('aria-selected'); }), 'true');
  await page.click('[data-history="own-c0ffee00-0000-4000-8000-000000000002"]');
  await page.waitForSelector('.hx-laps');
  const sprintText = await page.$eval('#app', function (el) { return el.innerText; });
  assert.strictEqual(await page.$eval('#title', function (el) { return el.textContent; }), 'Court sprint');
  assert.ok(sprintText.indexOf('01:12.40') >= 0);
  assert.ok(sprintText.indexOf('Fastest') >= 0);
  assert.ok(sprintText.indexOf('Best lap') >= 0);
  assert.ok(sprintText.indexOf('00:17.35') >= 0);
  assert.ok(sprintText.indexOf('3 passes · 1 fail') >= 0);
  assert.ok(sprintText.indexOf('Lap 3 · Drop · Fail') >= 0);
  assert.ok(sprintText.indexOf('planned 5 laps') >= 0);
  await shot(page, 'history-stopwatch.png');

  await page.evaluate(function () { window.__historyCalls = 0; });
  await page.goto(URL + '#/history?sample=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#history-list');
  assert.strictEqual(await page.$eval('#title', function (el) { return el.textContent; }), 'Tracking');
  assert.strictEqual(await page.$eval('#tracking-tab-history', function (el) { return el.getAttribute('aria-selected'); }), 'true');
  const bypassText = await page.$eval('#app', function (el) { return el.innerText; });
  assert.ok(bypassText.indexOf('Test account') < 0);
  assert.ok(bypassText.indexOf('sample data') < 0);
  assert.ok(!(await page.$('#history-sample')));
  assert.ok((await page.evaluate(function () { return window.__historyCalls; })) >= 1, 'a sample query still reads the signed-in rows');
  await page.goto(URL + '?preview=history#/history', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#history-list');
  assert.ok((await page.$eval('#app', function (el) { return el.innerText; })).indexOf('Test account') < 0);

  assert.deepStrictEqual(errors, []);
  console.log('HISTORY UI OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
