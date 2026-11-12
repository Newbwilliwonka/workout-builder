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
  try {
    const origin = String(URL).match(/^(https?:\/\/[^/]+)/i);
    const client = await page.createCDPSession();
    await client.send('Browser.grantPermissions', {
      origin: origin ? origin[1] : 'http://127.0.0.1:8787',
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
    });
  } catch (e) {}
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
  await page.waitForSelector('#pv-gcal-copy');
  await page.waitForSelector('#pv-gcal-link');
  const how = 'On a computer, open Google Calendar > Other calendars + > From URL, paste, and Add. It will sync to your phone.';
  const sheet = await page.evaluate(function () {
    var open = document.getElementById('pv-gcal-open');
    var copy = document.getElementById('pv-gcal-copy');
    var field = document.getElementById('pv-gcal-link');
    var openStyle = getComputedStyle(open);
    var copyStyle = getComputedStyle(copy);
    var fieldStyle = getComputedStyle(field);
    var href = open.getAttribute('href') || '';
    return {
      text: document.getElementById('pv-gcal-sheet').innerText.replace(/\s+/g, ' ').trim(),
      link: field.value,
      readonly: field.readOnly,
      href: href,
      how: document.getElementById('pv-gcal-how').textContent,
      openLabel: open.textContent,
      copyLabel: copy.textContent,
      copyBg: copyStyle.backgroundColor,
      copyColor: copyStyle.color,
      copyWeight: copyStyle.fontWeight,
      openBg: openStyle.backgroundColor,
      openColor: openStyle.color,
      fieldSize: fieldStyle.fontSize,
      fieldOverflow: fieldStyle.textOverflow,
      reset: document.getElementById('pv-gcal-reset').textContent,
      copyTop: copy.getBoundingClientRect().top,
      openTop: open.getBoundingClientRect().top,
      fieldTop: field.getBoundingClientRect().top
    };
  });
  assert.strictEqual(sheet.text, 'Add to Google Calendar Copy link ' + how + ' Open Google Calendar Reset link Close');
  assert.strictEqual(sheet.text.indexOf('New link ready'), -1);
  assert.strictEqual(sheet.text.indexOf('Tap Open Google Calendar'), -1);
  assert.strictEqual(sheet.text.indexOf("Couldn't create"), -1);
  assert.strictEqual(sheet.how, how);
  assert.strictEqual(sheet.copyLabel, 'Copy link');
  assert.strictEqual(sheet.openLabel, 'Open Google Calendar');
  assert.strictEqual(sheet.copyBg, 'rgb(37, 99, 235)');
  assert.strictEqual(sheet.copyColor, 'rgb(255, 255, 255)');
  assert.strictEqual(sheet.copyWeight, '600');
  assert.strictEqual(sheet.openBg, 'rgb(229, 231, 235)');
  assert.strictEqual(sheet.openColor, 'rgb(17, 24, 39)');
  assert.strictEqual(sheet.fieldSize, '12px');
  assert.strictEqual(sheet.fieldOverflow, 'ellipsis');
  assert.strictEqual(sheet.readonly, true);
  assert.ok(sheet.copyTop < sheet.fieldTop && sheet.fieldTop < sheet.openTop);
  assert.strictEqual(sheet.reset, 'Reset link');
  assert.ok(/^https:\/\/thyrgloermygnezfareg\.supabase\.co\/functions\/v1\/calendar-feed\/[0-9a-f]{64}\.ics$/.test(sheet.link));
  assert.strictEqual(sheet.link.indexOf('webcal'), -1);
  assert.strictEqual(sheet.href.indexOf('https://calendar.google.com/calendar/r?cid='), 0);
  assert.strictEqual(decodeURIComponent(sheet.href.split('cid=')[1]), sheet.link.replace('https://', 'webcal://'));
  if (shots) await page.screenshot({ path: path.join(shots, 'programs_google_calendar_link.png') });

  await page.click('#pv-gcal-copy');
  await page.waitForFunction(function () {
    var toast = document.getElementById('toast');
    return toast && toast.textContent === 'Link copied' && toast.classList.contains('show');
  });
  assert.strictEqual(await page.evaluate(function () { return navigator.clipboard.readText(); }), sheet.link);

  await page.evaluate(function () {
    var toast = document.getElementById('toast');
    toast.textContent = '';
    toast.classList.remove('show');
    navigator.clipboard.writeText = function () { return Promise.reject(new Error('denied')); };
  });
  await page.click('#pv-gcal-copy');
  await page.waitForFunction(function () {
    var field = document.getElementById('pv-gcal-link');
    return field && document.activeElement === field && field.selectionStart === 0 && field.selectionEnd === field.value.length;
  });
  assert.strictEqual(await page.evaluate(function () { return document.getElementById('toast').textContent; }), '');

  const first = sheet.link;
  await page.click('#pv-gcal-reset');
  await page.waitForFunction(function (previous) {
    var field = document.getElementById('pv-gcal-link');
    var open = document.getElementById('pv-gcal-open');
    if (!field || !open) return false;
    var href = open.getAttribute('href') || '';
    var fromHref = '';
    try { fromHref = decodeURIComponent(href.split('cid=')[1] || '').replace(/^webcal:\/\//, 'https://'); } catch (e) { return false; }
    var text = document.getElementById('pv-gcal-sheet').innerText;
    return field.value && field.value !== previous && field.value === fromHref && text.indexOf(previous) === -1 && text.indexOf('New link ready.') !== -1;
  }, {}, first);
  const afterReset = await page.evaluate(function () {
    return document.getElementById('pv-gcal-sheet').innerText.replace(/\s+/g, ' ').trim();
  });
  assert.strictEqual(afterReset, 'Add to Google Calendar New link ready. Copy link ' + how + ' Open Google Calendar Reset link Close');
  if (shots) await page.screenshot({ path: path.join(shots, 'programs_google_calendar_reset.png') });

  await page.click('[data-sheet=cancel]');
  await page.waitForFunction(function () { return !document.getElementById('pv-gcal-sheet'); });
  await page.click('[data-cal=month]');
  await page.waitForSelector('.pv-month');
  await page.click('[data-cal=week]');
  await page.waitForSelector('.pv-week');
  assert.strictEqual(errors.length, 0, errors.join('\n'));

  const signedOut = await browser.newPage();
  signedOut.on('pageerror', function (err) { errors.push(String(err)); });
  await signedOut.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await require('./allow.js').stubAuth(signedOut, { session: null, profile: null });
  await signedOut.goto(URL + '#/programs');
  await signedOut.waitForFunction(function () {
    return location.hash === '#/signin' && document.querySelector('h2') && document.querySelector('h2').textContent === 'Sign in';
  });
  assert.strictEqual(await signedOut.$('#pv-gcal, .pv-week, .pv-month'), null);
  if (shots) await signedOut.screenshot({ path: path.join(shots, 'signed_out_programs.png') });
  await signedOut.goto(URL + '?invite=ABCD2345#/signin');
  await signedOut.waitForSelector('#invite-code');
  assert.strictEqual(await signedOut.$eval('#invite-code', function (el) { return el.value; }), 'ABCD-2345');
  await signedOut.click('[data-auth=switch]');
  await signedOut.waitForFunction(function () {
    return location.hash === '#/join' && document.querySelector('h2') && document.querySelector('h2').textContent === 'Create your account';
  });
  await signedOut.goto(URL + '#/subscriptions');
  await signedOut.waitForFunction(function () {
    return location.hash === '#/subscriptions' && document.body.innerText.indexOf('Choose how you want to train') !== -1;
  });
  assert.strictEqual(await signedOut.$('[data-a=new], #pv-gcal'), null);

  assert.strictEqual(errors.length, 0, errors.join('\n'));
  await browser.close();
  console.log('calendar ui ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
