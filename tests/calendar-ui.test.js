// Programs page: Add to Google Calendar. node tests/calendar-ui.test.js [url]
const assert = require('assert');
const path = require('path');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const shots = process.argv[3] || '';

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
  await page.evaluateOnNewDocument(function (extra) {
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
        value.programEntries = function () { return Promise.resolve([]); };
        value.saveProgramEntry = function () { return Promise.resolve(true); };
        value.deleteProgramEntry = function () { return Promise.resolve(true); };
        value.shareSetting = function () { return Promise.resolve(extra.share); };
        value.roster = function () { return Promise.resolve(extra.roster); };
        value.clientStatus = function () { return Promise.resolve({ shared: false, enthusiast: false, linked: false }); };
        value.calendarFeed = function () {
          var err = new Error('The calendar link is saved on this device until the calendar feed SQL is applied.');
          err.local = true;
          return Promise.reject(err);
        };
        value.resetCalendarFeed = value.calendarFeed;
      }
    });
  }, extra);
}

(async () => {
  const browser = await pp.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', function (err) { errors.push(String(err)); });
  page.on('dialog', function (dialog) {
    if (dialog.message().indexOf('Make a new link') !== -1) { dialog.accept(); return; }
    errors.push('dialog ' + dialog.message());
    dialog.dismiss();
  });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const context = browser.defaultBrowserContext();
  try { await context.overridePermissions(URL, ['clipboard-read', 'clipboard-write']); } catch (e) {}
  const base = M.emptyData();
  base.workouts.push(workout('Morning lift'));
  await stub(page, {
    profile: { id: 'allow-test', email: 'kinisiathletics@gmail.com', membership: 'enthusiast', intended_plan: 'enthusiast' },
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } },
    share: { on: false, enthusiast: true, linked: false },
    roster: { role: null, clients: [] }
  });
  await page.goto(URL);
  await page.evaluate(function (key, value) {
    const data = JSON.parse(value);
    const now = new Date();
    const day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    data.programs = [{
      id: 'pg1', ownerId: 'allow-test', workoutId: data.workouts[0].id, workoutName: 'Morning lift',
      items: data.workouts[0].items, date: day, presence: 'solo', start: '09:00', end: '10:30', updatedAt: Date.now()
    }];
    localStorage.setItem(key, JSON.stringify(data));
  }, M.STORAGE_KEY, JSON.stringify(base));
  await page.reload();
  await page.waitForSelector('#programs-open');
  await page.click('#programs-open');
  await page.waitForSelector('#pv-gcal');
  await page.waitForFunction(function () {
    return document.querySelector('[data-cal=week]') && document.querySelector('[data-cal=month]');
  });
  const near = await page.evaluate(function () {
    document.querySelector('.pv-views').scrollIntoView({ block: 'start' });
    window.scrollBy(0, -64);
    var week = document.querySelector('[data-cal=week]').getBoundingClientRect();
    var month = document.querySelector('[data-cal=month]').getBoundingClientRect();
    var btn = document.getElementById('pv-gcal').getBoundingClientRect();
    return {
      label: document.getElementById('pv-gcal').textContent,
      weekTop: week.top,
      monthTop: month.top,
      btnTop: btn.top,
      gap: btn.top - Math.max(week.bottom, month.bottom),
      weekVisible: week.top >= 0 && week.bottom <= window.innerHeight,
      btnVisible: btn.top >= 0 && btn.bottom <= window.innerHeight,
      monthVisible: month.top >= 0 && month.bottom <= window.innerHeight
    };
  });
  assert.strictEqual(near.label, 'Add to Google Calendar');
  assert.ok(near.weekVisible && near.monthVisible && near.btnVisible, JSON.stringify(near));
  assert.ok(near.gap >= -4 && near.gap < 48, JSON.stringify(near));
  if (shots) await page.screenshot({ path: path.join(shots, 'programs_google_calendar_button.png') });

  await page.click('#pv-gcal');
  await page.waitForSelector('#pv-gcal-link');
  const sheet = await page.evaluate(function () {
    var link = document.getElementById('pv-gcal-link').textContent;
    var open = document.getElementById('pv-gcal-open');
    return {
      text: document.getElementById('pv-gcal-sheet').innerText,
      link: link,
      href: open.getAttribute('href'),
      openLabel: open.textContent,
      copy: document.getElementById('pv-gcal-copy').textContent,
      reset: document.getElementById('pv-gcal-reset').textContent
    };
  });
  assert.ok(sheet.text.indexOf('Copy this link, or tap Open Google Calendar') !== -1);
  assert.ok(sheet.text.indexOf('Google refreshes it every few hours') !== -1);
  assert.ok(sheet.text.indexOf('Saved on this device for now') !== -1);
  assert.ok(sheet.text.indexOf('this same link will start updating Google Calendar') !== -1);
  assert.strictEqual(sheet.copy, 'Copy');
  assert.strictEqual(sheet.openLabel, 'Open Google Calendar');
  assert.strictEqual(sheet.reset, 'Reset link');
  assert.ok(/^https:\/\/thyrgloermygnezfareg\.supabase\.co\/functions\/v1\/calendar-feed\/[0-9a-f]{64}\.ics$/.test(sheet.link));
  assert.strictEqual(sheet.href.indexOf('https://calendar.google.com/calendar/r?cid='), 0);
  assert.strictEqual(decodeURIComponent(sheet.href.split('cid=')[1]), sheet.link.replace('https://', 'webcal://'));
  if (shots) await page.screenshot({ path: path.join(shots, 'programs_google_calendar_link.png') });

  await page.click('#pv-gcal-copy');
  await page.waitForFunction(function () {
    return document.getElementById('pv-gcal-copy') && document.getElementById('pv-gcal-copy').textContent === 'Copied';
  });
  const first = sheet.link;
  await page.click('#pv-gcal-reset');
  await page.waitForFunction(function (previous) {
    var el = document.getElementById('pv-gcal-link');
    var note = document.getElementById('pv-gcal-note');
    return el && el.textContent !== previous && note && note.textContent.indexOf('new link') !== -1;
  }, {}, first);

  await page.click('[data-sheet=cancel]');
  await page.waitForFunction(function () { return !document.getElementById('pv-gcal-sheet'); });
  await page.click('[data-cal=month]');
  await page.waitForSelector('.pv-month');
  await page.click('[data-cal=week]');
  await page.waitForSelector('.pv-week');
  assert.strictEqual(errors.length, 0, errors.join('\n'));
  await browser.close();
  console.log('calendar ui ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
