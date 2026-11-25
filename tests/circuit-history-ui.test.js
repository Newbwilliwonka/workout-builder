// 390px shots of a circuit history card and the dashboard Circuit card.
// Sample data only. Does not call the database.
// node tests/circuit-history-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const OUT = process.argv[3] || '/opt/cursor/artifacts';
const CHROME = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pp.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setCacheEnabled(false);
  await page.goto(URL + '?shot=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return window.WBHistory && window.WBDashboard; });
  await page.evaluate(function () {
    var sets = [
      { sessionId: 's1', localDate: '2026-11-20', startedAt: '2026-11-20T15:00:00.000Z', workoutName: 'Friday circuit', origin: 'circuit', exerciseName: 'Goblet squat', libraryExerciseId: 'squat1', mode: 'timer', setNumber: 1, status: 'completed', displayUnit: 'bodyweight', plannedWorkSec: 40, actualWorkSec: 40, plannedRestSec: 15, actualRestSec: 15 },
      { sessionId: 's1', localDate: '2026-11-20', startedAt: '2026-11-20T15:00:00.000Z', workoutName: 'Friday circuit', origin: 'circuit', exerciseName: 'Ring row', libraryExerciseId: 'row1', mode: 'timer', setNumber: 2, status: 'completed', displayUnit: 'bodyweight', plannedWorkSec: 40, actualWorkSec: 38, plannedRestSec: 15, actualRestSec: 15 },
      { sessionId: 's1', localDate: '2026-11-20', startedAt: '2026-11-20T15:00:00.000Z', workoutName: 'Friday circuit', origin: 'circuit', exerciseName: 'Farmer carry', libraryExerciseId: 'carry1', mode: 'timer', setNumber: 3, status: 'completed', displayUnit: 'bodyweight', plannedWorkSec: 40, actualWorkSec: 40, plannedRestSec: 15, actualRestSec: 15 }
    ];
    var view = WBHistory.sessionDetail(sets, 's1');
    var model = WBDashboard.build({
      now: new Date('2026-11-25T12:00:00.000Z'),
      sets: sets.concat([
        { sessionId: 's2', localDate: '2026-11-06', startedAt: '2026-11-06T15:00:00.000Z', workoutName: 'Thursday circuit', origin: 'circuit', exerciseName: 'Goblet squat', libraryExerciseId: 'squat1', mode: 'timer', setNumber: 1, status: 'completed', displayUnit: 'bodyweight', actualWorkSec: 40, actualRestSec: 15 }
      ]),
      sessions: [
        { id: 's1', local_date: '2026-11-20', status: 'completed', origin: 'circuit', started_at: '2026-11-20T15:00:00.000Z', ended_at: '2026-11-20T15:18:00.000Z', workout_name: 'Friday circuit' },
        { id: 's2', local_date: '2026-11-06', status: 'completed', origin: 'circuit', started_at: '2026-11-06T15:00:00.000Z', ended_at: '2026-11-06T15:12:00.000Z', workout_name: 'Thursday circuit' }
      ]
    });
    var landing = document.getElementById('landing');
    if (landing) landing.remove();
    document.documentElement.classList.add('wb-app');
    var app = document.getElementById('app');
    app.style.display = 'block';
    app.innerHTML =
      '<div id="history-shot">' + WBHistory.sessionHtml(view) + '</div>' +
      '<div id="dash-shot">' + WBDashboard.editorHtml(model, WBDashboard.STANDARD, { self: true }) + '</div>';
  });
  const text = await page.$eval('#history-shot', function (el) { return el.innerText; });
  assert.ok(text.indexOf('Group circuit') !== -1);
  assert.ok(text.indexOf('move') !== -1);
  assert.ok(text.indexOf(' rest') === -1);
  const dashText = await page.$eval('#dashboard-circuit', function (el) { return el.innerText; });
  assert.ok(/circuit/i.test(dashText));
  assert.ok(dashText.indexOf('0:40') !== -1);
  assert.ok(dashText.indexOf('Latest session') !== -1);
  await (await page.$('#history-shot')).screenshot({ path: path.join(OUT, 'history-circuit-card.png') });
  await (await page.$('#dashboard-circuit')).screenshot({ path: path.join(OUT, 'dashboard-circuit-card.png') });
  await browser.close();
  console.log('CIRCUIT HISTORY UI OK');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
