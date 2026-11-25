// Feedback button, send sheet, admin list, and a reply through Messages.
// No live database. node tests/feedback-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pp = require('puppeteer-core');
const M = require('../model.js');
const FB = require('../feedback.js');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const USER = '22222222-2222-4222-8222-222222222222';
const mk = function (o) { return M.normalizeExercise(M.newExercise(o)); };
const workout = M.newWorkout('Morning');
workout.items = [mk({ name: 'Curl', sets: 1, weight: { unit: 'lb', value: 20 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 } })];
const data = M.emptyData();
data.workouts.push(workout);

assert.strictEqual(FB.canSend('', 'hello'), false);
assert.strictEqual(FB.canSend('bug', '   '), false);
assert.strictEqual(FB.canSend('bug', 'The timer skipped.'), true);
assert.strictEqual(FB.canSend('idea', 'x'.repeat(2001)), false);
assert.strictEqual(FB.safeName({ name: 'ada@example.com' }), 'Member');
assert.strictEqual(FB.safeName({ display_name: 'Ada Client' }), 'Ada Client');
assert.ok(css.indexOf('button#feedback-open') !== -1);
assert.ok(css.indexOf('width:48px;height:48px') !== -1);
assert.ok(css.indexOf('background:#2563eb') !== -1);
assert.ok(css.indexOf('env(safe-area-inset-bottom)') !== -1);
assert.ok(css.indexOf('env(safe-area-inset-right)') !== -1);
assert.ok(html.indexOf('aria-label="Feedback"') !== -1);
assert.ok(html.indexOf('id="feedback-open" hidden') !== -1);

(async function () {
  fs.mkdirSync(ART, { recursive: true });
  const chrome = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
  const b = await pp.launch({ executablePath: chrome, args: ['--no-sandbox', '--hide-scrollbars'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', function (e) { errs.push(String(e)); });
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument(function (stored, userId) {
    localStorage.setItem('wb.data.v1', stored);
    window.__mode = 'out';
    window.__sent = [];
    window.__status = null;
    window.__submitted = null;
    window.__rows = [
      {
        id: 'fb-old',
        userId: userId,
        name: 'Sam Ortiz',
        page: 'Calendar',
        type: 'idea',
        message: 'A way to copy last week.',
        status: 'new',
        createdAt: '2026-11-20T15:00:00.000Z'
      },
      {
        id: 'fb-new',
        userId: userId,
        name: 'Ada Client',
        page: 'Workouts',
        type: 'bug',
        message: 'The rest timer skips ahead.',
        status: 'new',
        createdAt: '2026-11-25T18:04:00.000Z'
      }
    ];
    var current;
    function patch(api) {
      if (!api || api.__feedbackStub) return api;
      api.__feedbackStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () {
        if (window.__mode === 'out') return Promise.resolve(null);
        if (window.__mode === 'admin') return Promise.resolve({ user: { id: 'admin', email: 'kinisiathletics@gmail.com' } });
        return Promise.resolve({ user: { id: 'member', email: 'member@example.com' } });
      };
      api.freshSession = function () { return api.session(); };
      api.profile = function () {
        if (window.__mode === 'out') return Promise.resolve(null);
        if (window.__mode === 'admin') {
          return Promise.resolve({
            id: 'admin', email: 'kinisiathletics@gmail.com', membership: 'trainer', intended_plan: 'trainer',
            access_approved: true, display_name: 'Kinisi Admin', profileReady: true, online_only: true
          });
        }
        return Promise.resolve({
          id: 'member', email: 'member@example.com', membership: 'enthusiast', intended_plan: 'enthusiast',
          access_approved: true, display_name: 'Member Lee', profileReady: true
        });
      };
      api.signOut = function () { window.__mode = 'out'; return Promise.resolve(); };
      api.navBadges = function () { return Promise.resolve({ messages: 0, hub: 0, tracking: 0 }); };
      api.navMarkSeen = function () { return Promise.resolve(null); };
      api.trainerRequestCount = function () { return Promise.resolve(0); };
      api.workoutCopies = function () { return Promise.resolve([]); };
      api.accountPull = function () { return Promise.resolve([]); };
      api.roster = function () { return Promise.resolve({ role: 'trainer', cap: 10, clientCount: 0, canCreate: true, clients: [], invites: [] }); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.threads = function () { return Promise.resolve({ role: 'client', threads: [] }); };
      api.messages = function () { return Promise.resolve({ person: null, messages: [] }); };
      api.avatarUrl = function () { return Promise.resolve(''); };
      api.verificationQueue = function () { return Promise.resolve([]); };
      api.accessAccounts = function () { return Promise.resolve([]); };
      api.hubReports = function () { return Promise.resolve([]); };
      api.circuits = function () { return Promise.resolve([]); };
      api.circuitGuestPlacements = function () { return Promise.resolve([]); };
      api.submitFeedback = function (page, type, message) {
        window.__submitted = { page: page, type: type, message: message };
        return Promise.resolve({ id: 'fb-sent', status: 'new' });
      };
      api.feedbackList = function () { return Promise.resolve(window.__rows.slice()); };
      api.setFeedbackStatus = function (id, status) {
        window.__status = { id: id, status: status };
        window.__rows.forEach(function (row) { if (row.id === id) row.status = status; });
        return Promise.resolve({ id: id, status: status });
      };
      api.sendMessage = function (personId, messageId, body) {
        window.__sent.push({ personId: personId, messageId: messageId, body: body });
        return Promise.resolve({ id: messageId, body: body });
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  }, JSON.stringify(data), USER);

  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.waitForFunction(function () {
    var btn = document.getElementById('feedback-open');
    return document.documentElement.classList.contains('wb-landing') && btn && btn.hidden;
  });
  assert.strictEqual(await p.$eval('#feedback-open', function (el) { return el.hidden; }), true);

  await p.evaluate(function () {
    window.__mode = 'in';
    location.hash = '#/';
  });
  await p.waitForFunction(function () {
    var btn = document.getElementById('feedback-open');
    return document.getElementById('title').textContent === 'Workouts' && btn && !btn.hidden;
  });
  const fab = await p.evaluate(function () {
    var btn = document.getElementById('feedback-open');
    var style = getComputedStyle(btn);
    return {
      label: btn.getAttribute('aria-label'),
      text: btn.textContent.replace(/\s+/g, ''),
      width: style.width,
      height: style.height,
      radius: style.borderRadius,
      bg: style.backgroundColor,
      pos: style.position
    };
  });
  assert.strictEqual(fab.label, 'Feedback');
  assert.strictEqual(fab.text, '');
  assert.strictEqual(fab.width, '48px');
  assert.strictEqual(fab.height, '48px');
  assert.strictEqual(fab.bg, 'rgb(37, 99, 235)');
  assert.strictEqual(fab.pos, 'fixed');
  assert.ok(fab.radius === '50%' || fab.radius === '24px');
  await p.screenshot({ path: ART + '/feedback-button.png' });

  const runHidden = await p.evaluate(function () {
    var before = location.hash;
    history.replaceState(null, '', '#/circuits/abc/run');
    window.WBFeedback.sync({ signedIn: true });
    var hidden = document.getElementById('feedback-open').hidden;
    history.replaceState(null, '', before || '#/');
    window.WBFeedback.sync({ signedIn: true });
    return hidden && !document.getElementById('feedback-open').hidden;
  });
  assert.strictEqual(runHidden, true);

  await p.click('#feedback-open');
  await p.waitForSelector('#fb-sheet');
  const form = await p.evaluate(function () {
    var card = document.getElementById('fb-card');
    return {
      title: document.getElementById('fb-title').textContent,
      pageLabel: card.querySelector('.fb-page span').textContent,
      page: document.getElementById('fb-page').textContent,
      type: document.getElementById('fb-type-label').textContent,
      choices: Array.prototype.map.call(card.querySelectorAll('[data-fb-type]'), function (el) { return el.textContent; }),
      message: card.querySelector('label[for="fb-message"]').textContent,
      placeholder: document.getElementById('fb-message').getAttribute('placeholder'),
      max: document.getElementById('fb-message').getAttribute('maxlength'),
      send: document.getElementById('fb-send').textContent,
      disabled: document.getElementById('fb-send').disabled
    };
  });
  assert.strictEqual(form.title, 'Send feedback');
  assert.strictEqual(form.pageLabel, 'Page');
  assert.strictEqual(form.page, 'Workouts');
  assert.strictEqual(form.type, 'TYPE');
  assert.deepStrictEqual(form.choices, ['Bug', 'Idea', 'Other']);
  assert.strictEqual(form.message, 'MESSAGE');
  assert.strictEqual(form.placeholder, 'What’s on your mind?');
  assert.strictEqual(form.max, '2000');
  assert.strictEqual(form.send, 'Send');
  assert.strictEqual(form.disabled, true);
  await p.screenshot({ path: ART + '/feedback-form.png' });

  await p.click('[data-fb-type="bug"]');
  assert.strictEqual(await p.$eval('#fb-send', function (el) { return el.disabled; }), true);
  await p.type('#fb-message', '   ');
  assert.strictEqual(await p.$eval('#fb-send', function (el) { return el.disabled; }), true);
  await p.click('#fb-message', { clickCount: 3 });
  await p.type('#fb-message', 'The rest timer skips ahead.');
  assert.strictEqual(await p.$eval('#fb-send', function (el) { return el.disabled; }), false);
  await p.evaluate(function () {
    var box = document.getElementById('fb-message');
    box.value = '';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.strictEqual(await p.$eval('#fb-send', function (el) { return el.disabled; }), true);
  await p.type('#fb-message', 'The rest timer skips ahead.');
  await p.click('#fb-send');
  await p.waitForFunction(function () { return document.getElementById('fb-title') && document.getElementById('fb-title').textContent === 'Thank you'; });
  const thanks = await p.evaluate(function () {
    return {
      title: document.getElementById('fb-title').textContent,
      body: document.querySelector('.fb-thanks p').textContent,
      done: document.getElementById('fb-done').textContent,
      sent: window.__submitted
    };
  });
  assert.strictEqual(thanks.title, 'Thank you');
  assert.strictEqual(thanks.body, 'We’ve got your message.');
  assert.strictEqual(thanks.done, 'Done');
  assert.deepStrictEqual(thanks.sent, { page: 'Workouts', type: 'bug', message: 'The rest timer skips ahead.' });
  await p.screenshot({ path: ART + '/feedback-thanks.png' });
  await p.click('#fb-done');
  await p.waitForFunction(function () { return !document.getElementById('fb-sheet') && !document.getElementById('feedback-open').hidden; });

  await p.click('[data-a=run]');
  await p.waitForSelector('.pl-screen');
  assert.strictEqual(await p.$eval('#feedback-open', function (el) { return el.hidden; }), true);

  await p.evaluate(function () {
    window.__mode = 'admin';
    location.hash = '#/admin';
  });
  await p.waitForSelector('[data-feedback="fb-new"]');
  const list = await p.evaluate(function () {
    var section = document.getElementById('feedback-section');
    var cards = Array.prototype.map.call(section.querySelectorAll('[data-feedback]'), function (el) { return el.getAttribute('data-feedback'); });
    var card = document.querySelector('[data-feedback="fb-new"]');
    return {
      heading: section.querySelector('.sec').textContent,
      cards: cards,
      text: card.innerText,
      section: section.innerText,
      status: card.querySelector('select').value,
      reply: card.querySelector('[data-fb-reply]').textContent
    };
  });
  assert.strictEqual(list.heading, 'Feedback');
  assert.deepStrictEqual(list.cards, ['fb-new', 'fb-old']);
  assert.ok(list.text.indexOf('Ada Client') !== -1);
  assert.ok(list.text.indexOf('Workouts') !== -1);
  assert.ok(list.text.indexOf('Bug') !== -1);
  assert.ok(list.text.indexOf('Nov 25, 2026') !== -1);
  assert.ok(list.text.indexOf('The rest timer skips ahead.') !== -1);
  assert.strictEqual(list.status, 'new');
  assert.strictEqual(list.reply, 'Reply');
  assert.strictEqual(list.section.indexOf('@'), -1);
  await p.screenshot({ path: ART + '/feedback-admin.png' });

  await p.select('[data-feedback="fb-old"] select.fb-pill', 'fixed');
  await p.waitForFunction(function () { return window.__status && window.__status.id === 'fb-old' && window.__status.status === 'fixed'; });
  assert.strictEqual(await p.$eval('[data-feedback="fb-old"] select', function (el) { return el.value; }), 'fixed');

  await p.click('[data-feedback="fb-new"] [data-fb-reply]');
  await p.waitForSelector('#fb-reply');
  const reply = await p.evaluate(function () {
    var box = document.getElementById('fb-reply');
    return {
      header: box.querySelector('.fb-reply-h').textContent,
      to: box.querySelector('.fb-to').textContent,
      placeholder: document.getElementById('fb-reply-text').getAttribute('placeholder'),
      note: box.querySelector('.fb-note').textContent,
      send: document.getElementById('fb-reply-send').textContent,
      disabled: document.getElementById('fb-reply-send').disabled
    };
  });
  assert.strictEqual(reply.header, 'REPLY IN MESSAGES');
  assert.strictEqual(reply.to, 'To Ada Client');
  assert.strictEqual(reply.placeholder, 'Message');
  assert.strictEqual(reply.note, 'This is sent as a message in the app.');
  assert.strictEqual(reply.send, 'Send');
  assert.strictEqual(reply.disabled, true);
  await p.screenshot({ path: ART + '/feedback-reply.png' });
  await p.type('#fb-reply-text', 'Thanks, we saw this.');
  assert.strictEqual(await p.$eval('#fb-reply-send', function (el) { return el.disabled; }), false);
  await p.click('#fb-reply-send');
  await p.waitForFunction(function () {
    var pill = document.querySelector('[data-feedback="fb-new"] select');
    return window.__sent.length === 1 && window.__status && window.__status.id === 'fb-new' && pill && pill.value === 'replied';
  });
  const sent = await p.evaluate(function () { return window.__sent[0]; });
  assert.strictEqual(sent.personId, USER);
  assert.strictEqual(sent.body, 'Thanks, we saw this.');
  assert.ok(sent.messageId);
  assert.strictEqual(await p.$('#fb-reply'), null);

  await p.evaluate(function () {
    window.__mode = 'out';
    location.hash = '';
  });
  await p.waitForFunction(function () {
    var btn = document.getElementById('feedback-open');
    return document.documentElement.classList.contains('wb-landing') && btn && btn.hidden;
  });
  assert.deepStrictEqual(errs, []);
  console.log('FEEDBACK UI OK');
  await b.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
