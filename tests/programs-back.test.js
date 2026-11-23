// Phone back from a Programs workout or day window stays on Programs.
// node tests/programs-back.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';

function workout(name) {
  const w = M.newWorkout(name);
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Press', sets: 2, weight: { unit: 'lb', value: 20 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 45 }
  }))];
  return w;
}

function today() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  const unexpected = [];
  const pending = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('dialog', async (dialog) => {
    const job = pending.shift();
    if (!job) {
      unexpected.push(dialog.message());
      await dialog.dismiss();
      return;
    }
    const message = dialog.message();
    if (job.answer === 'dismiss') await dialog.dismiss();
    else await dialog.accept();
    job.resolve(message);
  });
  function answerNext(answer) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('dialog timeout')), 8000);
      pending.push({
        answer: answer,
        resolve: (message) => { clearTimeout(timer); resolve(message); }
      });
    });
  }
  await require('./allow.js').stubAuth(page, {
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } },
    profile: {
      id: 'allow-test',
      email: 'kinisiathletics@gmail.com',
      membership: 'trainer',
      intended_plan: 'trainer',
      display_name: 'Alex'
    }
  });
  await page.evaluateOnNewDocument(() => {
    const desc = Object.getOwnPropertyDescriptor(window, 'WBAuth');
    if (!desc || !desc.set) return;
    const prev = desc.set;
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: desc.get,
      set: (value) => {
        prev(value);
        if (!value) return;
        value.roster = () => Promise.resolve({
          role: 'trainer',
          clients: [{ id: 'client-1', display_name: 'Sam', plan: 'Free Client' }]
        });
        value.clientStatus = () => Promise.resolve({ shared: true, enthusiast: false, linked: true });
        value.programEntries = () => Promise.resolve([]);
        value.shareSetting = () => Promise.resolve({ on: true });
        value.saveProgramEntry = () => Promise.resolve(true);
        value.deleteProgramEntry = () => Promise.resolve(true);
      }
    });
  });

  const lift = workout('Morning lift');
  const day = today();
  const data = M.emptyData();
  data.workouts.push(lift);
  data.programs = [
    {
      id: 'pg-own', ownerId: 'allow-test', workoutId: lift.id, workoutName: 'Morning lift',
      items: lift.items, date: day, presence: 'solo', start: '09:00', end: '10:00', updatedAt: 1
    },
    {
      id: 'pg-sam', ownerId: 'client-1', workoutId: lift.id, workoutName: 'Morning lift',
      items: lift.items, date: day, presence: 'solo', start: '09:00', end: '10:00', updatedAt: 1
    }
  ];

  async function boot() {
    await page.goto(URL + '#/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((key, value) => {
      const stored = JSON.parse(value);
      const now = new Date();
      const day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      stored.programs.forEach((row) => { row.date = day; });
      localStorage.setItem(key, JSON.stringify(stored));
    }, M.STORAGE_KEY, JSON.stringify(data));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#programs-open');
  }
  async function openPrograms() {
    await page.click('#programs-open');
    await page.waitForFunction(() => {
      const root = document.getElementById('pv-root');
      return root && !document.getElementById('pv-loading') && document.querySelector('.pv-day.today');
    });
    await page.evaluate(() => {
      const el = document.querySelector('.pv-day.today');
      if (el) el.scrollIntoView({ inline: 'center', block: 'center' });
    });
  }
  function sessions() {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)).sessions || [], M.STORAGE_KEY);
  }

  await boot();

  // Workouts-page player back is unchanged: no End prompt, returns to the list.
  await page.click('[data-a=run][data-id="' + lift.id + '"]');
  await page.waitForSelector('.pl-screen');
  assert.strictEqual(await page.evaluate(() => location.hash), '#/play/' + lift.id);
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => location.hash === '#/' || location.hash === '#');
  await page.waitForSelector('#programs-open');
  assert.strictEqual(await page.$('.pl-screen'), null);

  await openPrograms();
  // The calendar's own back arrow still leaves for Workouts.
  await page.click('#back');
  await page.waitForFunction(() => (location.hash === '#/' || location.hash === '#') && document.querySelector('[data-a=new]'));
  assert.strictEqual(await page.$('#pv-root'), null);

  await openPrograms();
  await page.select('#pv-client', '');
  await page.waitForFunction(() => {
    const sel = document.getElementById('pv-client');
    const today = document.querySelector('.pv-day.today');
    return sel && sel.value === '' && today && today.textContent.indexOf('Morning lift') !== -1 && today.textContent.indexOf('Sam') === -1;
  });
  await page.click('.pv-day.today .pv-day-h');
  await page.waitForSelector('#pv-day-sheet .pv-day-row');
  await page.click('#pv-day-sheet .pv-day-row');
  await page.waitForSelector('[data-run]');
  await page.click('[data-run]');
  await page.waitForSelector('.pl-screen');
  await page.click('[data-p=primary]');
  await page.waitForFunction(() => window.__wbPlayer && window.__wbPlayer.phase === 'rest' && window.__wbPlayer.running);
  const runningBefore = await page.evaluate(() => ({
    phase: window.__wbPlayer.phase,
    running: window.__wbPlayer.running,
    logged: window.__wbPlayer.results[0].logged,
    hash: location.hash
  }));
  assert.strictEqual(runningBefore.hash, '#/programs');
  assert.strictEqual(runningBefore.logged, true);

  const firstPrompt = answerNext('dismiss');
  await page.evaluate(() => history.back());
  assert.strictEqual(await firstPrompt, 'End workout? Logged sets will be saved.');
  await page.waitForFunction(() => window.__wbPlayer && window.__wbPlayer.phase === 'rest' && window.__wbPlayer.running && document.querySelector('.pl-screen'));
  const afterCancel = await page.evaluate(() => ({
    phase: window.__wbPlayer.phase,
    running: window.__wbPlayer.running,
    logged: window.__wbPlayer.results[0].logged,
    hash: location.hash,
    title: document.getElementById('title').textContent,
    trap: history.state && history.state.wbProgramsOverlay
  }));
  assert.deepStrictEqual({
    phase: afterCancel.phase,
    running: afterCancel.running,
    logged: afterCancel.logged,
    hash: afterCancel.hash,
    title: afterCancel.title,
    trap: afterCancel.trap
  }, {
    phase: 'rest',
    running: true,
    logged: true,
    hash: '#/programs',
    title: 'Programs',
    trap: 1
  });
  await page.screenshot({ path: path.join(ART, 'programs_back_still_playing.png') });

  const beforeSessions = await sessions();
  const secondPrompt = answerNext('accept');
  await page.evaluate(() => history.back());
  assert.strictEqual(await secondPrompt, 'End workout? Logged sets will be saved.');
  await page.waitForSelector('#pv-root');
  await page.waitForFunction(() => !document.querySelector('.pl-screen') && document.querySelector('.pv-day.today .pv-check'));
  const onPrograms = await page.evaluate(() => ({
    hash: location.hash,
    title: document.getElementById('title').textContent,
    sheet: !!document.getElementById('pv-sheet'),
    player: !!document.querySelector('.pl-screen'),
    trap: history.state && history.state.wbProgramsOverlay
  }));
  assert.deepStrictEqual(onPrograms, {
    hash: '#/programs',
    title: 'Programs',
    sheet: false,
    player: false,
    trap: null
  });
  const saved = (await sessions()).filter((row) => row.programId === 'pg-own');
  assert.strictEqual(beforeSessions.filter((row) => row.programId === 'pg-own').length, 0);
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].workoutName, 'Morning lift');
  assert.ok(saved[0].results.some((row) => row.logged && row.name === 'Press'));
  await page.evaluate(() => {
    const el = document.querySelector('.pv-day.today');
    if (el) el.scrollIntoView({ inline: 'center', block: 'center' });
  });
  await page.screenshot({ path: path.join(ART, 'programs_back_on_programs.png') });

  // Confirm consumed the overlay entry. One more back leaves Programs and does not reopen the player.
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => (location.hash === '#/' || location.hash === '#') && document.querySelector('[data-a=new]') && !document.querySelector('.pl-screen'));
  await page.screenshot({ path: path.join(ART, 'programs_back_returns_to_workouts.png') });

  // In-app End and the player back arrow still show the summary, then Done returns to Programs.
  await openPrograms();
  await page.click('.pv-day.today .pv-day-h');
  await page.waitForSelector('#pv-day-sheet .pv-day-row');
  await page.click('#pv-day-sheet .pv-day-row');
  await page.waitForSelector('[data-run]');
  await page.click('[data-run]');
  await page.waitForSelector('[data-p=end]');
  const endPrompt = answerNext('accept');
  // The header is hidden while the player is open; the same Back control still ends through requestEnd.
  await page.evaluate(() => document.getElementById('back').click());
  assert.strictEqual(await endPrompt, 'End workout? Logged sets will be saved.');
  await page.waitForSelector('[data-p=exit]');
  assert.strictEqual(await page.evaluate(() => location.hash), '#/programs');
  assert.strictEqual(await page.$('#pv-root'), null);
  await page.click('[data-p=exit]');
  await page.waitForSelector('#pv-root');
  await page.waitForFunction(() => !history.state || history.state.wbProgramsOverlay !== 1);
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => (location.hash === '#/' || location.hash === '#') && document.querySelector('[data-a=new]') && !document.querySelector('.pl-screen') && !document.getElementById('pv-day-sheet'));

  // Day window: month view and selected client survive browser back, and the entry does not linger.
  await openPrograms();
  await page.waitForSelector('#pv-client');
  await page.select('#pv-client', 'client-1');
  await page.waitForFunction(() => {
    const sel = document.getElementById('pv-client');
    const today = document.querySelector('.pv-day.today');
    return sel && sel.value === 'client-1' && today && today.textContent.indexOf('Morning lift') !== -1;
  });
  await page.click('[data-cal=month]');
  await page.waitForSelector('.pv-cell.today');
  await page.evaluate(() => document.querySelector('.pv-cell.today').scrollIntoView({ block: 'center' }));
  const beforeDay = await page.evaluate(() => ({
    hash: location.hash,
    range: document.getElementById('pv-range').textContent,
    client: document.getElementById('pv-client').value,
    monthOn: document.querySelector('[data-cal=month]').className
  }));
  await page.click('.pv-cell.today');
  await page.waitForSelector('#pv-day-sheet');
  assert.ok((await page.$eval('#pv-day-sheet', (el) => el.innerText)).indexOf('Morning lift') !== -1);
  assert.strictEqual(await page.evaluate(() => history.state && history.state.wbProgramsOverlay), 1);
  await page.screenshot({ path: path.join(ART, 'programs_day_window_open.png') });
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => !document.getElementById('pv-sheet') && document.querySelector('.pv-month'));
  const afterDay = await page.evaluate(() => ({
    hash: location.hash,
    range: document.getElementById('pv-range').textContent,
    client: document.getElementById('pv-client').value,
    monthOn: document.querySelector('[data-cal=month]').className,
    title: document.getElementById('title').textContent,
    trap: history.state && history.state.wbProgramsOverlay
  }));
  assert.deepStrictEqual(afterDay, {
    hash: '#/programs',
    range: beforeDay.range,
    client: 'client-1',
    monthOn: beforeDay.monthOn,
    title: 'Programs',
    trap: null
  });
  assert.strictEqual(beforeDay.hash, '#/programs');
  assert.ok((await page.$eval('#pv-client', (el) => el.options[el.selectedIndex].textContent)).indexOf('Sam') !== -1);
  await page.evaluate(() => {
    const el = document.getElementById('pv-client');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.screenshot({ path: path.join(ART, 'programs_day_same_client_month.png') });
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => (location.hash === '#/' || location.hash === '#') && document.querySelector('[data-a=new]') && !document.getElementById('pv-sheet'));

  // Closing the day window with the in-app backdrop also drops the history entry.
  await openPrograms();
  await page.click('.pv-day.today .pv-day-h');
  await page.waitForSelector('#pv-day-sheet');
  await page.evaluate(() => document.getElementById('pv-sheet').click());
  await page.waitForFunction(() => !document.getElementById('pv-sheet') && (!history.state || history.state.wbProgramsOverlay !== 1));
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => (location.hash === '#/' || location.hash === '#') && !document.getElementById('pv-day-sheet'));

  // View-only player: browser back closes it and stays on Programs, without the End prompt.
  await openPrograms();
  await page.click('.pv-day.today .pv-day-h');
  await page.waitForSelector('#pv-day-sheet .pv-day-row');
  await page.click('#pv-day-sheet .pv-day-row');
  await page.waitForSelector('[data-view-wo]');
  await page.click('[data-view-wo]');
  await page.waitForSelector('#pv-not-tracked');
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => document.getElementById('pv-root') && !document.querySelector('.pl-screen') && location.hash === '#/programs');

  assert.deepStrictEqual(unexpected, []);
  assert.deepStrictEqual(errors, []);
  console.log('PROGRAMS BACK OK');
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
