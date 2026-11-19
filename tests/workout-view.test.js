// Workouts list View opens the same view-only player as the calendar.
// node tests/workout-view.test.js [url]
const assert = require('assert');
const fs = require('fs');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';

const mk = o => M.normalizeExercise(M.newExercise(o));
const normal = M.newWorkout('Morning lift');
normal.items = [mk({
  name: 'Curl', sets: 2, weight: { unit: 'lb', value: 20 },
  mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
})];
const locked = M.newWorkout('Friday from coach');
locked.sourceTrainerId = 'tr-coach';
locked.sourceTrainerName = 'Coach';
locked.items = [mk({
  name: 'Squat', sets: 2, weight: { unit: 'lb', value: 40 },
  mode: 'reps', modeConfig: { repsType: 'number', count: 6, restSec: 30 }
})];
const blank = M.newWorkout('Blank numbers');
blank.items = [mk({
  name: 'Oops', sets: 3, weight: { unit: 'lb', value: 10 },
  mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
})];
blank.items[0].modeConfig.count = null;
const emptySets = M.newWorkout('No set count');
emptySets.items = [mk({
  name: 'Missing sets', sets: 1, weight: { unit: 'lb', value: 5 },
  mode: 'reps', modeConfig: { repsType: 'number', count: 5, restSec: 0 }
})];
emptySets.items[0].sets = null;
const empty = M.newWorkout('Empty');
const data = M.emptyData();
data.sessions = [{ id: 'ses_keep', workoutId: normal.id, workoutName: normal.name, startedAt: 1, endedAt: 2, results: [] }];
data.workouts.push(normal, locked, blank, emptySets, empty);

function actionsFor(id) {
  return Array.prototype.map.call(document.querySelectorAll('.actions [data-id="' + id + '"]'), function (el) {
    return {
      action: el.getAttribute('data-a'),
      text: el.textContent,
      disabled: el.disabled,
      className: el.className
    };
  });
}

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await require('./allow.js').stubAuth(p, {
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } },
    profile: {
      id: 'allow-test',
      email: 'kinisiathletics@gmail.com',
      membership: 'trainer',
      intended_plan: 'trainer',
      display_name: 'Alex'
    }
  });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('dialog', d => d.accept());
  await p.goto(URL);
  await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  await p.goto(URL + '#/');
  await p.reload();
  await p.waitForSelector('[data-a=view][data-id="' + normal.id + '"]');

  const normalActions = await p.evaluate(actionsFor, normal.id);
  assert.deepStrictEqual(normalActions.map(a => a.action), ['wup', 'wdown', 'open', 'run', 'view', 'dup', 'del']);
  assert.deepStrictEqual(normalActions.map(a => a.text), ['▲', '▼', 'Open', 'Run', 'View', 'Duplicate', 'Delete']);
  const viewBtn = normalActions.filter(a => a.action === 'view')[0];
  const runBtn = normalActions.filter(a => a.action === 'run')[0];
  assert.strictEqual(viewBtn.className, runBtn.className);
  assert.strictEqual(viewBtn.className, 'sm');
  assert.strictEqual(viewBtn.disabled, false);

  const lockedActions = await p.evaluate(actionsFor, locked.id);
  assert.deepStrictEqual(lockedActions.map(a => a.text), ['Open', 'Run', 'View']);
  assert.strictEqual(lockedActions.filter(a => a.action === 'view')[0].disabled, false);
  assert.ok((await p.evaluate(function (id) {
    var name = document.querySelector('.name[data-id="' + id + '"]');
    return name && name.parentElement ? name.parentElement.innerText : '';
  }, locked.id)).indexOf('You can run it') !== -1);

  const blankActions = await p.evaluate(actionsFor, blank.id);
  assert.strictEqual(blankActions.filter(a => a.action === 'run')[0].disabled, false);
  assert.strictEqual(blankActions.filter(a => a.action === 'view')[0].disabled, false);
  const emptySetActions = await p.evaluate(actionsFor, emptySets.id);
  assert.strictEqual(emptySetActions.filter(a => a.action === 'view')[0].disabled, false);
  const emptyActions = await p.evaluate(actionsFor, empty.id);
  assert.strictEqual(emptyActions.filter(a => a.action === 'run')[0].disabled, true);
  assert.strictEqual(emptyActions.filter(a => a.action === 'view')[0].disabled, true);

  await p.screenshot({ path: ART + '/workouts-view-list.png', fullPage: true });

  async function savedSessions() {
    return p.evaluate(function (key) {
      return JSON.parse(localStorage.getItem(key)).sessions;
    }, M.STORAGE_KEY);
  }
  const before = await savedSessions();

  await p.click('[data-a=view][data-id="' + blank.id + '"]');
  await p.waitForSelector('#pv-not-tracked');
  assert.strictEqual(await p.evaluate(() => location.hash), '#/view/' + blank.id);
  assert.strictEqual(await p.$eval('#pv-not-tracked', el => el.textContent), 'Preview - not tracked');
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.track), false);
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.programId), null);
  assert.strictEqual(await p.$eval('.pl-info .pl-name', el => el.textContent), 'Oops');
  assert.deepStrictEqual(await savedSessions(), before);
  assert.strictEqual(await p.evaluate(function (id) {
    var row = JSON.parse(localStorage.getItem('wb.data.v1')).workouts.filter(function (w) { return w.id === id; })[0];
    return row.items[0].modeConfig.count;
  }, blank.id), null);

  await p.evaluate(function () { document.getElementById('back').click(); });
  await p.waitForSelector('[data-a=view][data-id="' + normal.id + '"]');
  assert.ok(!/\/view\//.test(await p.evaluate(() => location.hash)));
  assert.deepStrictEqual(await savedSessions(), before);

  await p.click('[data-a=view][data-id="' + locked.id + '"]');
  await p.waitForSelector('#pv-not-tracked');
  assert.strictEqual(await p.evaluate(() => location.hash), '#/view/' + locked.id);
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.track), false);
  assert.strictEqual(await p.$eval('.pl-info .pl-name', el => el.textContent), 'Squat');
  await p.screenshot({ path: ART + '/workouts-view-player.png' });
  await p.evaluate(function () { history.back(); });
  await p.waitForSelector('[data-a=view][data-id="' + locked.id + '"]');
  assert.ok(!/\/view\//.test(await p.evaluate(() => location.hash)));
  assert.deepStrictEqual(await savedSessions(), before);

  await p.goto(URL + '#/view/' + normal.id);
  await p.reload();
  await p.waitForSelector('.pl-screen');
  await p.waitForSelector('#pv-not-tracked');
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.track), false);
  assert.strictEqual(await p.$eval('.pl-info .pl-name', el => el.textContent), 'Curl');
  await p.evaluate(function () { document.querySelector('[data-p=end]').click(); });
  await p.waitForSelector('[data-a=view][data-id="' + normal.id + '"]');
  assert.strictEqual(await p.evaluate(() => location.hash), '#/');
  assert.deepStrictEqual(await savedSessions(), before);

  await p.goto(URL + '#/view/' + emptySets.id);
  await p.reload();
  await p.waitForSelector('#pv-not-tracked');
  assert.strictEqual(await p.evaluate(() => window.__wbPlayer.track), false);
  assert.strictEqual(await p.$eval('.pl-info .pl-name', el => el.textContent), 'Missing sets');
  assert.deepStrictEqual(await savedSessions(), before);
  const storedSets = await p.evaluate(function (id) {
    var row = JSON.parse(localStorage.getItem('wb.data.v1')).workouts.filter(function (w) { return w.id === id; })[0];
    return row.items[0].sets;
  }, emptySets.id);
  assert.strictEqual(storedSets, null);

  await p.goto(URL + '#/');
  await p.reload();
  await p.waitForSelector('[data-a=run][data-id="' + blank.id + '"]');
  await p.click('[data-a=run][data-id="' + blank.id + '"]');
  await p.waitForFunction(function () {
    return document.getElementById('toast').textContent.indexOf('Fill in every number') !== -1;
  });
  assert.strictEqual(await p.$('.pl-screen'), null);
  assert.ok(!/\/(play|view)\//.test(await p.evaluate(() => location.hash)));

  await p.goto(URL + '#/view/' + empty.id);
  await p.reload();
  await p.waitForFunction(function () { return location.hash === '#/' || location.hash === '#'; });
  assert.strictEqual(await p.$('.pl-screen'), null);

  assert.deepStrictEqual(errs, []);
  console.log('WORKOUT VIEW OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
