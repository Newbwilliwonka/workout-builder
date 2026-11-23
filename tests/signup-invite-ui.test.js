// Create-account invite box, sign-up metadata, and the unlinked account box.
// node tests/signup-invite-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const chrome = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
  const b = await pp.launch({ executablePath: chrome, args: ['--no-sandbox', '--hide-scrollbars'] });
  const errs = [];

  async function page() {
    const p = await b.newPage();
    p.on('pageerror', function (e) { errs.push(String(e)); });
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    return p;
  }

  const signedOut = await page();
  await signedOut.evaluateOnNewDocument(function () {
    var current;
    function patch(api) {
      if (!api || api.__shotStub) return api;
      api.__shotStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () { return Promise.resolve(null); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });
  await signedOut.goto(URL + '#/signin', { waitUntil: 'networkidle0' });
  await signedOut.waitForFunction(function () {
    return document.querySelector('h2') && document.querySelector('h2').textContent === 'Sign in' && !document.getElementById('invite-code') && document.getElementById('acct-email');
  });
  await signedOut.screenshot({ path: ART + '/signin_no_invite_code.png' });

  await signedOut.goto(URL + '?invite=ABCD2345#/signin', { waitUntil: 'domcontentloaded' });
  await signedOut.waitForFunction(function () {
    var h = document.querySelector('h2');
    var code = document.getElementById('invite-code');
    return location.hash === '#/join' && h && h.textContent === 'Create your account' && code && code.value === 'ABCD-2345';
  });
  await signedOut.screenshot({ path: ART + '/join_prefilled_invite.png' });
  assert.strictEqual(await signedOut.evaluate(function () { return sessionStorage.getItem('wb.invite'); }), 'ABCD2345');
  await signedOut.click('[data-auth=switch]');
  await signedOut.waitForFunction(function () {
    return location.hash === '#/signin' && !document.getElementById('invite-code') && sessionStorage.getItem('wb.invite') === 'ABCD2345';
  });
  await signedOut.close();

  const confirm = await page();
  await confirm.evaluateOnNewDocument(function () {
    var current;
    function patch(api) {
      if (!api || api.__signupStub) return api;
      api.__signupStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () { return Promise.resolve(null); };
      api.signUp = function (email, password, captcha, code) {
        window.__signup = { email: email, code: code };
        return Promise.resolve({ needsConfirmation: true });
      };
      api.redeemInvite = function () { window.__redeemed = 1; return Promise.resolve({}); };
      api.forgetInviteCode = function () { return Promise.resolve(false); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });
  await confirm.goto(URL + '#/join', { waitUntil: 'networkidle0' });
  await confirm.waitForSelector('#invite-code');
  await confirm.type('#acct-email', 'new@example.com');
  await confirm.type('#acct-pass', 'secret1234');
  await confirm.type('#confirm-pass', 'secret1234');
  await confirm.type('#invite-code', 'ABCD2345');
  await confirm.click('[data-auth=up]');
  await confirm.waitForFunction(function () {
    return location.hash === '#/signin'
      && document.body.innerText.indexOf('Check your email to confirm the account, then sign in.') !== -1
      && sessionStorage.getItem('wb.invite') === 'ABCD2345'
      && !window.__redeemed;
  });
  assert.deepStrictEqual(await confirm.evaluate(function () { return window.__signup; }), { email: 'new@example.com', code: 'ABCD2345' });
  await confirm.close();

  const otherDevice = await page();
  await otherDevice.evaluateOnNewDocument(function () {
    var session = {
      user: {
        id: 'other',
        email: 'other@example.com',
        user_metadata: { invite_code: 'ABCD2345' }
      }
    };
    var profile = {
      id: 'other', email: 'other@example.com', membership: 'free_client',
      access_approved: true, profileReady: true, display_name: 'Ada'
    };
    var current;
    function patch(api) {
      if (!api || api.__signupStub) return api;
      api.__signupStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () { return Promise.resolve(session); };
      api.profile = function () { return Promise.resolve(profile); };
      api.myConnection = function () { return Promise.resolve({ trainerId: 't', trainerName: 'Coach Kim' }); };
      api.roster = function () { return Promise.resolve({ role: null, clients: [], invites: [] }); };
      api.redeemInvite = function (code) {
        window.__redeemCode = code;
        return Promise.resolve({ membership: 'free_client', message: 'You are connected as a Free Client.' });
      };
      api.forgetInviteCode = function () {
        session.user.user_metadata.invite_code = '';
        window.__forgot = true;
        return Promise.resolve(true);
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });
  await otherDevice.goto(URL + '#/', { waitUntil: 'networkidle0' });
  await otherDevice.waitForFunction(function () {
    return window.__redeemCode === 'ABCD2345' && window.__forgot === true && document.body.innerText.indexOf('You are connected as a Free Client') !== -1;
  });
  assert.strictEqual(await otherDevice.evaluate(function () { return sessionStorage.getItem('wb.invite'); }), null);
  await otherDevice.close();

  const waiting = await page();
  await waiting.evaluateOnNewDocument(function () {
    window.__session = null;
    window.__profile = {
      id: 'late', email: 'late@example.com', membership: 'none',
      access_approved: false, profileReady: true, display_name: ''
    };
    var current;
    function patch(api) {
      if (!api || api.__signupStub) return api;
      api.__signupStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () { return Promise.resolve(window.__session); };
      api.profile = function () { return Promise.resolve(window.__profile); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.roster = function () { return Promise.resolve({ role: null, clients: [], invites: [] }); };
      api.signUp = function (email, password, captcha, code) {
        window.__signupCode = code;
        window.__session = { user: { id: 'late', email: email, user_metadata: { invite_code: code } } };
        return Promise.resolve({ session: window.__session, needsConfirmation: false });
      };
      api.redeemInvite = function (code) {
        window.__redeemed = (window.__redeemed || 0) + 1;
        window.__profile = Object.assign({}, window.__profile, { membership: 'free_client', access_approved: false });
        return Promise.resolve({ membership: 'free_client', message: 'You are connected as a Free Client.' });
      };
      api.forgetInviteCode = function () {
        if (window.__session && window.__session.user && window.__session.user.user_metadata) {
          window.__session.user.user_metadata.invite_code = '';
        }
        return Promise.resolve(true);
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });
  await waiting.goto(URL + '#/join', { waitUntil: 'networkidle0' });
  await waiting.waitForSelector('#confirm-pass');
  await waiting.type('#acct-email', 'late@example.com');
  await waiting.type('#acct-pass', 'secret1234');
  await waiting.type('#confirm-pass', 'secret1234');
  await waiting.type('#invite-code', 'ABCD-2345');
  await waiting.click('[data-auth=up]');
  await waiting.waitForSelector('#access-wait');
  assert.strictEqual(await waiting.evaluate(function () { return window.__signupCode; }), 'ABCD2345');
  assert.strictEqual(await waiting.evaluate(function () { return window.__redeemed; }), 1);
  assert.strictEqual(await waiting.evaluate(function () { return sessionStorage.getItem('wb.invite'); }), null);
  assert.strictEqual(await waiting.evaluate(function () { return document.getElementById('title').textContent; }), 'Waiting for access');
  await waiting.evaluate(function () {
    window.__profile.access_approved = true;
    location.hash = '#/?approved=1';
  });
  await waiting.waitForFunction(function () {
    return location.hash === '#/account'
      && document.getElementById('title').textContent === 'Account'
      && document.getElementById('invite-code')
      && document.getElementById('account-name-note')
      && !document.getElementById('profile-sheet')
      && !document.querySelector('[data-invite=end-self]');
  });
  await waiting.evaluate(function () { location.hash = '#/subscriptions'; });
  await waiting.waitForFunction(function () {
    return location.hash === '#/account'
      && document.getElementById('invite-code')
      && document.body.innerText.indexOf('You are connected') === -1
      && document.body.innerText.indexOf('End connection') === -1;
  });
  await waiting.evaluate(function () { document.getElementById('invite-code').scrollIntoView({ block: 'center' }); });
  await waiting.screenshot({ path: ART + '/account_unlinked_invite.png' });
  await waiting.evaluate(function () { location.hash = '#/messages'; });
  await waiting.waitForFunction(function () { return location.hash === '#/account' && document.getElementById('invite-code'); });
  await waiting.close();

  const flaky = await page();
  await flaky.evaluateOnNewDocument(function () {
    try { sessionStorage.setItem('wb.invite', 'ABCD2345'); } catch (e) {}
    var session = { user: { id: 'flaky', email: 'flaky@example.com', user_metadata: { invite_code: 'ABCD2345' } } };
    var profile = { id: 'flaky', email: 'flaky@example.com', membership: 'free_client', access_approved: true, profileReady: true, display_name: 'Ada' };
    var current;
    function patch(api) {
      if (!api || api.__signupStub) return api;
      api.__signupStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () { return Promise.resolve(session); };
      api.profile = function () { return Promise.resolve(profile); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.roster = function () { return Promise.resolve({ role: null, clients: [], invites: [] }); };
      api.redeemInvite = function () {
        window.__tries = (window.__tries || 0) + 1;
        if (window.__tries === 1) return Promise.reject(new Error('Failed to fetch'));
        return Promise.resolve({ membership: 'free_client', message: 'You are connected as a Free Client.' });
      };
      api.forgetInviteCode = function () {
        window.__forgot = (window.__forgot || 0) + 1;
        session.user.user_metadata.invite_code = '';
        return Promise.resolve(true);
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });
  await flaky.goto(URL + '#/', { waitUntil: 'networkidle0' });
  await flaky.waitForFunction(function () {
    return window.__tries === 1 && window.__forgot == null && sessionStorage.getItem('wb.invite') === 'ABCD2345' && document.body.innerText.indexOf('Failed to fetch') !== -1;
  });
  await flaky.evaluate(function () { location.hash = '#/?retry=1'; });
  await flaky.waitForFunction(function () {
    return window.__tries === 2 && window.__forgot === 1 && sessionStorage.getItem('wb.invite') == null && document.body.innerText.indexOf('You are connected as a Free Client') !== -1;
  });
  await flaky.close();

  const dead = await page();
  await dead.evaluateOnNewDocument(function () {
    try { sessionStorage.setItem('wb.invite', 'ZZZZZZZZ'); } catch (e) {}
    var session = { user: { id: 'dead', email: 'dead@example.com', user_metadata: { invite_code: 'ZZZZZZZZ' } } };
    var profile = { id: 'dead', email: 'dead@example.com', membership: 'free_client', access_approved: true, profileReady: true, display_name: 'Ada' };
    var current;
    function patch(api) {
      if (!api || api.__signupStub) return api;
      api.__signupStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () { return Promise.resolve(session); };
      api.profile = function () { return Promise.resolve(profile); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.roster = function () { return Promise.resolve({ role: null, clients: [], invites: [] }); };
      api.redeemInvite = function () {
        window.__tries = (window.__tries || 0) + 1;
        return Promise.reject(new Error('That invite could not be used.'));
      };
      api.forgetInviteCode = function () {
        window.__forgot = (window.__forgot || 0) + 1;
        session.user.user_metadata.invite_code = '';
        return Promise.resolve(true);
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });
  await dead.goto(URL + '#/', { waitUntil: 'networkidle0' });
  await dead.waitForFunction(function () {
    return window.__tries === 1 && window.__forgot === 1 && sessionStorage.getItem('wb.invite') == null && document.body.innerText.indexOf('That invite could not be used.') !== -1;
  });
  await dead.evaluate(function () { location.hash = '#/?again=1'; });
  await dead.waitForFunction(function () { return location.hash === '#/?again=1' && window.__tries === 1; });
  await dead.close();

  const linked = await page();
  await linked.evaluateOnNewDocument(function () {
    try { sessionStorage.setItem('wb.invite', 'ABCD2345'); } catch (e) {}
    var session = { user: { id: 'linked', email: 'linked@example.com', user_metadata: { invite_code: 'ABCD2345' } } };
    var profile = { id: 'linked', email: 'linked@example.com', membership: 'free_client', access_approved: true, profileReady: true, display_name: 'Ada' };
    var current;
    function patch(api) {
      if (!api || api.__signupStub) return api;
      api.__signupStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () { return Promise.resolve(session); };
      api.profile = function () { return Promise.resolve(profile); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.roster = function () { return Promise.resolve({ role: null, clients: [], invites: [] }); };
      api.redeemInvite = function () {
        window.__tries = (window.__tries || 0) + 1;
        var err = new Error('You are already connected to a trainer. End that connection before using a new invite.');
        err.inviteOutcome = 'invite_connected';
        return Promise.reject(err);
      };
      api.forgetInviteCode = function () {
        window.__forgot = (window.__forgot || 0) + 1;
        session.user.user_metadata.invite_code = '';
        return Promise.resolve(true);
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });
  await linked.goto(URL + '#/', { waitUntil: 'networkidle0' });
  await linked.waitForFunction(function () {
    return window.__tries === 1 && window.__forgot === 1 && sessionStorage.getItem('wb.invite') == null;
  });
  await linked.evaluate(function () { location.hash = '#/?linked-again=1'; });
  await linked.waitForFunction(function () { return location.hash === '#/?linked-again=1' && window.__tries === 1; });
  await linked.close();

  const odd = await page();
  await odd.evaluateOnNewDocument(function () {
    try { sessionStorage.setItem('wb.invite', 'ABCD2345'); } catch (e) {}
    var session = { user: { id: 'odd', email: 'odd@example.com', user_metadata: { invite_code: 'ABCD2345' } } };
    var profile = { id: 'odd', email: 'odd@example.com', membership: 'free_client', access_approved: true, profileReady: true, display_name: 'Ada' };
    var current;
    function patch(api) {
      if (!api || api.__signupStub) return api;
      api.__signupStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () { return Promise.resolve(session); };
      api.profile = function () { return Promise.resolve(profile); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.roster = function () { return Promise.resolve({ role: null, clients: [], invites: [] }); };
      api.redeemInvite = function () {
        window.__tries = (window.__tries || 0) + 1;
        return Promise.reject(new Error('That check expired. Please try again.'));
      };
      api.forgetInviteCode = function () {
        window.__forgot = (window.__forgot || 0) + 1;
        session.user.user_metadata.invite_code = '';
        return Promise.resolve(true);
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });
  await odd.goto(URL + '#/', { waitUntil: 'networkidle0' });
  await odd.waitForFunction(function () {
    return window.__tries === 1 && window.__forgot == null && sessionStorage.getItem('wb.invite') === 'ABCD2345' && document.body.innerText.indexOf('That check expired') !== -1;
  });
  await odd.evaluate(function () { location.hash = '#/?odd-again=1'; });
  await odd.waitForFunction(function () {
    return location.hash === '#/?odd-again=1' && window.__tries === 1 && sessionStorage.getItem('wb.invite') === 'ABCD2345';
  });
  await odd.close();

  const kept = await page();
  await kept.evaluateOnNewDocument(function () {
    window.__profile = { id: 'kept', email: 'kept@example.com', membership: 'none', access_approved: false, profileReady: true, display_name: 'Ada' };
    var session = { user: { id: 'kept', email: 'kept@example.com' } };
    var current;
    function patch(api) {
      if (!api || api.__signupStub) return api;
      api.__signupStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () { return Promise.resolve(session); };
      api.profile = function () {
        if (window.__failProfile) return Promise.reject(new Error('offline'));
        return Promise.resolve(window.__profile);
      };
      api.myConnection = function () { return Promise.resolve(null); };
      api.roster = function () { return Promise.resolve({ role: null, clients: [], invites: [] }); };
      api.redeemInvite = function () {
        window.__redeemed = (window.__redeemed || 0) + 1;
        return Promise.resolve({ membership: 'free_client', message: 'You are connected as a Free Client.' });
      };
      api.forgetInviteCode = function () { return Promise.resolve(false); };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });
  await kept.goto(URL + '#/', { waitUntil: 'networkidle0' });
  await kept.waitForSelector('#access-wait');
  await kept.evaluate(function () {
    window.__failProfile = true;
    sessionStorage.setItem('wb.invite', 'ABCD2345');
    location.hash = '#/?keep-flag=1';
  });
  await kept.waitForFunction(function () {
    return window.__redeemed === 1 && document.getElementById('access-wait') && !document.querySelector('[data-a=new]');
  });
  await kept.evaluate(function () {
    window.__failProfile = false;
    window.__profile.access_approved = true;
    window.__profile.membership = 'free_client';
    sessionStorage.removeItem('wb.invite');
    location.hash = '#/?approved-flag=1';
  });
  await kept.waitForSelector('[data-a=new]');
  await kept.evaluate(function () {
    window.__failProfile = true;
    window.__redeemed = 0;
    sessionStorage.setItem('wb.invite', 'EFGH6789');
    location.hash = '#/?keep-true=1';
  });
  await kept.waitForFunction(function () {
    return window.__redeemed === 1 && document.querySelector('[data-a=new]') && !document.getElementById('access-wait');
  });
  await kept.close();

  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('signup invite ui ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
