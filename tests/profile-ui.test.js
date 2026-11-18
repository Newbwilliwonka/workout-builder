// Account profile window at phone width. No live database.
// node tests/profile-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';
const PROMPT = 'To protect your email account from spammers, please enter a name in your profile before proceeding.';

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  fs.writeFileSync('/tmp/tiny-avatar.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const chrome = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
  const b = await pp.launch({ executablePath: chrome, args: ['--no-sandbox', '--hide-scrollbars'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', function (e) { errs.push(String(e)); });
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument(function () {
    var profile = {
      id: 'allow-test',
      email: 'kinisiathletics@gmail.com',
      membership: 'enthusiast',
      intended_plan: 'enthusiast',
      profileReady: true,
      display_name: null,
      city: null,
      state: null,
      online_only: false,
      bio: null,
      avatar_path: null,
      avatarUrl: ''
    };
    window.__profile = profile;
    window.__signedOut = false;
    window.__photo = null;
    var session = { user: { id: 'allow-test', email: 'kinisiathletics@gmail.com' } };
    var current;
    function patch(api) {
      if (api) api.TURNSTILE_SITE_KEY = '';
      if (!api || api.__profileStub) return api;
      api.__profileStub = true;
      api.session = function () { return Promise.resolve(session); };
      api.freshSession = function () { return api.session(); };
      api.profile = function () { return Promise.resolve(window.__profile); };
      api.roster = function () { return Promise.resolve({ role: null, clients: [] }); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.workoutCopies = function () { return Promise.resolve([]); };
      api.shareSetting = function () { return Promise.resolve({ on: false, enthusiast: true }); };
      api.accountPull = function () { return Promise.resolve([]); };
      api.accountImport = function () { return Promise.resolve({ localId: 'skip', revisedAt: 1 }); };
      api.signOut = function () { window.__signedOut = true; return Promise.resolve(); };
      api.saveProfile = function (fields) {
        window.__profile.display_name = fields.display_name;
        window.__profile.city = fields.city;
        window.__profile.state = fields.state;
        window.__profile.online_only = fields.online_only;
        window.__profile.bio = fields.bio;
        if (Object.prototype.hasOwnProperty.call(fields, 'listed')) window.__profile.listed = fields.listed;
        if (Object.prototype.hasOwnProperty.call(fields, 'service_type')) window.__profile.service_type = fields.service_type;
        if (fields.avatar_path) {
          window.__profile.avatar_path = fields.avatar_path;
          window.__profile.avatarUrl = 'https://example.test/avatar.jpg';
        }
        window.__saved = Object.assign({}, window.__profile);
        return Promise.resolve(Object.assign({}, window.__profile));
      };
      api.uploadAvatar = function (blob) {
        window.__photo = { type: blob.type, size: blob.size };
        return Promise.resolve('allow-test/avatar.jpg');
      };
      api.avatarUrl = function (path) { return Promise.resolve(path ? 'https://example.test/avatar.jpg' : ''); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });

  await p.goto(URL + '#/signin', { waitUntil: 'networkidle0' });
  await p.waitForSelector('#acct-email');
  const signIn = await p.evaluate(function () {
    return {
      title: document.querySelector('h2') && document.querySelector('h2').textContent,
      code: !!document.getElementById('invite-code'),
      prompt: !!document.getElementById('profile-prompt'),
      name: !!document.getElementById('profile-name')
    };
  });
  assert.strictEqual(signIn.title, 'Sign in');
  assert.strictEqual(signIn.code, true);
  assert.strictEqual(signIn.prompt, false);
  assert.strictEqual(signIn.name, false);

  await p.evaluate(function () { location.hash = '#/'; });
  await p.waitForSelector('#profile-prompt');
  const gate = await p.evaluate(function (prompt) {
    var note = document.getElementById('profile-prompt');
    var link = document.getElementById('account-signout');
    var title = document.getElementById('title').getBoundingClientRect();
    var sign = link.getBoundingClientRect();
    return {
      text: note.textContent,
      first: note.compareDocumentPosition(document.getElementById('profile-title')) & Node.DOCUMENT_POSITION_FOLLOWING,
      cancel: !!document.getElementById('profile-cancel'),
      signText: link.textContent,
      signHidden: link.hidden,
      sameLine: Math.abs((title.top + title.height / 2) - (sign.top + sign.height / 2)) < 14,
      signRight: sign.left > title.left,
      backHidden: document.getElementById('back').hidden
    };
  }, PROMPT);
  assert.strictEqual(gate.text, PROMPT);
  assert.ok(gate.first);
  assert.strictEqual(gate.cancel, false);
  assert.strictEqual(gate.signText, 'Sign out');
  assert.strictEqual(gate.signHidden, false);
  assert.strictEqual(gate.sameLine, true);
  assert.strictEqual(gate.signRight, true);
  assert.strictEqual(gate.backHidden, true);
  const signHit = await p.evaluate(function () {
    var link = document.getElementById('account-signout');
    var box = link.getBoundingClientRect();
    var x = Math.round(box.left + box.width / 2);
    var y = Math.round(box.top + box.height / 2);
    var el = document.elementFromPoint(x, y);
    var note = document.getElementById('profile-prompt').getBoundingClientRect();
    return { id: el && el.id, noteTop: note.top, barBottom: document.querySelector('.bar').getBoundingClientRect().bottom };
  });
  assert.strictEqual(signHit.id, 'account-signout');
  assert.ok(signHit.noteTop >= signHit.barBottom - 1, 'name note sits under the header');
  await p.click('#profile-sheet');
  assert.ok(await p.$('#profile-prompt'));
  await p.click('#profile-save');
  await p.waitForSelector('#profile-error');
  const blocked = await p.evaluate(function () {
    var note = document.getElementById('profile-prompt').getBoundingClientRect();
    var err = document.getElementById('profile-error').getBoundingClientRect();
    return {
      text: document.getElementById('profile-error').textContent,
      name: document.getElementById('profile-name').classList.contains('is-empty'),
      city: !!document.getElementById('profile-city'),
      shown: !document.getElementById('profile-error').hidden,
      promptTop: note.top,
      promptBottom: note.bottom,
      promptH: note.height,
      errorTop: err.top,
      viewH: window.innerHeight
    };
  });
  assert.strictEqual(blocked.text, 'Fill in the highlighted fields.');
  assert.strictEqual(blocked.name, true);
  assert.strictEqual(blocked.city, false);
  assert.strictEqual(blocked.shown, true);
  assert.ok(blocked.promptH > 20, 'prompt has no height');
  assert.ok(blocked.promptTop >= 0 && blocked.promptBottom <= blocked.viewH, 'prompt is off screen');
  assert.ok(blocked.errorTop < blocked.viewH, 'validation note is off screen');
  await p.screenshot({ path: ART + '/profile-required.png' });

  await p.type('#profile-name', 'J');
  await p.click('#profile-save');
  await p.waitForFunction(function () { return !document.getElementById('profile-sheet') && document.getElementById('title').textContent === 'Workouts'; });
  const savedNick = await p.evaluate(function () { return window.__saved.display_name; });
  assert.strictEqual(savedNick, 'J');

  await p.evaluate(function () { location.hash = '#/account'; });
  await p.waitForSelector('#account-label');
  await p.waitForSelector('#profile-edit');
  const account = await p.evaluate(function () {
    var card = document.getElementById('account-card');
    var link = document.getElementById('account-signout');
    var edit = document.getElementById('profile-edit');
    var plan = edit.parentElement;
    var style = getComputedStyle(link);
    var editStyle = getComputedStyle(edit);
    var title = document.getElementById('title').getBoundingClientRect();
    var sign = link.getBoundingClientRect();
    var planBox = plan.getBoundingClientRect();
    var editBox = edit.getBoundingClientRect();
    return {
      label: document.getElementById('account-label').textContent,
      cardText: card.innerText,
      signOutButtons: card.querySelectorAll('button').length,
      buttonIds: Array.prototype.map.call(card.querySelectorAll('button'), function (b) { return b.id; }),
      old: !!document.querySelector('[data-auth=out]'),
      signTag: link.tagName,
      bg: style.backgroundColor,
      radius: style.borderRadius,
      decoration: style.textDecorationLine,
      sameLine: Math.abs((title.top + title.height / 2) - (sign.top + sign.height / 2)) < 14,
      signRight: sign.right > title.right,
      editTag: edit.tagName,
      editType: edit.getAttribute('type'),
      editText: edit.textContent,
      planText: plan.textContent,
      editColor: editStyle.color,
      editDecoration: editStyle.textDecorationLine,
      editBg: editStyle.backgroundColor,
      editSameLine: Math.abs((planBox.top + planBox.height / 2) - (editBox.top + editBox.height / 2)) < 8,
      editAfterPlan: editBox.left > planBox.left
    };
  });
  assert.strictEqual(account.label, 'J');
  assert.ok(account.cardText.indexOf('kinisiathletics@gmail.com') === -1);
  assert.ok(account.cardText.indexOf('Sign out') === -1);
  assert.strictEqual(account.signOutButtons, 2);
  assert.deepStrictEqual(account.buttonIds, ['profile-open', 'profile-edit']);
  assert.strictEqual(account.old, false);
  assert.strictEqual(account.signTag, 'A');
  assert.ok(account.bg === 'rgba(0, 0, 0, 0)' || account.bg === 'transparent');
  assert.strictEqual(account.radius, '0px');
  assert.strictEqual(account.decoration, 'none');
  assert.strictEqual(account.sameLine, true);
  assert.strictEqual(account.signRight, true);
  assert.strictEqual(account.editTag, 'BUTTON');
  assert.strictEqual(account.editType, 'button');
  assert.strictEqual(account.editText, 'Edit profile');
  assert.strictEqual(account.planText, 'Enthusiast · Edit profile');
  assert.strictEqual(account.editColor, 'rgb(37, 99, 235)');
  assert.strictEqual(account.editDecoration, 'underline');
  assert.ok(account.editBg === 'rgba(0, 0, 0, 0)' || account.editBg === 'transparent');
  assert.strictEqual(account.editSameLine, true);
  assert.strictEqual(account.editAfterPlan, true);
  await p.screenshot({ path: ART + '/account-after.png' });
  await p.screenshot({ path: ART + '/account-edit-profile.png' });

  await p.click('#profile-edit');
  await p.waitForSelector('#profile-name');
  const fromEdit = await p.evaluate(function () {
    return {
      name: document.getElementById('profile-name').value,
      save: !!document.getElementById('profile-save'),
      cancel: !!document.getElementById('profile-cancel'),
      required: document.getElementById('profile-sheet').getAttribute('data-required')
    };
  });
  assert.strictEqual(fromEdit.name, 'J');
  assert.strictEqual(fromEdit.save, true);
  assert.strictEqual(fromEdit.cancel, true);
  assert.notStrictEqual(fromEdit.required, '1');
  await p.click('#profile-cancel');
  await p.waitForFunction(function () { return !document.getElementById('profile-sheet'); });

  await p.focus('#profile-edit');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#profile-sheet');
  assert.strictEqual(await p.$eval('#profile-name', function (el) { return el.value; }), 'J');
  await p.keyboard.press('Escape');
  await p.waitForFunction(function () { return !document.getElementById('profile-sheet'); });

  await p.click('#profile-open');
  await p.waitForSelector('#profile-bio');
  await p.type('#profile-bio', 'Kettlebells and city parks');
  const counter = await p.$eval('#profile-count', function (el) { return el.textContent; });
  assert.strictEqual(counter, '26/150');
  assert.strictEqual(await p.$('#profile-prompt'), null);
  await p.screenshot({ path: ART + '/profile-open.png' });
  await p.click('#profile-cancel');
  await p.waitForFunction(function () { return !document.getElementById('profile-sheet'); });

  await p.evaluate(function () {
    window.__profile.membership = 'trainer';
    window.__profile.intended_plan = 'trainer';
    window.__profile.display_name = 'Coach';
  });
  await p.click('#profile-open');
  await p.waitForSelector('#profile-name');
  await p.click('#profile-name');
  await p.evaluate(function () { document.getElementById('profile-name').select(); });
  await p.keyboard.press('Backspace');
  await p.click('#profile-save');
  await p.waitForSelector('#profile-error');
  const trainerBlock = await p.evaluate(function () {
    return {
      text: document.getElementById('profile-error').textContent,
      name: document.getElementById('profile-name').classList.contains('is-empty'),
      city: !!document.getElementById('profile-city'),
      state: !!document.getElementById('profile-state'),
      online: !!document.getElementById('profile-online'),
      serviceHidden: document.getElementById('profile-service-block').hidden,
      placeHidden: document.getElementById('profile-pin').hidden
    };
  });
  assert.strictEqual(trainerBlock.text, 'Fill in the highlighted fields.');
  assert.strictEqual(trainerBlock.name, true);
  assert.strictEqual(trainerBlock.city, false);
  assert.strictEqual(trainerBlock.state, false);
  assert.strictEqual(trainerBlock.online, false);
  assert.strictEqual(trainerBlock.serviceHidden, true);
  assert.strictEqual(trainerBlock.placeHidden, true);
  await p.screenshot({ path: ART + '/profile-validation.png' });

  await p.type('#profile-name', 'Ace');
  await p.click('#profile-save');
  await p.waitForFunction(function () { return !document.getElementById('profile-sheet') && document.getElementById('account-label').textContent === 'Ace'; });
  const named = await p.evaluate(function () { return window.__saved; });
  assert.strictEqual(named.display_name, 'Ace');
  assert.strictEqual(named.online_only, false);
  assert.strictEqual(named.city, null);

  await p.click('#profile-open');
  await p.waitForSelector('#profile-listed');
  await p.click('#profile-listed');
  await p.select('#profile-service', 'online');
  await p.click('#profile-save');
  await p.waitForFunction(function () { return !document.getElementById('profile-sheet') && document.getElementById('account-label').textContent === 'Ace'; });
  const onlineSaved = await p.evaluate(function () { return window.__saved; });
  assert.strictEqual(onlineSaved.display_name, 'Ace');
  assert.strictEqual(onlineSaved.online_only, true);
  assert.strictEqual(onlineSaved.service_type, 'online');
  assert.strictEqual(onlineSaved.city, null);

  const resized = await p.evaluate(async function () {
    var canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 400;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(0, 0, 800, 400);
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
    var file = new File([blob], 'wide.png', { type: 'image/png' });
    var out = await WBProfile.preparePhoto(file);
    var bmp = await createImageBitmap(out);
    return { type: out.type, w: bmp.width, h: bmp.height, size: out.size, source: blob.size };
  });
  assert.strictEqual(resized.type, 'image/jpeg');
  assert.strictEqual(resized.w, 256);
  assert.strictEqual(resized.h, 128);
  assert.ok(resized.size < resized.source);

  await p.click('#profile-open');
  await p.waitForSelector('#profile-file');
  const input = await p.$('#profile-file');
  await input.uploadFile('/tmp/tiny-avatar.png');
  await p.waitForSelector('#profile-photo img');
  await p.click('#profile-save');
  await p.waitForFunction(function () {
    var img = document.querySelector('#profile-open img');
    return img && img.getAttribute('src') === 'https://example.test/avatar.jpg';
  });
  const photo = await p.evaluate(function () { return window.__photo; });
  assert.strictEqual(photo.type, 'image/jpeg');
  assert.ok(photo.size < 200000);

  await p.click('#account-signout');
  await p.waitForFunction(function () { return window.__signedOut && document.querySelector('h2') && document.querySelector('h2').textContent === 'Sign in'; });
  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('profile ui ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
