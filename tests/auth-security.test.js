// Confirm password on sign-up, and Turnstile only when a site key is set.
// node tests/auth-security.test.js [url]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const root = path.join(__dirname, '..');
const authSrc = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.ok(/var TURNSTILE_SITE_KEY = '';/.test(authSrc), 'site key stays empty');
assert.ok(authSrc.indexOf('TURNSTILE_SITE_KEY: TURNSTILE_SITE_KEY') !== -1, 'site key is public on WBAuth');
assert.ok(authSrc.indexOf('options.captchaToken = captchaToken') !== -1, 'sign-up passes options.captchaToken');
assert.ok(authSrc.indexOf('credentials.options = { captchaToken: captchaToken }') !== -1, 'sign-in passes options.captchaToken');
assert.ok(authSrc.indexOf('options.captchaToken = captchaToken') !== -1 && authSrc.indexOf('resetPasswordForEmail') !== -1, 'reset passes captchaToken');
assert.ok(authSrc.indexOf('redirectTo: REDIRECT') !== -1, 'reset keeps the shared redirect');
assert.ok(appSrc.indexOf('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit') !== -1, 'explicit Turnstile script');
assert.ok(appSrc.indexOf("Passwords don't match.") !== -1, 'sign-up mismatch copy');
assert.ok(appSrc.indexOf('Those passwords do not match.') !== -1, 'reset screen keeps its own mismatch copy');
assert.strictEqual(appSrc.split('h += captchaHtml()').length - 1, 2, 'captcha only on sign-in/up and forgot');
assert.ok(!/TURNSTILE_SECRET|captcha_secret|secretKey\s*[:=]/i.test(authSrc + '\n' + appSrc), 'no secret key in the client');

const FAKE = [
  'window.__tw = 0; window.__widgets = []; window.__resets = []; window.__removes = [];',
  'window.turnstile = {',
  '  render: function (el, opts) {',
  '    var id = "w" + (++window.__tw);',
  '    window.__widgets.push({ id: id, opts: opts, sitekey: opts.sitekey, size: opts.size, theme: opts.theme, appearance: opts.appearance });',
  '    el.setAttribute("data-widget", id);',
  '    return id;',
  '  },',
  '  reset: function (id) { window.__resets.push(id); },',
  '  remove: function (id) { window.__removes.push(id); },',
  '  ready: function (fn) { fn(); }',
  '};'
].join('\n');

(async () => {
  const chrome = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
  const b = await pp.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  const errs = [];
  const scriptUrls = [];
  const p = await b.newPage();
  p.on('pageerror', function (e) { errs.push(String(e)); });
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await p.setRequestInterception(true);
  p.on('request', function (req) {
    var url = req.url();
    if (url.indexOf('challenges.cloudflare.com/turnstile/v0/api.js') !== -1) {
      scriptUrls.push(url);
      req.respond({ status: 200, contentType: 'application/javascript', body: FAKE });
      return;
    }
    req.continue();
  });

  await p.goto(URL + '#/signin', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-auth=in]');
  assert.strictEqual(await p.$('#confirm-pass'), null, 'sign-in has no confirm password');
  assert.strictEqual(await p.$('#turnstile-box'), null, 'empty site key skips the widget');
  assert.strictEqual(await p.$eval('[data-auth=in]', function (el) { return el.disabled; }), false);
  await p.evaluate(function () { location.hash = '#/join'; });
  await p.waitForFunction(function () {
    return document.querySelector('h2') && document.querySelector('h2').textContent === 'Create your account' && document.getElementById('confirm-pass');
  });
  const order = await p.evaluate(function () {
    var html = document.querySelector('.gate').innerHTML;
    return {
      pass: html.indexOf('for="acct-pass"'),
      confirm: html.indexOf('for="confirm-pass"'),
      invite: html.indexOf('for="invite-code"'),
      label: document.querySelector('label[for="confirm-pass"]').textContent,
      type: document.getElementById('confirm-pass').type,
      auto: document.getElementById('confirm-pass').getAttribute('autocomplete')
    };
  });
  assert.ok(order.pass !== -1 && order.pass < order.confirm && order.confirm < order.invite, 'confirm sits under password');
  assert.strictEqual(order.label, 'Confirm password');
  assert.strictEqual(order.type, 'password');
  assert.strictEqual(order.auto, 'new-password');
  assert.strictEqual(await p.$('#turnstile-box'), null);
  assert.deepStrictEqual(scriptUrls, []);

  await p.evaluate(function () {
    window.__signUp = null;
    window.WBAuth.signUp = function () {
      window.__signUp = Array.prototype.slice.call(arguments);
      return Promise.resolve({ session: null, needsConfirmation: true });
    };
  });
  await p.type('#acct-email', 'ada@example.com');
  await p.type('#acct-pass', 'secret12');
  await p.type('#confirm-pass', 'secret12');
  await p.click('[data-auth=up]');
  await p.waitForFunction(function () { return document.body.innerText.indexOf('at least 10 characters') !== -1; });
  assert.strictEqual(await p.evaluate(function () { return window.__signUp; }), null, 'short password still blocks sign-up');

  await p.type('#acct-email', 'ada@example.com');
  await p.type('#acct-pass', 'secret1234');
  await p.type('#confirm-pass', 'secret12345');
  await p.click('[data-auth=up]');
  await p.waitForFunction(function () {
    var box = document.querySelector('.errs');
    return box && box.textContent === "Passwords don't match.";
  });
  assert.strictEqual(await p.evaluate(function () { return window.__signUp; }), null, 'mismatch does not call sign-up');

  await p.type('#acct-email', 'ada@example.com');
  await p.type('#acct-pass', 'secret1234');
  await p.type('#confirm-pass', 'secret1234');
  await p.click('[data-auth=up]');
  await p.waitForFunction(function () {
    return location.hash === '#/signin' && document.body.innerText.indexOf('Check your email to confirm the account, then sign in.') !== -1;
  });
  assert.deepStrictEqual(await p.evaluate(function () { return window.__signUp; }), ['ada@example.com', 'secret1234']);

  await p.evaluate(function () {
    window.__signIn = null;
    window.WBAuth.signIn = function () {
      window.__signIn = Array.prototype.slice.call(arguments);
      return Promise.reject(new Error('Invalid login credentials'));
    };
  });
  await p.type('#acct-email', 'ada@example.com');
  await p.type('#acct-pass', 'secret1234');
  await p.click('[data-auth=in]');
  await p.waitForFunction(function () {
    var box = document.querySelector('.errs');
    return box && box.textContent === 'Invalid login credentials';
  });
  assert.deepStrictEqual(await p.evaluate(function () { return window.__signIn; }), ['ada@example.com', 'secret1234']);

  await p.evaluate(function () {
    window.__reset = null;
    window.WBAuth.requestPasswordReset = function () {
      window.__reset = Array.prototype.slice.call(arguments);
      return Promise.resolve(true);
    };
    location.hash = '#/forgot';
  });
  await p.waitForSelector('#reset-email');
  assert.strictEqual(await p.$('#turnstile-box'), null, 'forgot skips captcha when the key is empty');
  assert.strictEqual(await p.$eval('[data-auth=send-reset]', function (el) { return el.disabled; }), false);
  await p.type('#reset-email', 'ada@example.com');
  await p.click('[data-auth=send-reset]');
  await p.waitForFunction(function () { return document.querySelector('h2') && document.querySelector('h2').textContent === 'Check your email'; });
  assert.deepStrictEqual(await p.evaluate(function () { return window.__reset; }), ['ada@example.com']);
  assert.deepStrictEqual(scriptUrls, [], 'empty site key never loads Turnstile');

  await p.evaluate(function () {
    window.WBAuth.TURNSTILE_SITE_KEY = 'site-key-for-tests';
    location.hash = '#/join';
  });
  await p.waitForSelector('#turnstile-box[data-widget]');
  assert.ok(scriptUrls.length >= 1, 'script loads once the site key is set');
  assert.ok(scriptUrls[0].indexOf('https://challenges.cloudflare.com/turnstile/v0/api.js') === 0, scriptUrls[0]);
  assert.ok(scriptUrls[0].indexOf('render=explicit') !== -1, scriptUrls[0]);
  const widget = await p.evaluate(function () {
    var s = document.querySelector('script[data-wb-turnstile]');
    var w = window.__widgets[window.__widgets.length - 1];
    return {
      integrity: s ? s.integrity : 'missing',
      sitekey: w.sitekey,
      size: w.size,
      theme: w.theme,
      appearance: w.appearance,
      disabled: document.querySelector('[data-auth=up]').disabled
    };
  });
  assert.strictEqual(widget.integrity, '');
  assert.strictEqual(widget.sitekey, 'site-key-for-tests');
  assert.strictEqual(widget.size, 'flexible');
  assert.strictEqual(widget.theme, 'light');
  assert.strictEqual(widget.appearance, 'always');
  assert.strictEqual(widget.disabled, true, 'submit waits for a token');

  await p.evaluate(function () { window.__widgets[window.__widgets.length - 1].opts['expired-callback'](); });
  await p.waitForFunction(function () {
    var note = document.getElementById('captcha-note');
    return note && !note.hidden && note.textContent === 'That check expired. Please try again.' && document.querySelector('[data-auth=up]').disabled;
  });
  assert.ok((await p.evaluate(function () { return window.__resets.length; })) >= 1, 'expired widget is reset');

  await p.evaluate(function () { window.__widgets[window.__widgets.length - 1].opts['error-callback'](); });
  await p.waitForFunction(function () {
    var note = document.getElementById('captcha-note');
    return note && note.textContent === 'The check did not go through. Please try again.' && document.querySelector('[data-auth=up]').disabled;
  });

  await p.evaluate(function () { window.__widgets[window.__widgets.length - 1].opts.callback('tok-signup'); });
  await p.waitForFunction(function () {
    var note = document.getElementById('captcha-note');
    return document.querySelector('[data-auth=up]').disabled === false && (!note || note.hidden);
  });
  await p.evaluate(function () {
    window.__signUp = null;
    window.__resets = [];
    window.WBAuth.signUp = function () {
      window.__signUp = Array.prototype.slice.call(arguments);
      return Promise.reject(new Error('captcha protection: request disallowed'));
    };
  });
  await p.type('#acct-email', 'ada@example.com');
  await p.type('#acct-pass', 'secret1234');
  await p.type('#confirm-pass', 'secret1234');
  await p.click('[data-auth=up]');
  await p.waitForFunction(function () {
    var box = document.querySelector('.errs');
    return box && box.textContent === 'The check did not go through. Please try again.' && document.querySelector('#turnstile-box[data-widget]');
  });
  assert.deepStrictEqual(await p.evaluate(function () { return window.__signUp; }), ['ada@example.com', 'secret1234', 'tok-signup']);
  const afterFail = await p.evaluate(function () {
    return {
      resets: window.__resets.slice(),
      renders: window.__widgets.length,
      disabled: document.querySelector('[data-auth=up]').disabled
    };
  });
  assert.ok(afterFail.resets.length >= 1, 'token is reset after a failed attempt');
  assert.ok(afterFail.renders >= 2, 'a fresh widget is mounted after the attempt');
  assert.strictEqual(afterFail.disabled, true, 'the used token cannot be submitted again');

  await p.evaluate(function () { window.__widgets[window.__widgets.length - 1].opts.callback('tok-signup-2'); });
  await p.waitForFunction(function () { return document.querySelector('[data-auth=up]').disabled === false; });
  await p.evaluate(function () {
    window.WBAuth.signUp = function () {
      window.__signUp = Array.prototype.slice.call(arguments);
      return Promise.resolve({ session: null, needsConfirmation: true });
    };
  });
  await p.type('#acct-email', 'ada@example.com');
  await p.type('#acct-pass', 'secret1234');
  await p.type('#confirm-pass', 'secret1234');
  await p.click('[data-auth=up]');
  await p.waitForFunction(function () { return location.hash === '#/signin' && document.body.innerText.indexOf('Check your email to confirm the account, then sign in.') !== -1; });
  assert.deepStrictEqual(await p.evaluate(function () { return window.__signUp; }), ['ada@example.com', 'secret1234', 'tok-signup-2']);

  await p.waitForSelector('#turnstile-box[data-widget]');
  assert.strictEqual(await p.$eval('[data-auth=in]', function (el) { return el.disabled; }), true, 'sign-in also waits for a token');
  await p.evaluate(function () {
    window.__signIn = null;
    window.WBAuth.signIn = function () {
      window.__signIn = Array.prototype.slice.call(arguments);
      return Promise.reject(new Error('Invalid login credentials'));
    };
    window.__widgets[window.__widgets.length - 1].opts.callback('tok-signin');
  });
  await p.waitForFunction(function () { return document.querySelector('[data-auth=in]').disabled === false; });
  await p.type('#acct-email', 'ada@example.com');
  await p.type('#acct-pass', 'secret1234');
  await p.click('[data-auth=in]');
  await p.waitForFunction(function () {
    var box = document.querySelector('.errs');
    return box && box.textContent === 'Invalid login credentials';
  });
  assert.deepStrictEqual(await p.evaluate(function () { return window.__signIn; }), ['ada@example.com', 'secret1234', 'tok-signin']);

  await p.evaluate(function () {
    window.__reset = null;
    window.__resets = [];
    window.WBAuth.requestPasswordReset = function () {
      window.__reset = Array.prototype.slice.call(arguments);
      return Promise.reject(new Error('captcha verification failed'));
    };
    location.hash = '#/forgot';
  });
  await p.waitForSelector('#turnstile-box[data-widget]');
  assert.strictEqual(await p.$eval('[data-auth=send-reset]', function (el) { return el.disabled; }), true);
  await p.evaluate(function () { window.__widgets[window.__widgets.length - 1].opts.callback('tok-reset'); });
  await p.waitForFunction(function () { return document.querySelector('[data-auth=send-reset]').disabled === false; });
  await p.type('#reset-email', 'ada@example.com');
  await p.click('[data-auth=send-reset]');
  await p.waitForFunction(function () {
    var box = document.querySelector('.errs');
    return box && box.textContent === 'The check did not go through. Please try again.' && document.getElementById('reset-email');
  });
  assert.deepStrictEqual(await p.evaluate(function () { return window.__reset; }), ['ada@example.com', 'tok-reset']);
  assert.ok((await p.evaluate(function () { return window.__resets.length; })) >= 1, 'reset link attempt resets the widget');
  assert.strictEqual(await p.$eval('[data-auth=send-reset]', function (el) { return el.disabled; }), true);

  await p.setViewport({ width: 320, height: 700, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await p.evaluate(function () { location.hash = '#/signin'; });
  await p.waitForSelector('#turnstile-box[data-widget]');
  assert.strictEqual(await p.evaluate(function () { return window.__widgets[window.__widgets.length - 1].size; }), 'compact');
  assert.strictEqual(await p.$('#confirm-pass'), null, 'narrow sign-in still has no confirm field');

  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('auth security ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
