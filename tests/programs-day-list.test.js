// Day window lists workouts, then opens one. Phone back returns to the list.
// node tests/programs-day-list.test.js [url]
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
    name: 'Press', sets: 1, weight: { unit: 'lb', value: 20 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
  }))];
  return w;
}

async function stub(page, extra) {
  await require('./allow.js').stubAuth(page, { profile: extra.profile, session: extra.session });
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
        value.shareSetting = function () { return Promise.resolve({ on: true, enthusiast: true, linked: true }); };
        value.programEntries = function () { return Promise.resolve([]); };
        value.saveProgramEntry = function () { return Promise.resolve(true); };
        value.deleteProgramEntry = function () { return Promise.resolve(true); };
        value.roster = function () { return Promise.resolve({ role: null, clients: [] }); };
        value.clientStatus = function () { return Promise.resolve({ shared: false, enthusiast: false, linked: false }); };
      }
    });
  });
}

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  const morning = workout('Morning lift');
  const midday = workout('Midday core');
  const evening = workout('Evening strength');
  const base = M.emptyData();
  base.workouts.push(morning, midday, evening);
  base.programs = [
    {
      id: 'pg-eve', ownerId: 'allow-test', workoutId: evening.id, workoutName: 'Evening strength',
      items: evening.items, date: 'TODAY', presence: 'trainer', start: '15:00', end: '16:15', updatedAt: 3
    },
    {
      id: 'pg-am', ownerId: 'allow-test', workoutId: morning.id, workoutName: 'Morning lift',
      items: morning.items, date: 'TODAY', presence: 'solo', start: '07:00', end: '08:00', updatedAt: 1
    },
    {
      id: 'pg-mid', ownerId: 'allow-test', workoutId: midday.id, workoutName: 'Midday core',
      items: midday.items, date: 'TODAY', presence: 'solo', start: '11:30', end: '12:00', updatedAt: 2
    }
  ];
  base.sessions = [{
    id: 'ses-am', workoutId: morning.id, workoutName: 'Morning lift', programId: 'pg-am',
    startedAt: Date.now() - 1000, endedAt: Date.now(), results: [{ logged: true, name: 'Press' }]
  }];

  const phone = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const editor = await browser.newPage();
  editor.on('pageerror', function (err) { errors.push(String(err)); });
  await editor.setViewport(phone);
  await stub(editor, {
    profile: { id: 'allow-test', email: 'kinisiathletics@gmail.com', membership: 'enthusiast', intended_plan: 'enthusiast' },
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } }
  });

  async function boot(page) {
    await page.goto(URL + '#/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(function (key, value) {
      var data = JSON.parse(value);
      var now = new Date();
      var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      data.programs.forEach(function (row) { row.date = day; });
      data.sessions.forEach(function (row) { row.endedAt = Date.now(); row.startedAt = Date.now() - 1000; });
      localStorage.setItem(key, JSON.stringify(data));
    }, M.STORAGE_KEY, JSON.stringify(base));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#programs-open');
    await page.click('#programs-open');
    await page.waitForFunction(function () {
      var root = document.getElementById('pv-root');
      return root && !document.getElementById('pv-loading') && document.querySelector('.pv-day.today');
    });
  }
  async function rows(page) {
    return page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('#pv-day-sheet .pv-day-row'), function (row) {
        var when = row.querySelector('.pv-when');
        var ico = row.querySelector('.pv-ico');
        var client = row.querySelector('.pv-row-client');
        return {
          name: row.querySelector('.name').textContent,
          when: when ? when.textContent : '',
          kind: ico && ico.classList.contains('trainer') ? 'trainer' : 'solo',
          done: !!row.querySelector('.pv-check'),
          client: client ? client.textContent : null,
          slot: !!(client && client.getAttribute('data-client-slot') === '1')
        };
      });
    });
  }
  const expected = [
    { name: 'Morning lift', when: '7:00–8:00 AM', kind: 'solo', done: true, client: '', slot: true },
    { name: 'Midday core', when: '11:30 AM–12:00 PM', kind: 'solo', done: false, client: '', slot: true },
    { name: 'Evening strength', when: '3:00–4:15 PM', kind: 'trainer', done: false, client: '', slot: true }
  ];
  async function openToday(page) {
    await page.evaluate(function () {
      var el = document.querySelector('.pv-day.today');
      if (el) el.scrollIntoView({ inline: 'center', block: 'center' });
    });
    await page.click('.pv-day.today .pv-day-h');
    await page.waitForSelector('#pv-day-sheet .pv-day-row');
  }

  await boot(editor);
  await openToday(editor);
  assert.deepStrictEqual(await rows(editor), expected);
  assert.strictEqual(await editor.$eval('[data-sheet=add-day]', function (el) { return el.textContent; }), 'Add workout');
  assert.strictEqual(await editor.$('#pv-day-sheet [data-time]'), null);
  assert.strictEqual(await editor.$('#pv-day-sheet .pv-presence'), null);
  assert.ok((await editor.$eval('#pv-day-sheet h3', function (el) { return el.textContent; })).length > 0);
  assert.strictEqual(await editor.evaluate(function () { return history.state && history.state.wbProgramsOverlay; }), 1);
  await editor.screenshot({ path: path.join(ART, 'programs_day_list_three.png') });

  await editor.evaluate(function () {
    var rows = document.querySelectorAll('#pv-day-sheet .pv-day-row');
    rows[1].click();
  });
  await editor.waitForSelector('#pv-day-sheet [data-time="start"]');
  const one = await editor.evaluate(function () {
    return {
      title: document.querySelector('#pv-day-sheet h3').textContent,
      buttons: Array.prototype.map.call(document.querySelectorAll('#pv-day-sheet button'), function (node) { return node.textContent; }),
      start: document.querySelector('#pv-day-sheet [data-time="start"]').value,
      end: document.querySelector('#pv-day-sheet [data-time="end"]').value,
      solo: document.querySelector('#pv-day-sheet .pv-presence input[value="solo"]').checked,
      rows: document.querySelectorAll('.pv-day-row').length,
      add: !!document.querySelector('[data-sheet=add-day]'),
      text: document.getElementById('pv-day-sheet').innerText
    };
  });
  assert.strictEqual(one.title, 'Midday core');
  assert.deepStrictEqual(one.buttons, ['Run', 'View', 'Save times', 'Remove workout']);
  assert.strictEqual(one.start, '11:30');
  assert.strictEqual(one.end, '12:00');
  assert.strictEqual(one.solo, true);
  assert.strictEqual(one.rows, 0);
  assert.strictEqual(one.add, false);
  assert.strictEqual(one.text.indexOf('Morning lift'), -1);
  assert.strictEqual(one.text.indexOf('Evening strength'), -1);
  assert.strictEqual(await editor.evaluate(function () { return history.state && history.state.wbProgramsOverlay; }), 1);
  await editor.screenshot({ path: path.join(ART, 'programs_day_one_workout.png') });

  await editor.evaluate(function () { history.back(); });
  await editor.waitForFunction(function () { return document.querySelectorAll('#pv-day-sheet .pv-day-row').length === 3 && !document.querySelector('[data-time]'); });
  assert.deepStrictEqual(await rows(editor), expected);
  assert.strictEqual(await editor.evaluate(function () { return location.hash; }), '#/programs');
  assert.strictEqual(await editor.evaluate(function () { return history.state && history.state.wbProgramsOverlay; }), 1);
  await editor.evaluate(function () { history.back(); });
  await editor.waitForFunction(function () {
    return !document.getElementById('pv-sheet') && location.hash === '#/programs' && document.getElementById('pv-cal');
  });
  assert.strictEqual(await editor.evaluate(function () { return history.state && history.state.wbProgramsOverlay; }), null);

  await openToday(editor);
  await editor.evaluate(function () { document.querySelectorAll('#pv-day-sheet .pv-day-row')[2].click(); });
  await editor.waitForFunction(function () { return document.querySelector('#pv-day-sheet h3') && document.querySelector('#pv-day-sheet h3').textContent === 'Evening strength'; });
  await editor.click('#back');
  await editor.waitForFunction(function () { return document.querySelectorAll('#pv-day-sheet .pv-day-row').length === 3; });
  assert.strictEqual(await editor.evaluate(function () { return location.hash; }), '#/programs');
  await editor.click('#back');
  await editor.waitForFunction(function () {
    return !document.getElementById('pv-sheet') && location.hash === '#/programs' && document.querySelector('.pv-week');
  });

  await editor.evaluate(function () {
    var el = document.querySelector('[data-cal=month]');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await editor.click('[data-cal=month]');
  await editor.waitForSelector('.pv-cell.today');
  await editor.evaluate(function () { document.querySelector('.pv-cell.today').scrollIntoView({ block: 'center' }); });
  await editor.click('.pv-cell.today');
  await editor.waitForSelector('#pv-day-sheet .pv-day-row');
  assert.deepStrictEqual(await rows(editor), expected);
  assert.ok(await editor.$('.pv-month'));
  await editor.evaluate(function () { document.querySelector('#pv-day-sheet .pv-day-row').click(); });
  await editor.waitForSelector('[data-run]');
  await editor.evaluate(function () { history.back(); });
  await editor.waitForFunction(function () { return document.querySelectorAll('.pv-day-row').length === 3 && document.querySelector('.pv-month'); });
  await editor.click('#back');
  await editor.waitForFunction(function () {
    return !document.getElementById('pv-sheet') && document.querySelector('.pv-month') && location.hash === '#/programs';
  });

  await editor.evaluate(function () {
    var el = document.querySelector('[data-cal=week]');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await editor.click('[data-cal=week]');
  await editor.waitForSelector('.pv-day:not(.today)');
  await editor.click('.pv-day:not(.today) .pv-day-h');
  await editor.waitForSelector('#pv-empty-day');
  assert.strictEqual(await editor.$eval('#pv-empty-day', function (el) { return el.textContent; }), 'No workouts scheduled');
  assert.strictEqual(await editor.$('.pv-day-row'), null);
  assert.ok(await editor.$('[data-sheet=add-day]'));
  await editor.screenshot({ path: path.join(ART, 'programs_day_empty.png') });
  await editor.click('[data-sheet=add-day]');
  await editor.waitForSelector('#pv-start-h');
  assert.strictEqual(await editor.$('#pv-empty-day'), null);
  await editor.click('#back');
  await editor.waitForSelector('#pv-empty-day');
  assert.strictEqual(await editor.$('#pv-start-h'), null);
  await editor.evaluate(function () { history.back(); });
  await editor.waitForFunction(function () { return !document.getElementById('pv-sheet') && location.hash === '#/programs'; });

  const client = await browser.newPage();
  client.on('pageerror', function (err) { errors.push(String(err)); });
  await client.setViewport(phone);
  await stub(client, {
    profile: { id: 'allow-test', email: 'kinisiathletics@gmail.com', membership: 'free_client', intended_plan: 'free_client' },
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } }
  });
  await boot(client);
  await openToday(client);
  assert.deepStrictEqual(await rows(client), expected);
  assert.strictEqual(await client.$('[data-sheet=add-day]'), null);
  assert.strictEqual(await client.$('#pv-day-sheet .pv-presence'), null);
  assert.ok((await client.$eval('#pv-role-note', function (el) { return el.innerText; })).indexOf('Your trainer schedules your program') !== -1);
  await client.screenshot({ path: path.join(ART, 'programs_day_client.png') });
  await client.evaluate(function () { document.querySelectorAll('#pv-day-sheet .pv-day-row')[0].click(); });
  await client.waitForSelector('[data-view-wo]');
  const clientOne = await client.evaluate(function () {
    return {
      buttons: Array.prototype.map.call(document.querySelectorAll('#pv-day-sheet button'), function (node) { return node.textContent; }),
      presence: !!document.querySelector('#pv-day-sheet .pv-presence'),
      times: document.querySelectorAll('#pv-day-sheet input[data-time]').length,
      add: !!document.querySelector('[data-sheet=add-day]'),
      when: document.querySelector('#pv-day-sheet .pv-when').textContent
    };
  });
  assert.deepStrictEqual(clientOne.buttons, ['Run', 'View']);
  assert.strictEqual(clientOne.presence, false);
  assert.strictEqual(clientOne.times, 0);
  assert.strictEqual(clientOne.add, false);
  assert.strictEqual(clientOne.when, '7:00–8:00 AM');
  await client.click('#back');
  await client.waitForFunction(function () { return document.querySelectorAll('.pv-day-row').length === 3; });
  await client.click('#back');
  await client.waitForFunction(function () { return !document.getElementById('pv-sheet') && location.hash === '#/programs'; });
  await client.evaluate(function () {
    var el = document.querySelector('[data-cal=month]');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await client.click('[data-cal=month]');
  await client.waitForSelector('.pv-cell:not(.today):not(.is-out)');
  await client.evaluate(function () {
    document.querySelector('.pv-cell:not(.today):not(.is-out)').scrollIntoView({ block: 'center' });
  });
  await client.click('.pv-cell:not(.today):not(.is-out)');
  await client.waitForSelector('#pv-empty-day');
  assert.strictEqual(await client.$eval('#pv-empty-day', function (el) { return el.textContent; }), 'No workouts scheduled');
  assert.strictEqual(await client.$('[data-sheet=add-day]'), null);
  await client.evaluate(function () { history.back(); });
  await client.waitForFunction(function () {
    return !document.getElementById('pv-sheet') && document.querySelector('.pv-month') && location.hash === '#/programs';
  });

  assert.deepStrictEqual(errors, []);
  console.log('PROGRAMS DAY LIST OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
