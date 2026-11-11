// Programs preview is sample-only and leaves the live workout list alone.
// node tests/preview-ui.test.js [url]
const assert = require('assert');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';

function workout(name) {
  const w = M.newWorkout(name);
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Curl', sets: 1, weight: { unit: 'lb', value: 20 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
  }))];
  return w;
}

(async () => {
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', function (err) { errors.push(String(err)); });
  page.on('dialog', function (dialog) { errors.push('dialog ' + dialog.message()); dialog.dismiss(); });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await require('./allow.js')(page);

  const data = M.emptyData();
  data.workouts.push(workout('Zebra Private'));
  await page.goto(URL);
  await page.evaluate(function (key, value) { localStorage.setItem(key, value); }, M.STORAGE_KEY, JSON.stringify(data));
  const before = await page.evaluate(function (key) { return localStorage.getItem(key); }, M.STORAGE_KEY);

  await page.goto(URL + '#/');
  await page.reload();
  await page.waitForSelector('[data-a=rename]');
  const live = await page.$eval('#app', function (el) { return el.innerText; });
  assert.ok(live.indexOf('Zebra Private') !== -1);
  assert.ok(live.indexOf('Rename') !== -1);
  assert.ok(live.indexOf('Duplicate') !== -1);
  assert.ok(live.indexOf('Delete') !== -1);
  assert.ok(live.indexOf('Run') !== -1);
  assert.ok(live.indexOf('Programs (preview)') !== -1);
  assert.strictEqual(await page.$('#pv-root'), null);

  await page.click('#programs-preview');
  await page.waitForSelector('#pv-root');
  assert.strictEqual(await page.$eval('#title', function (el) { return el.textContent; }), 'Programs');
  const home = await page.$eval('#pv-root', function (el) { return el.innerText; });
  assert.ok(home.indexOf('Sample: Push day') !== -1);
  assert.ok(home.indexOf('Zebra Private') === -1);
  assert.ok(home.indexOf('Workouts') !== -1 && home.indexOf('Programs') !== -1);
  const card = await page.$eval('.pv-wo', function (el) { return el.innerText; });
  assert.ok(card.indexOf('Run') !== -1 && card.indexOf('View') !== -1 && card.indexOf('Send') !== -1);
  assert.ok(!/\bRename\b/.test(card) && !/\bDuplicate\b/.test(card) && !/\bDelete\b/.test(card));
  assert.ok(await page.$('.pv-handle'));
  assert.ok(await page.$('#pv-ghost'));
  assert.ok(await page.$('.pv-ico.trainer'));
  assert.ok(await page.$('.pv-ico.solo'));
  assert.ok(await page.$('.pv-day[data-date="2026-11-09"] .pv-check'));
  assert.strictEqual(await page.$('.pv-day.today .pv-check'), null);
  const stacked = await page.$eval('#pv-layout', function (el) {
    const style = getComputedStyle(el).flexDirection;
    const workouts = el.querySelector('#pv-workouts').getBoundingClientRect();
    const cal = el.querySelector('#pv-cal').getBoundingClientRect();
    return style === 'column' && workouts.top < cal.top;
  });
  assert.ok(stacked, 'workouts sit above the calendar on a phone');

  await page.click('[data-cal=month]');
  await page.waitForSelector('.pv-month');
  assert.ok(await page.$('.pv-cell[data-jump="2026-11-02"] .pv-check'));
  await page.click('.pv-cell[data-jump="2026-11-11"]');
  await page.waitForSelector('.pv-week');
  assert.ok(await page.$('.pv-day[data-date="2026-11-11"]'));

  const handle = await page.$('.pv-day[data-date="2026-11-09"] .pv-handle');
  const from = await handle.boundingBox();
  const target = await page.$('.pv-day[data-date="2026-11-14"]');
  await target.scrollIntoView();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 70, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(function () {
    const day = document.querySelector('.pv-day[data-date="2026-11-14"]');
    return day && day.innerText.indexOf('Sample: Push day') !== -1;
  });
  assert.ok((await page.$eval('#pv-hint', function (el) { return el.textContent; })).indexOf('Nothing was saved') !== -1);

  await page.click('[data-view-wo="core"]');
  await page.waitForSelector('#pv-not-tracked');
  assert.strictEqual(await page.$eval('#pv-not-tracked', function (el) { return el.textContent; }), 'Preview - not tracked');
  await page.click('#back');
  await page.waitForSelector('#pv-root');

  await page.click('[data-open-wo="push"]');
  await page.waitForSelector('#pv-menu');
  assert.deepStrictEqual(await page.$$eval('#pv-menu button', function (nodes) {
    return nodes.map(function (node) { return node.textContent; });
  }), ['Rename', 'Duplicate', 'Delete']);
  await page.click('[data-menu=rename]');
  assert.ok((await page.$eval('#pv-menu-note', function (el) { return el.textContent; })).indexOf('Nothing was renamed') !== -1);
  await page.click('#back');

  await page.click('[data-send="run"]');
  await page.waitForSelector('#pv-send');
  assert.ok((await page.$eval('#pv-send', function (el) { return el.innerText; })).indexOf('No workout was sent') !== -1);
  await page.click('#back');

  await page.click('[data-role=client]');
  await page.waitForFunction(function () {
    return document.getElementById('pv-role-note') && document.getElementById('pv-role-note').innerText.indexOf('Your trainer schedules your program') !== -1;
  });
  assert.strictEqual(await page.$('.pv-handle'), null);
  assert.strictEqual(await page.$('[data-send]'), null);
  assert.ok(await page.$('.pv-ico.trainer'));
  await page.click('[data-open-session]');
  await page.waitForSelector('#pv-open');
  assert.strictEqual(await page.$('#pv-menu'), null);
  await page.click('#back');

  await page.click('[data-role=enthusiast]');
  await page.waitForSelector('#pv-trainer-edit');
  assert.strictEqual((await page.$eval('#pv-trainer-edit', function (el) { return el.innerText; })).trim(), 'Your trainer can also edit this calendar');
  assert.ok(await page.$('.pv-handle'));
  assert.strictEqual(await page.$('[data-send]'), null);
  await page.click('#pv-share');
  await page.waitForFunction(function () {
    const note = document.getElementById('pv-role-note');
    return note && note.innerText.indexOf('cannot see or edit this calendar') !== -1 && !document.getElementById('pv-trainer-edit');
  });
  assert.ok(await page.$('.pv-handle'), 'an enthusiast can still move their own program when sharing is off');
  await page.click('#pv-share');
  await page.waitForSelector('#pv-trainer-edit');

  await page.click('[data-role="trainer-share-on"]');
  await page.waitForFunction(function () {
    const note = document.getElementById('pv-role-note');
    const who = document.getElementById('pv-who');
    return note && note.innerText.indexOf('Sharing is on') !== -1 && who && who.innerText.indexOf('Jordan Hale') !== -1;
  });
  assert.ok(await page.$('.pv-handle'));
  assert.ok(await page.$('[data-send]'));

  await page.click('[data-role="trainer-share-off"]');
  await page.waitForSelector('#pv-private');
  const locked = await page.$eval('#pv-private', function (el) { return el.innerText; });
  assert.ok(locked.indexOf('cannot see or edit') !== -1);
  assert.strictEqual(await page.$('#pv-cal'), null);
  assert.strictEqual(await page.$('.pv-handle'), null);
  assert.strictEqual(await page.$('[data-send]'), null);

  await page.select('#pv-client', 'ada').catch(function () {});
  await page.click('[data-role=trainer]');
  await page.waitForSelector('#pv-cal');
  await page.select('#pv-client', 'sam');
  await page.waitForSelector('#pv-private');
  await page.select('#pv-client', 'jordan');
  await page.waitForSelector('#pv-cal');
  assert.ok((await page.$eval('#pv-role-note', function (el) { return el.innerText; })).indexOf('Sharing is on') !== -1);

  assert.strictEqual(await page.evaluate(function (key) { return localStorage.getItem(key); }, M.STORAGE_KEY), before);

  await page.setViewport({ width: 1280, height: 800 });
  await page.click('[data-role=trainer]');
  await page.waitForSelector('#pv-layout');
  const beside = await page.$eval('#pv-layout', function (el) {
    const style = getComputedStyle(el).flexDirection;
    const workouts = el.querySelector('#pv-workouts').getBoundingClientRect();
    const cal = el.querySelector('#pv-cal').getBoundingClientRect();
    return style === 'row' && workouts.left < cal.left && Math.abs(workouts.top - cal.top) < 80;
  });
  assert.ok(beside, 'workouts sit beside the calendar on a wide screen');

  await page.click('#back');
  await page.waitForSelector('[data-a=rename]');
  assert.ok((await page.$eval('#app', function (el) { return el.innerText; })).indexOf('Zebra Private') !== -1);
  assert.strictEqual(await page.evaluate(function (key) { return localStorage.getItem(key); }, M.STORAGE_KEY), before);

  const bare = await browser.newPage();
  bare.on('pageerror', function (err) { errors.push(String(err)); });
  await bare.goto(URL + '?preview=programs');
  await bare.waitForSelector('#pv-root');
  assert.strictEqual(await bare.evaluate(function () { return location.hash; }), '#/preview');
  assert.ok((await bare.evaluate(function () { return location.search; })).indexOf('preview=') === -1);
  await bare.goto(URL + '#/?preview=programs');
  await bare.waitForSelector('#pv-root');
  assert.strictEqual(await bare.evaluate(function () { return location.hash; }), '#/preview');

  assert.deepStrictEqual(errors, []);
  console.log('PREVIEW UI OK');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
