// Programs page: Add to Google Calendar. node tests/calendar-ui.test.js [url]
const assert = require('assert');
const path = require('path');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const shots = process.argv[3] || '';

const PHONE_NOTE = 'Google\'s phone app can\'t add calendar links. Do it once on a computer: sign in at coachtrainerapp.com, tap Add to Google Calendar there, and it will sync to this phone on its own.';
const CONFIRM_BODY = 'Your current link will stop working, and anyone who has it will no longer see your schedule. You\'ll need to add it to Google Calendar again on a computer.';
const FAIL_NOTE = 'Couldn\'t create your calendar link. Please try again.';
const FEED_RE = /^https:\/\/thyrgloermygnezfareg\.supabase\.co\/functions\/v1\/calendar-feed\/[0-9a-f]{64}\.ics$/;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SHARE_TITLE = 'My workout calendar link';
const SHARE_TEXT = 'Open this on a computer to add my workouts to Google Calendar';

function workout(name) {
  const w = M.newWorkout(name);
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Press', sets: 1, weight: { unit: 'lb', value: 20 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
  }))];
  return w;
}

function enthusiast() {
  return {
    profile: { id: 'allow-test', email: 'kinisiathletics@gmail.com', membership: 'enthusiast', intended_plan: 'enthusiast' },
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } },
    share: { on: false, enthusiast: true, linked: false },
    roster: { role: null, clients: [] }
  };
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
          if (extra.feed === 'hang') return new Promise(function () {});
          if (extra.feed === 'error') return Promise.reject(new Error('down'));
          var err = new Error('The calendar link is saved on this device until the calendar feed SQL is applied.');
          err.local = true;
          return Promise.reject(err);
        };
        value.resetCalendarFeed = value.calendarFeed;
      }
    });
  }, extra);
}

async function grantClipboard(page) {
  const context = page.browser().defaultBrowserContext();
  try { await context.overridePermissions(URL, ['clipboard-read', 'clipboard-write']); } catch (e) {}
  try {
    const origin = String(URL).match(/^(https?:\/\/[^/]+)/i);
    const client = await page.createCDPSession();
    await client.send('Browser.grantPermissions', {
      origin: origin ? origin[1] : 'http://127.0.0.1:8787',
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
    });
  } catch (e) {}
}

async function openPrograms(page) {
  const base = M.emptyData();
  base.workouts.push(workout('Morning lift'));
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
}

async function storedFeed(page) {
  return page.evaluate(function () {
    var bag = JSON.parse(localStorage.getItem('wb.calendarFeed.v1') || '{}');
    var row = bag['allow-test'];
    return row && window.WBCalendar ? WBCalendar.feedUrl(row.token) : '';
  });
}

async function sheetText(page) {
  return page.evaluate(function () {
    return document.getElementById('pv-gcal-sheet').innerText.replace(/\s+/g, ' ').trim();
  });
}

async function priBox(page, id) {
  return page.evaluate(function (id) {
    var el = document.getElementById(id);
    var close = document.querySelector('#pv-gcal-sheet [data-sheet=cancel]');
    var style = getComputedStyle(el);
    var width = el.getBoundingClientRect().width;
    var closeWidth = close.getBoundingClientRect().width;
    return {
      tag: el.tagName,
      cls: el.className,
      label: el.textContent,
      disabled: !!el.disabled,
      action: el.getAttribute('data-gcal'),
      href: el.getAttribute('href') || '',
      target: el.getAttribute('target') || '',
      rel: el.getAttribute('rel') || '',
      bg: style.backgroundColor,
      color: style.color,
      weight: style.fontWeight,
      full: Math.abs(width - closeWidth) < 2
    };
  }, id);
}

function assertFeed(url) {
  assert.ok(FEED_RE.test(url), url);
  assert.strictEqual(url.indexOf('webcal'), -1);
}

function assertOpenHref(href, feed) {
  assert.strictEqual(href.indexOf('https://calendar.google.com/calendar/r?cid='), 0);
  assert.strictEqual(decodeURIComponent(href.split('cid=')[1]), feed.replace('https://', 'webcal://'));
}

async function absent(page, selector) {
  assert.strictEqual(await page.$(selector), null, selector);
}

async function installShare(page, mode) {
  await page.evaluate(function (mode) {
    window.__shareCalls = [];
    window.__copyAttempts = [];
    if (!window.__realWrite && navigator.clipboard && navigator.clipboard.writeText) {
      window.__realWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText = function (text) {
        window.__copyAttempts.push(String(text));
        if (mode === 'copy-fail') return Promise.reject(new Error('denied'));
        if (window.__realWrite) return window.__realWrite(text);
        return Promise.resolve();
      };
    }
    var share;
    if (mode === 'missing') share = undefined;
    else if (mode === 'ok') share = function (data) {
      window.__shareCalls.push(data);
      return Promise.resolve();
    };
    else if (mode === 'abort') share = function (data) {
      window.__shareCalls.push(data);
      var err = new Error('Share canceled');
      err.name = 'AbortError';
      return Promise.reject(err);
    };
    else if (mode === 'abort-throw') share = function (data) {
      window.__shareCalls.push(data);
      var err = new Error('Share canceled');
      err.name = 'AbortError';
      throw err;
    };
    else share = function (data) {
      window.__shareCalls.push(data);
      if (mode === 'throw') throw new Error('share threw');
      return Promise.reject(new Error('share failed'));
    };
    try {
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
    } catch (e) {
      navigator.share = share;
    }
  }, mode);
}

async function clearToast(page) {
  await page.evaluate(function () {
    var toast = document.getElementById('toast');
    toast.textContent = '';
    toast.classList.remove('show');
  });
}

async function toastText(page) {
  return page.evaluate(function () {
    return document.getElementById('toast').textContent;
  });
}

(async () => {
  const browser = await pp.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const errors = [];
  function watch(page) {
    page.on('pageerror', function (err) { errors.push(String(err)); });
    page.on('dialog', function (dialog) {
      errors.push('dialog ' + dialog.message());
      dialog.dismiss();
    });
  }

  const phone = await browser.newPage();
  watch(phone);
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.setUserAgent(IPHONE_UA);
  await grantClipboard(phone);
  await stub(phone, Object.assign({ feed: 'local' }, enthusiast()));
  await openPrograms(phone);
  await phone.waitForFunction(function () {
    return document.querySelector('[data-cal=week]') && document.querySelector('[data-cal=month]');
  });
  const near = await phone.evaluate(function () {
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
      monthVisible: month.top >= 0 && month.bottom <= window.innerHeight,
      phone: window.WBPreview.calendarOnPhone()
    };
  });
  assert.strictEqual(near.label, 'Add to Google Calendar');
  assert.strictEqual(near.phone, true);
  assert.ok(near.weekVisible && near.monthVisible && near.btnVisible, JSON.stringify(near));
  assert.ok(near.gap >= -4 && near.gap < 48, JSON.stringify(near));
  if (shots) await phone.screenshot({ path: path.join(shots, 'programs_google_calendar_button.png') });

  await phone.click('#pv-gcal');
  await phone.waitForSelector('#pv-gcal-share');
  const phoneFeed = await storedFeed(phone);
  assertFeed(phoneFeed);
  assert.strictEqual(await sheetText(phone), 'Add to Google Calendar ' + PHONE_NOTE + ' Send the link to myself Reset link Close');
  assert.strictEqual(await phone.$eval('#pv-gcal-phone', function (el) { return el.textContent; }), PHONE_NOTE);
  await absent(phone, '#pv-gcal-open, #pv-gcal-copy, #pv-gcal-link, #pv-gcal-how');
  const shareBtn = await priBox(phone, 'pv-gcal-share');
  assert.strictEqual(shareBtn.tag, 'BUTTON');
  assert.strictEqual(shareBtn.cls, 'pri');
  assert.strictEqual(shareBtn.label, 'Send the link to myself');
  assert.strictEqual(shareBtn.disabled, false);
  assert.strictEqual(shareBtn.action, 'share');
  assert.strictEqual(shareBtn.bg, 'rgb(37, 99, 235)');
  assert.strictEqual(shareBtn.color, 'rgb(255, 255, 255)');
  assert.strictEqual(shareBtn.weight, '600');
  assert.strictEqual(shareBtn.full, true);
  assert.strictEqual(await phone.$eval('#pv-gcal-reset', function (el) { return el.className; }), 'ghost');
  assert.strictEqual(await phone.$eval('#pv-gcal-reset', function (el) { return el.textContent; }), 'Reset link');
  if (shots) await phone.screenshot({ path: path.join(shots, 'programs_google_calendar_phone.png') });

  await clearToast(phone);
  await installShare(phone, 'ok');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () { return window.__shareCalls && window.__shareCalls.length === 1; });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__shareCalls[0]; }), {
    title: SHARE_TITLE, text: SHARE_TEXT, url: phoneFeed
  });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__copyAttempts; }), []);
  assert.strictEqual(await toastText(phone), '');

  await installShare(phone, 'abort');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () { return window.__shareCalls.length === 1; });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__copyAttempts; }), []);
  assert.strictEqual(await toastText(phone), '');

  await installShare(phone, 'abort-throw');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () { return window.__shareCalls.length === 1; });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__copyAttempts; }), []);
  assert.strictEqual(await toastText(phone), '');

  await clearToast(phone);
  await installShare(phone, 'fail');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () {
    var toast = document.getElementById('toast');
    return toast && toast.textContent === 'Link copied' && toast.classList.contains('show');
  });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__copyAttempts; }), [phoneFeed]);
  assert.strictEqual(await phone.evaluate(function () { return navigator.clipboard.readText(); }), phoneFeed);

  await clearToast(phone);
  await installShare(phone, 'throw');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () {
    var toast = document.getElementById('toast');
    return toast && toast.textContent === 'Link copied' && toast.classList.contains('show');
  });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__copyAttempts; }), [phoneFeed]);

  await clearToast(phone);
  await phone.evaluate(function () { return navigator.clipboard.writeText('cleared'); });
  await installShare(phone, 'missing');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () {
    var toast = document.getElementById('toast');
    return toast && toast.textContent === 'Link copied' && toast.classList.contains('show');
  });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__shareCalls; }), []);
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__copyAttempts; }), [phoneFeed]);
  assert.strictEqual(await phone.evaluate(function () { return navigator.clipboard.readText(); }), phoneFeed);

  await clearToast(phone);
  await installShare(phone, 'copy-fail');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () { return window.__copyAttempts.length === 1; });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__copyAttempts; }), [phoneFeed]);
  assert.strictEqual(await toastText(phone), '');

  await phone.click('#pv-gcal-reset');
  await phone.waitForSelector('#pv-gcal-reset-confirm');
  const phoneConfirm = await phone.evaluate(function () {
    var box = document.getElementById('pv-gcal-reset-confirm');
    return {
      title: box.querySelector('h3').textContent,
      body: box.querySelector('p').textContent,
      yes: document.getElementById('pv-gcal-reset-yes').textContent,
      cancel: document.getElementById('pv-gcal-reset-cancel').textContent,
      sheet: document.getElementById('pv-gcal-sheet').innerText.replace(/\s+/g, ' ').trim()
    };
  });
  assert.strictEqual(phoneConfirm.title, 'Reset your calendar link?');
  assert.strictEqual(phoneConfirm.body, CONFIRM_BODY);
  assert.strictEqual(phoneConfirm.body.indexOf('copy'), -1);
  assert.strictEqual(phoneConfirm.yes, 'Yes, reset');
  assert.strictEqual(phoneConfirm.cancel, 'Cancel');
  assert.strictEqual(phoneConfirm.sheet, 'Add to Google Calendar ' + PHONE_NOTE + ' Send the link to myself Reset link Close');
  assert.strictEqual(await storedFeed(phone), phoneFeed);
  await phone.click('#pv-gcal-reset-cancel');
  await phone.waitForFunction(function () { return !document.getElementById('pv-gcal-reset-confirm'); });
  assert.strictEqual(await storedFeed(phone), phoneFeed);

  await phone.click('#pv-gcal-reset');
  await phone.waitForSelector('#pv-gcal-reset-confirm');
  await phone.click('#pv-gcal-reset-yes');
  await phone.waitForFunction(function (previous) {
    var bag = JSON.parse(localStorage.getItem('wb.calendarFeed.v1') || '{}');
    var row = bag['allow-test'];
    var url = row && window.WBCalendar ? WBCalendar.feedUrl(row.token) : '';
    var text = document.getElementById('pv-gcal-sheet') ? document.getElementById('pv-gcal-sheet').innerText : '';
    return url && url !== previous && text.indexOf('New link ready.') !== -1 && !document.getElementById('pv-gcal-reset-confirm');
  }, {}, phoneFeed);
  const phoneNext = await storedFeed(phone);
  assertFeed(phoneNext);
  assert.notStrictEqual(phoneNext, phoneFeed);
  assert.strictEqual(await sheetText(phone), 'Add to Google Calendar New link ready. ' + PHONE_NOTE + ' Send the link to myself Reset link Close');
  await absent(phone, '#pv-gcal-open');
  await installShare(phone, 'ok');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () { return window.__shareCalls.length === 1; });
  assert.strictEqual(await phone.evaluate(function () { return window.__shareCalls[0].url; }), phoneNext);
  await phone.click('[data-sheet=cancel]');
  await phone.waitForFunction(function () { return !document.getElementById('pv-gcal-sheet'); });

  const desktop = await browser.newPage();
  watch(desktop);
  await desktop.setViewport({ width: 1200, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  await desktop.setUserAgent(DESKTOP_UA, {
    brands: [{ brand: 'Chromium', version: '120' }],
    fullVersion: '120.0.0.0',
    platform: 'Linux',
    platformVersion: '6.0.0',
    architecture: 'x86',
    model: '',
    mobile: false
  });
  await grantClipboard(desktop);
  await stub(desktop, Object.assign({ feed: 'local' }, enthusiast()));
  await openPrograms(desktop);
  assert.strictEqual(await desktop.evaluate(function () { return window.WBPreview.calendarOnPhone(); }), false);
  await desktop.click('#pv-gcal');
  await desktop.waitForSelector('#pv-gcal-open');
  const deskFeed = await storedFeed(desktop);
  assertFeed(deskFeed);
  assert.strictEqual(await sheetText(desktop), 'Add to Google Calendar Open Google Calendar Reset link Close');
  await absent(desktop, '#pv-gcal-share, #pv-gcal-phone, #pv-gcal-copy, #pv-gcal-link, #pv-gcal-how');
  const openBtn = await priBox(desktop, 'pv-gcal-open');
  assert.strictEqual(openBtn.tag, 'A');
  assert.strictEqual(openBtn.cls, 'pri');
  assert.strictEqual(openBtn.label, 'Open Google Calendar');
  assert.strictEqual(openBtn.target, '_blank');
  assert.ok(openBtn.rel.indexOf('noopener') !== -1);
  assertOpenHref(openBtn.href, deskFeed);
  assert.strictEqual(openBtn.bg, 'rgb(37, 99, 235)');
  assert.strictEqual(openBtn.color, 'rgb(255, 255, 255)');
  assert.strictEqual(openBtn.weight, '600');
  assert.strictEqual(openBtn.full, true);
  assert.strictEqual(await desktop.$eval('#pv-gcal-reset', function (el) { return el.className + '|' + el.textContent; }), 'ghost|Reset link');
  if (shots) await desktop.screenshot({ path: path.join(shots, 'programs_google_calendar_link.png') });

  await desktop.click('#pv-gcal-reset');
  await desktop.waitForSelector('#pv-gcal-reset-confirm');
  const confirm = await desktop.evaluate(function () {
    var box = document.getElementById('pv-gcal-reset-confirm');
    var yes = document.getElementById('pv-gcal-reset-yes');
    var cancel = document.getElementById('pv-gcal-reset-cancel');
    var yesStyle = getComputedStyle(yes);
    var cancelStyle = getComputedStyle(cancel);
    var boxStyle = getComputedStyle(box);
    return {
      title: box.querySelector('h3').textContent,
      body: box.querySelector('p').textContent,
      yes: yes.textContent,
      cancel: cancel.textContent,
      yesClass: yes.className,
      modalClass: box.className,
      card: !!box.querySelector('.card'),
      href: document.getElementById('pv-gcal-open').getAttribute('href'),
      sheetText: document.getElementById('pv-gcal-sheet').innerText.replace(/\s+/g, ' ').trim(),
      yesBg: yesStyle.backgroundColor,
      yesColor: yesStyle.color,
      yesWeight: yesStyle.fontWeight,
      cancelBg: cancelStyle.backgroundColor,
      cancelColor: cancelStyle.color,
      position: boxStyle.position,
      display: boxStyle.display
    };
  });
  assert.strictEqual(confirm.title, 'Reset your calendar link?');
  assert.strictEqual(confirm.body, CONFIRM_BODY);
  assert.strictEqual(confirm.yes, 'Yes, reset');
  assert.strictEqual(confirm.cancel, 'Cancel');
  assert.strictEqual(confirm.yesClass, 'pri');
  assert.ok(confirm.modalClass.indexOf('pl-modal') !== -1);
  assert.strictEqual(confirm.card, true);
  assertOpenHref(confirm.href, deskFeed);
  assert.strictEqual(confirm.sheetText, 'Add to Google Calendar Open Google Calendar Reset link Close');
  assert.strictEqual(confirm.yesBg, 'rgb(37, 99, 235)');
  assert.strictEqual(confirm.yesColor, 'rgb(255, 255, 255)');
  assert.strictEqual(confirm.yesWeight, '600');
  assert.strictEqual(confirm.cancelBg, 'rgb(229, 231, 235)');
  assert.strictEqual(confirm.cancelColor, 'rgb(17, 24, 39)');
  assert.strictEqual(confirm.position, 'fixed');
  assert.strictEqual(confirm.display, 'flex');
  if (shots) await desktop.screenshot({ path: path.join(shots, 'programs_google_calendar_reset_confirm.png') });

  await desktop.click('#pv-gcal-reset-cancel');
  await desktop.waitForFunction(function () { return !document.getElementById('pv-gcal-reset-confirm'); });
  assert.strictEqual(await storedFeed(desktop), deskFeed);
  assert.strictEqual(await sheetText(desktop), 'Add to Google Calendar Open Google Calendar Reset link Close');

  await desktop.click('#pv-gcal-reset');
  await desktop.waitForSelector('#pv-gcal-reset-confirm');
  assertOpenHref(await desktop.$eval('#pv-gcal-open', function (el) { return el.getAttribute('href'); }), deskFeed);
  await desktop.click('#pv-gcal-reset-yes');
  await desktop.waitForFunction(function (previous) {
    var open = document.getElementById('pv-gcal-open');
    if (!open) return false;
    var href = open.getAttribute('href') || '';
    var fromHref = '';
    try { fromHref = decodeURIComponent(href.split('cid=')[1] || '').replace(/^webcal:\/\//, 'https://'); } catch (e) { return false; }
    var text = document.getElementById('pv-gcal-sheet').innerText;
    return fromHref && fromHref !== previous && text.indexOf(previous) === -1 && text.indexOf('New link ready.') !== -1 && !document.getElementById('pv-gcal-reset-confirm');
  }, {}, deskFeed);
  const afterReset = await sheetText(desktop);
  assert.strictEqual(afterReset, 'Add to Google Calendar New link ready. Open Google Calendar Reset link Close');
  const deskNext = await storedFeed(desktop);
  assertFeed(deskNext);
  assert.notStrictEqual(deskNext, deskFeed);
  assertOpenHref(await desktop.$eval('#pv-gcal-open', function (el) { return el.getAttribute('href'); }), deskNext);
  if (shots) await desktop.screenshot({ path: path.join(shots, 'programs_google_calendar_reset.png') });
  await desktop.click('[data-sheet=cancel]');
  await desktop.waitForFunction(function () { return !document.getElementById('pv-gcal-sheet'); });
  await desktop.click('[data-cal=month]');
  await desktop.waitForSelector('.pv-month');
  await desktop.click('[data-cal=week]');
  await desktop.waitForSelector('.pv-week');

  const narrow = await browser.newPage();
  watch(narrow);
  await narrow.setViewport({ width: 390, height: 844, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  await narrow.setUserAgent(DESKTOP_UA);
  await stub(narrow, Object.assign({ feed: 'local' }, enthusiast()));
  await openPrograms(narrow);
  assert.strictEqual(await narrow.evaluate(function () { return window.WBPreview.calendarOnPhone(); }), false);
  await narrow.click('#pv-gcal');
  await narrow.waitForSelector('a#pv-gcal-open');
  await absent(narrow, '#pv-gcal-share, #pv-gcal-phone, #pv-gcal-copy, #pv-gcal-link');
  assert.strictEqual(await narrow.$eval('#pv-gcal-open', function (el) { return el.textContent; }), 'Open Google Calendar');

  const widePhone = await browser.newPage();
  watch(widePhone);
  await widePhone.setViewport({ width: 1200, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await widePhone.setUserAgent(IPHONE_UA);
  await stub(widePhone, Object.assign({ feed: 'local' }, enthusiast()));
  await openPrograms(widePhone);
  assert.strictEqual(await widePhone.evaluate(function () { return window.WBPreview.calendarOnPhone(); }), true);
  await widePhone.click('#pv-gcal');
  await widePhone.waitForSelector('#pv-gcal-share');
  await absent(widePhone, '#pv-gcal-open');
  assert.strictEqual(await widePhone.$eval('#pv-gcal-phone', function (el) { return el.textContent; }), PHONE_NOTE);

  const android = await browser.newPage();
  watch(android);
  await android.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await android.setUserAgent(ANDROID_UA);
  await stub(android, Object.assign({ feed: 'local' }, enthusiast()));
  await openPrograms(android);
  assert.strictEqual(await android.evaluate(function () { return window.WBPreview.calendarOnPhone(); }), true);
  await android.click('#pv-gcal');
  await android.waitForSelector('#pv-gcal-share');
  await absent(android, '#pv-gcal-open');

  const ipad = await browser.newPage();
  watch(ipad);
  await ipad.setViewport({ width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await ipad.setUserAgent(IPAD_UA);
  await stub(ipad, Object.assign({ feed: 'local' }, enthusiast()));
  await openPrograms(ipad);
  assert.strictEqual(await ipad.evaluate(function () { return window.WBPreview.calendarOnPhone(); }), true);
  await ipad.click('#pv-gcal');
  await ipad.waitForSelector('#pv-gcal-share');
  await absent(ipad, '#pv-gcal-open');

  const ipadMac = await browser.newPage();
  watch(ipadMac);
  await ipadMac.setViewport({ width: 1024, height: 768, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await ipadMac.setUserAgent(MAC_UA, {
    brands: [{ brand: 'Safari', version: '17' }],
    fullVersion: '17.5.0',
    platform: 'macOS',
    platformVersion: '17.5.0',
    architecture: 'arm',
    model: '',
    mobile: false
  });
  await ipadMac.evaluateOnNewDocument(function () {
    try {
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: function () { return 5; } });
    } catch (e) {}
    try {
      Object.defineProperty(navigator, 'platform', { configurable: true, get: function () { return 'MacIntel'; } });
    } catch (e) {}
  });
  try {
    const touch = await ipadMac.createCDPSession();
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } catch (e) {}
  await stub(ipadMac, Object.assign({ feed: 'local' }, enthusiast()));
  await openPrograms(ipadMac);
  const ipadProbe = await ipadMac.evaluate(function () {
    return { touch: navigator.maxTouchPoints, phone: window.WBPreview.calendarOnPhone(), ua: navigator.userAgent };
  });
  assert.ok(ipadProbe.touch > 1, JSON.stringify(ipadProbe));
  assert.strictEqual(ipadProbe.phone, true, JSON.stringify(ipadProbe));
  await ipadMac.click('#pv-gcal');
  await ipadMac.waitForSelector('#pv-gcal-share');
  await absent(ipadMac, '#pv-gcal-open');

  const uaData = await browser.newPage();
  watch(uaData);
  await uaData.setViewport({ width: 1200, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  await uaData.setUserAgent(DESKTOP_UA, {
    brands: [{ brand: 'Chromium', version: '120' }],
    fullVersion: '120.0.0.0',
    platform: 'Android',
    platformVersion: '14.0.0',
    architecture: 'arm',
    model: 'Pixel 8',
    mobile: true
  });
  await stub(uaData, Object.assign({ feed: 'local' }, enthusiast()));
  await openPrograms(uaData);
  assert.strictEqual(await uaData.evaluate(function () { return window.WBPreview.calendarOnPhone(); }), true);
  await uaData.click('#pv-gcal');
  await uaData.waitForSelector('#pv-gcal-share');
  await absent(uaData, '#pv-gcal-open');

  const cases = await desktop.evaluate(function () {
    var fn = window.WBPreview.calendarOnPhone;
    var mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    var desk = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    return {
      iphone: fn({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' }),
      ipad: fn({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' }),
      ipod: fn({ userAgent: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15' }),
      android: fn({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36' }),
      uaDataMobile: fn({ userAgent: desk, userAgentData: { mobile: true, platform: 'Android' } }),
      uaDataDesktop: fn({ userAgent: desk, userAgentData: { mobile: false, platform: 'Linux' }, maxTouchPoints: 0 }),
      ipadAsMac: fn({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 5 }),
      ipadPlatformOnly: fn({ userAgent: desk, platform: 'MacIntel', maxTouchPoints: 5 }),
      macDesktop: fn({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 0, userAgentData: { mobile: false, platform: 'macOS' } }),
      macOneTouch: fn({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 1 }),
      windowsTouch: fn({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36', platform: 'Win32', maxTouchPoints: 10, userAgentData: { mobile: false, platform: 'Windows' } }),
      empty: fn({})
    };
  });
  assert.strictEqual(cases.iphone, true);
  assert.strictEqual(cases.ipad, true);
  assert.strictEqual(cases.ipod, true);
  assert.strictEqual(cases.android, true);
  assert.strictEqual(cases.uaDataMobile, true);
  assert.strictEqual(cases.uaDataDesktop, false);
  assert.strictEqual(cases.ipadAsMac, true);
  assert.strictEqual(cases.ipadPlatformOnly, true);
  assert.strictEqual(cases.macDesktop, false);
  assert.strictEqual(cases.macOneTouch, false);
  assert.strictEqual(cases.windowsTouch, false);
  assert.strictEqual(cases.empty, false);

  async function openFeedMode(feed, ua, viewport) {
    const page = await browser.newPage();
    watch(page);
    await page.setViewport(viewport);
    if (ua) await page.setUserAgent(ua);
    await stub(page, Object.assign({ feed: feed }, enthusiast()));
    await openPrograms(page);
    await page.click('#pv-gcal');
    return page;
  }
  const phoneSize = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
  const deskSize = { width: 1200, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

  const loadingDesk = await openFeedMode('hang', DESKTOP_UA, deskSize);
  await loadingDesk.waitForSelector('#pv-gcal-open[disabled]');
  const loadingOpen = await priBox(loadingDesk, 'pv-gcal-open');
  assert.strictEqual(loadingOpen.tag, 'BUTTON');
  assert.strictEqual(loadingOpen.cls, 'pri');
  assert.strictEqual(loadingOpen.label, 'Open Google Calendar');
  assert.strictEqual(loadingOpen.disabled, true);
  assert.strictEqual(loadingOpen.action, null);
  assert.strictEqual(loadingOpen.bg, 'rgb(37, 99, 235)');
  assert.strictEqual(await sheetText(loadingDesk), 'Add to Google Calendar Open Google Calendar Reset link Close');
  await absent(loadingDesk, '#pv-gcal-share, #pv-gcal-copy, #pv-gcal-link');

  const loadingPhone = await openFeedMode('hang', IPHONE_UA, phoneSize);
  await loadingPhone.waitForSelector('#pv-gcal-share[disabled]');
  const loadingShare = await priBox(loadingPhone, 'pv-gcal-share');
  assert.strictEqual(loadingShare.cls, 'pri');
  assert.strictEqual(loadingShare.label, 'Send the link to myself');
  assert.strictEqual(loadingShare.disabled, true);
  assert.strictEqual(loadingShare.bg, 'rgb(37, 99, 235)');
  assert.strictEqual(await loadingPhone.$eval('#pv-gcal-phone', function (el) { return el.textContent; }), PHONE_NOTE);
  await absent(loadingPhone, '#pv-gcal-open');

  const errorDesk = await openFeedMode('error', DESKTOP_UA, deskSize);
  await errorDesk.waitForSelector('#pv-gcal-open[data-gcal=retry]');
  const errorOpen = await priBox(errorDesk, 'pv-gcal-open');
  assert.strictEqual(errorOpen.tag, 'BUTTON');
  assert.strictEqual(errorOpen.cls, 'pri');
  assert.strictEqual(errorOpen.label, 'Open Google Calendar');
  assert.strictEqual(errorOpen.disabled, false);
  assert.strictEqual(errorOpen.action, 'retry');
  assert.strictEqual(errorOpen.bg, 'rgb(37, 99, 235)');
  assert.strictEqual(await errorDesk.$eval('#pv-gcal-error', function (el) { return el.textContent; }), FAIL_NOTE);
  assert.strictEqual(await sheetText(errorDesk), 'Add to Google Calendar ' + FAIL_NOTE + ' Open Google Calendar Reset link Close');
  await absent(errorDesk, '#pv-gcal-share, #pv-gcal-copy');
  await errorDesk.click('#pv-gcal-open');
  await errorDesk.waitForSelector('#pv-gcal-open[data-gcal=retry]');

  const errorPhone = await openFeedMode('error', IPHONE_UA, phoneSize);
  await errorPhone.waitForSelector('#pv-gcal-share[data-gcal=retry]');
  const errorShare = await priBox(errorPhone, 'pv-gcal-share');
  assert.strictEqual(errorShare.label, 'Send the link to myself');
  assert.strictEqual(errorShare.action, 'retry');
  assert.strictEqual(errorShare.cls, 'pri');
  assert.strictEqual(errorShare.disabled, false);
  await absent(errorPhone, '#pv-gcal-open');
  assert.ok((await sheetText(errorPhone)).indexOf('Open Google Calendar') === -1);

  const signedOut = await browser.newPage();
  watch(signedOut);
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
