// The sample preview is now the real Programs screen.
// node tests/preview-ui.test.js [url]
require('./programs-ui.test.js');

// Add to Google Calendar sheet: computer button, phone share, and the copy fallback.
const assert = require('assert');
const M = require('../model.js');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const PHONE_NOTE = 'Google\'s phone app can\'t add calendar links. Do it once on a computer: sign in at coachtrainerapp.com, tap Add to Google Calendar there, and it will sync to this phone on its own.';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FEED_RE = /^https:\/\/thyrgloermygnezfareg\.supabase\.co\/functions\/v1\/calendar-feed\/[0-9a-f]{64}\.ics$/;

function workout(name) {
  const w = M.newWorkout(name);
  w.items = [M.normalizeExercise(M.newExercise({
    name: 'Press', sets: 1, weight: { unit: 'lb', value: 20 },
    mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 }
  }))];
  return w;
}

async function stub(page) {
  const extra = {
    profile: { id: 'allow-test', email: 'kinisiathletics@gmail.com', membership: 'enthusiast', intended_plan: 'enthusiast' },
    session: { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } },
    share: { on: false, enthusiast: true, linked: false },
    roster: { role: null, clients: [] }
  };
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
          var err = new Error('local');
          err.local = true;
          return Promise.reject(err);
        };
        value.resetCalendarFeed = value.calendarFeed;
      }
    });
  }, extra);
}

async function openSheet(page) {
  const base = M.emptyData();
  base.workouts.push(workout('Morning lift'));
  await page.goto(URL);
  await page.evaluate(function (key, value) {
    localStorage.setItem(key, value);
  }, M.STORAGE_KEY, JSON.stringify(base));
  await page.reload();
  await page.waitForSelector('#programs-open');
  await page.click('#programs-open');
  await page.waitForSelector('#pv-gcal');
  await page.click('#pv-gcal');
}

async function feed(page) {
  return page.evaluate(function () {
    var bag = JSON.parse(localStorage.getItem('wb.calendarFeed.v1') || '{}');
    var row = bag['allow-test'];
    return row && window.WBCalendar ? WBCalendar.feedUrl(row.token) : '';
  });
}

async function shareMode(page, mode) {
  await page.evaluate(function (mode) {
    window.__shareCalls = [];
    window.__copyAttempts = [];
    if (!window.__realWrite && navigator.clipboard && navigator.clipboard.writeText) {
      window.__realWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText = function (text) {
        window.__copyAttempts.push(String(text));
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
    else share = function (data) {
      window.__shareCalls.push(data);
      return Promise.reject(new Error('share failed'));
    };
    try {
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: share });
    } catch (e) {
      navigator.share = share;
    }
  }, mode);
}

(async () => {
  const browser = await pp.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const errors = [];
  const desktop = await browser.newPage();
  desktop.on('pageerror', function (err) { errors.push(String(err)); });
  await desktop.setViewport({ width: 1200, height: 800, isMobile: false, hasTouch: false });
  await desktop.setUserAgent(DESKTOP_UA);
  await stub(desktop);
  await openSheet(desktop);
  await desktop.waitForSelector('#pv-gcal-open');
  const deskFeed = await feed(desktop);
  assert.ok(FEED_RE.test(deskFeed), deskFeed);
  const computer = await desktop.evaluate(function () {
    var open = document.getElementById('pv-gcal-open');
    var style = getComputedStyle(open);
    var close = document.querySelector('#pv-gcal-sheet [data-sheet=cancel]');
    return {
      text: document.getElementById('pv-gcal-sheet').innerText.replace(/\s+/g, ' ').trim(),
      tag: open.tagName,
      cls: open.className,
      label: open.textContent,
      href: open.getAttribute('href') || '',
      target: open.getAttribute('target') || '',
      bg: style.backgroundColor,
      color: style.color,
      weight: style.fontWeight,
      full: Math.abs(open.getBoundingClientRect().width - close.getBoundingClientRect().width) < 2,
      reset: document.getElementById('pv-gcal-reset').className,
      phone: window.WBPreview.calendarOnPhone(),
      gone: !document.getElementById('pv-gcal-share') && !document.getElementById('pv-gcal-copy') && !document.getElementById('pv-gcal-link') && !document.getElementById('pv-gcal-how') && !document.getElementById('pv-gcal-phone')
    };
  });
  assert.strictEqual(computer.phone, false);
  assert.strictEqual(computer.text, 'Add to Google Calendar Open Google Calendar Reset link Close');
  assert.strictEqual(computer.tag, 'A');
  assert.strictEqual(computer.cls, 'pri');
  assert.strictEqual(computer.label, 'Open Google Calendar');
  assert.strictEqual(computer.target, '_blank');
  assert.strictEqual(computer.href.indexOf('https://calendar.google.com/calendar/r?cid='), 0);
  assert.strictEqual(decodeURIComponent(computer.href.split('cid=')[1]), deskFeed.replace('https://', 'webcal://'));
  assert.strictEqual(computer.bg, 'rgb(37, 99, 235)');
  assert.strictEqual(computer.color, 'rgb(255, 255, 255)');
  assert.strictEqual(computer.weight, '600');
  assert.strictEqual(computer.full, true);
  assert.strictEqual(computer.reset, 'ghost');
  assert.strictEqual(computer.gone, true);
  const helper = await desktop.evaluate(function () {
    var fn = window.WBPreview.calendarOnPhone;
    var mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
    return {
      iphone: fn({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' }),
      android: fn({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36' }),
      ipadMac: fn({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 5 }),
      mac: fn({ userAgent: mac, platform: 'MacIntel', maxTouchPoints: 0 }),
      flag: fn({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120', userAgentData: { mobile: true } })
    };
  });
  assert.deepStrictEqual(helper, { iphone: true, android: true, ipadMac: true, mac: false, flag: true });

  const phone = await browser.newPage();
  phone.on('pageerror', function (err) { errors.push(String(err)); });
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.setUserAgent(IPHONE_UA);
  const context = browser.defaultBrowserContext();
  try { await context.overridePermissions(URL, ['clipboard-read', 'clipboard-write']); } catch (e) {}
  try {
    const client = await phone.createCDPSession();
    await client.send('Browser.grantPermissions', {
      origin: 'http://127.0.0.1:8787',
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
    });
  } catch (e) {}
  await stub(phone);
  await openSheet(phone);
  await phone.waitForSelector('#pv-gcal-share');
  const phoneFeed = await feed(phone);
  assert.ok(FEED_RE.test(phoneFeed), phoneFeed);
  const mobile = await phone.evaluate(function () {
    var btn = document.getElementById('pv-gcal-share');
    var style = getComputedStyle(btn);
    var close = document.querySelector('#pv-gcal-sheet [data-sheet=cancel]');
    return {
      text: document.getElementById('pv-gcal-sheet').innerText.replace(/\s+/g, ' ').trim(),
      note: document.getElementById('pv-gcal-phone').textContent,
      label: btn.textContent,
      cls: btn.className,
      bg: style.backgroundColor,
      color: style.color,
      weight: style.fontWeight,
      full: Math.abs(btn.getBoundingClientRect().width - close.getBoundingClientRect().width) < 2,
      reset: document.getElementById('pv-gcal-reset').textContent,
      phone: window.WBPreview.calendarOnPhone(),
      noOpen: !document.getElementById('pv-gcal-open') && !document.getElementById('pv-gcal-copy') && !document.getElementById('pv-gcal-link')
    };
  });
  assert.strictEqual(mobile.phone, true);
  assert.strictEqual(mobile.note, PHONE_NOTE);
  assert.strictEqual(mobile.text, 'Add to Google Calendar ' + PHONE_NOTE + ' Send the link to myself Reset link Close');
  assert.strictEqual(mobile.label, 'Send the link to myself');
  assert.strictEqual(mobile.cls, 'pri');
  assert.strictEqual(mobile.bg, 'rgb(37, 99, 235)');
  assert.strictEqual(mobile.color, 'rgb(255, 255, 255)');
  assert.strictEqual(mobile.weight, '600');
  assert.strictEqual(mobile.full, true);
  assert.strictEqual(mobile.reset, 'Reset link');
  assert.strictEqual(mobile.noOpen, true);

  await shareMode(phone, 'ok');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () { return window.__shareCalls.length === 1; });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__shareCalls[0]; }), {
    title: 'My workout calendar link',
    text: 'Open this on a computer to add my workouts to Google Calendar',
    url: phoneFeed
  });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__copyAttempts; }), []);
  assert.strictEqual(await phone.evaluate(function () { return document.getElementById('toast').textContent; }), '');

  await shareMode(phone, 'abort');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () { return window.__shareCalls.length === 1; });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__copyAttempts; }), []);
  assert.strictEqual(await phone.evaluate(function () { return document.getElementById('toast').textContent; }), '');

  await shareMode(phone, 'fail');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () {
    var toast = document.getElementById('toast');
    return toast && toast.textContent === 'Link copied' && toast.classList.contains('show');
  });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__copyAttempts; }), [phoneFeed]);
  assert.strictEqual(await phone.evaluate(function () { return navigator.clipboard.readText(); }), phoneFeed);

  await phone.evaluate(function () {
    var toast = document.getElementById('toast');
    toast.textContent = '';
    toast.classList.remove('show');
  });
  await shareMode(phone, 'missing');
  await phone.click('#pv-gcal-share');
  await phone.waitForFunction(function () {
    var toast = document.getElementById('toast');
    return toast && toast.textContent === 'Link copied' && toast.classList.contains('show');
  });
  assert.deepStrictEqual(await phone.evaluate(function () { return window.__copyAttempts; }), [phoneFeed]);

  assert.strictEqual(errors.length, 0, errors.join('\n'));
  await browser.close();
  console.log('preview calendar sheet ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
