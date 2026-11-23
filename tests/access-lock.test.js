// Builder and player stay closed unless the signed-in email is allowlisted.
// node tests/access-lock.test.js [url]
const assert = require('assert'); const M = require('../model.js'); const pp = require('puppeteer-core');
const stubAuth = require('./allow.js').stubAuth;
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const mk = o => M.normalizeExercise(M.newExercise(o));
const w = M.newWorkout('Hidden workout');
w.items = [mk({ name: 'Curl', sets: 1, weight: { unit: 'lb', value: 20 }, mode: 'reps', modeConfig: { repsType: 'number', count: 8, restSec: 0 } })];
const data = M.emptyData(); data.workouts.push(w);
const none = { membership: 'none', intended_plan: null };
const chosen = { membership: 'none', intended_plan: 'enthusiast' };

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  async function open(session, profile) {
    const p = await b.newPage();
    p.on('pageerror', e => errs.push(String(e)));
    await p.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
    const opts = {};
    if (session !== undefined) opts.session = session;
    if (profile !== undefined) opts.profile = profile;
    await stubAuth(p, opts);
    await p.evaluateOnNewDocument(() => {
      window.__leak = false;
      var obs = new MutationObserver(function () {
        var t = document.body ? document.body.innerText : '';
        if (document.querySelector('[data-a=new], [data-a=run], [data-a=play], .pl-screen, [data-b=name]') || t.indexOf('Hidden workout') !== -1) window.__leak = true;
      });
      obs.observe(document, { childList: true, subtree: true, characterData: true });
    });
    return p;
  }
  async function seed(p) {
    await p.goto(URL);
    await p.evaluate((k, v) => localStorage.setItem(k, v), M.STORAGE_KEY, JSON.stringify(data));
  }
  async function denied(p, hash, expectHash, shot) {
    await p.goto(URL + hash); await p.reload();
    await p.waitForFunction(h => location.hash === h, {}, expectHash);
    await new Promise(r => setTimeout(r, 250));
    assert.strictEqual(await p.evaluate(() => location.hash), expectHash);
    assert.strictEqual(await p.evaluate(() => window.__leak), false, hash + ' showed the builder');
    assert.ok(!(await p.$('[data-a=new], [data-a=run], [data-a=play], .pl-screen')));
    if (shot) await p.screenshot({ path: shot });
  }

  const signedOut = await open(null);
  await seed(signedOut);
  await denied(signedOut, '#/', '');
  await signedOut.waitForFunction(() => document.body.innerText.includes('Choose how you want to train') && document.getElementById('header-signin').hidden && document.querySelector('#landing a[href="#/signin"]'));
  assert.strictEqual(await signedOut.$eval('#landing h2', e => e.textContent), 'Create team Drills with cones and events.');
  assert.ok((await signedOut.$eval('#landing', el => el.innerText)).includes('Choose how you want to train'));
  assert.strictEqual(await signedOut.$('#redeem, #invite-code, [data-plan]'), null);
  assert.strictEqual(await signedOut.$eval('#nav-links', el => el.hidden), true);
  assert.deepStrictEqual(await signedOut.$eval('#back', e => ({ hidden: e.hidden, display: getComputedStyle(e).display })), { hidden: true, display: 'none' });
  const landingSign = await signedOut.evaluate(() => {
    var link = document.querySelector('#landing .landing-bar a');
    var bar = document.querySelector('#landing .landing-bar');
    var brand = document.querySelector('#landing .landing-brand');
    var style = getComputedStyle(bar);
    return {
      text: link.textContent,
      href: link.getAttribute('href'),
      brand: brand.textContent,
      barDisplay: style.display,
      plans: document.getElementById('landing').innerText,
      headerHidden: document.getElementById('header-signin').hidden,
      appBarHidden: getComputedStyle(document.querySelector('body > header.bar')).display
    };
  });
  assert.strictEqual(landingSign.text, 'Sign up / Sign in');
  assert.strictEqual(landingSign.href, '#/signin');
  assert.strictEqual(landingSign.brand, 'Coach Trainer App');
  assert.notStrictEqual(landingSign.barDisplay, 'none');
  assert.strictEqual(landingSign.headerHidden, true);
  assert.strictEqual(landingSign.appBarHidden, 'none');
  assert.ok(landingSign.plans.includes('$9.99') && landingSign.plans.includes('$19.99') && landingSign.plans.includes('$29.99') && landingSign.plans.includes('Free'));
  await signedOut.screenshot({ path: '/tmp/signed-out-landing-412.png' });
  await signedOut.evaluate(() => { window.__left = 0; window.addEventListener('hashchange', function () { window.__left++; }); document.getElementById('back').click(); });
  await new Promise(r => setTimeout(r, 250));
  assert.strictEqual(await signedOut.evaluate(() => location.hash), '');
  assert.strictEqual(await signedOut.evaluate(() => window.__left), 0, 'header back left the landing');
  assert.strictEqual(await signedOut.evaluate(() => window.__leak), false, 'back button opened the builder');
  await denied(signedOut, '#/w/' + w.id, '');
  await denied(signedOut, '#/w/' + w.id + '/ex/new', '');
  await denied(signedOut, '#/play/' + w.id, '');
  await signedOut.evaluate(() => { window.__left = 0; document.getElementById('back').click(); });
  await new Promise(r => setTimeout(r, 250));
  assert.strictEqual(await signedOut.evaluate(() => location.hash), '');
  assert.strictEqual(await signedOut.evaluate(() => window.__left), 0, 'header back left the landing after a player link');
  await denied(signedOut, '#/programs', '');
  await denied(signedOut, '#/account', '');
  await denied(signedOut, '#/messages', '');
  await denied(signedOut, '#/client/abc', '');
  await denied(signedOut, '#/send', '');
  await denied(signedOut, '#/received', '');
  await denied(signedOut, '#/preview', '');
  await denied(signedOut, '#/subscriptions', '');
  await signedOut.click('#landing .landing-bar a');
  await signedOut.waitForFunction(() => location.hash === '#/signin' && document.querySelector('h2') && document.querySelector('h2').textContent === 'Sign in' && document.getElementById('header-signin').hidden && document.getElementById('acct-email') && !document.getElementById('invite-code') && document.querySelector('[data-auth=forgot]') && document.querySelector('[data-auth=switch]'));
  async function inviteOpensJoin(url) {
    await signedOut.goto(url);
    await signedOut.waitForFunction(() => location.hash === '#/join' && document.querySelector('h2') && document.querySelector('h2').textContent === 'Create your account' && document.getElementById('header-signin').hidden);
    assert.strictEqual(await signedOut.$eval('#invite-code', function (el) { return el.value; }), 'ABCD-2345');
    assert.strictEqual(await signedOut.evaluate(() => sessionStorage.getItem('wb.invite')), 'ABCD2345');
    assert.strictEqual(await signedOut.evaluate(() => new URLSearchParams(location.search).get('invite')), null);
    assert.strictEqual(await signedOut.evaluate(() => new URLSearchParams((location.hash.split('?')[1] || '')).get('invite')), null);
    assert.strictEqual(await signedOut.$('#redeem, [data-plan]'), null);
    assert.strictEqual(await signedOut.$eval('#nav-links', function (el) { return el.hidden; }), true);
  }
  await inviteOpensJoin(URL + '?invite=ABCD2345');
  await inviteOpensJoin(URL + '?invite=ABCD2345#/');
  await inviteOpensJoin(URL + '?invite=ABCD2345#/subscriptions');
  await inviteOpensJoin(URL + '#/messages?invite=ABCD2345');
  await signedOut.goto(URL + '?invite=ABCD2345#/signin');
  await signedOut.waitForFunction(() => location.hash === '#/join' && document.querySelector('#invite-code') && document.querySelector('#invite-code').value === 'ABCD-2345');
  await signedOut.click('[data-auth=switch]');
  await signedOut.waitForFunction(() => location.hash === '#/signin' && !document.getElementById('invite-code') && sessionStorage.getItem('wb.invite') === 'ABCD2345');
  await signedOut.goto(URL + '?code=reset-code');
  await signedOut.waitForFunction(function () {
    var h = document.querySelector('h2');
    return h && h.textContent === 'Set a new password' &&
      document.body.innerText.indexOf('This reset link is invalid or has expired.') !== -1 &&
      !document.querySelector('[data-a=new]');
  });
  assert.strictEqual(await signedOut.evaluate(() => window.__leak), false, 'reset code showed the builder');
  await signedOut.goto(URL + '#/subscriptions');
  await signedOut.waitForFunction(function () {
    return (location.hash === '' || location.hash === '#') && document.body.innerText.indexOf('Choose how you want to train') !== -1 && !document.querySelector('[data-a=new]');
  });
  await signedOut.goto(URL + '#/signin');
  await signedOut.waitForSelector('[data-auth=switch]');
  await signedOut.click('[data-auth=switch]');
  await signedOut.waitForFunction(() => location.hash === '#/join' && document.querySelector('h2') && document.querySelector('h2').textContent === 'Create your account');
  assert.deepStrictEqual(await signedOut.$eval('#back', e => ({ hidden: e.hidden, display: getComputedStyle(e).display })), { hidden: true, display: 'none' });
  await signedOut.evaluate(() => { window.__left = 0; document.getElementById('back').click(); });
  await new Promise(r => setTimeout(r, 250));
  assert.strictEqual(await signedOut.evaluate(() => location.hash), '#/join');
  assert.strictEqual(await signedOut.evaluate(() => window.__left), 0, 'header back left create-account');
  await signedOut.click('[data-auth=switch]');
  await signedOut.waitForFunction(() => location.hash === '#/signin' && document.querySelector('h2') && document.querySelector('h2').textContent === 'Sign in');
  await signedOut.close();

  const stranger = await open({ user: { id: 's', email: 'ada@example.com' } }, none);
  await seed(stranger);
  await denied(stranger, '#/', '#/subscriptions');
  await stranger.waitForFunction(() => document.body.innerText.includes('Choose how you want to train'));
  assert.strictEqual(await stranger.$eval('#header-signin', el => el.hidden), true);
  assert.ok(await stranger.$('#redeem'));
  assert.ok(await stranger.$('#level-lock'));
  assert.strictEqual(await stranger.$eval('#nav-links', function (el) { return el.hidden; }), true);
  await denied(stranger, '#/w/' + w.id, '#/subscriptions');
  await denied(stranger, '#/play/' + w.id, '#/subscriptions');
  assert.strictEqual(await stranger.$eval('#back', function (el) { return el.hidden; }), true);
  await stranger.evaluate(() => document.getElementById('back').click());
  await stranger.waitForFunction(() => location.hash === '#/subscriptions' && document.body.innerText.includes('Choose how you want to train'));
  await new Promise(r => setTimeout(r, 250));
  assert.strictEqual(await stranger.evaluate(() => window.__leak), false, 'back button opened the builder for a stranger');
  await stranger.close();

  const chosenStranger = await open({ user: { id: 's', email: 'Ada@Example.com' } }, chosen);
  await seed(chosenStranger);
  await chosenStranger.goto(URL + '#/'); await chosenStranger.reload();
  await chosenStranger.waitForSelector('[data-a=new]');
  assert.strictEqual(await chosenStranger.evaluate(() => location.hash), '#/');
  await chosenStranger.close();

  const trainerLevel = { membership: 'trainer', intended_plan: 'trainer' };
  const allowed = await open({ user: { id: 'a', email: '  Hempled@gmail.com ' } }, trainerLevel);
  await seed(allowed);
  await allowed.goto(URL + '#/'); await allowed.reload();
  await allowed.waitForSelector('[data-a=run]');
  assert.strictEqual(await allowed.$eval('.name', e => e.textContent), 'Hidden workout');
  assert.deepStrictEqual(await allowed.$eval('#programs-open', function (el) {
    return {
      text: el.textContent,
      href: el.getAttribute('href'),
      row: el.parentElement && el.parentElement.id
    };
  }), {
    text: 'Programs',
    href: '#/programs',
    row: 'nav-links'
  });
  assert.ok(await allowed.$('#circuits-open'));
  assert.ok(await allowed.$('#send-nav'));
  assert.ok(await allowed.$('#account-me'));
  await allowed.screenshot({ path: '/tmp/allowlisted-workouts-412.png' });
  await allowed.click('[data-a=run]');
  await allowed.waitForSelector('.pl-screen');
  assert.strictEqual(await allowed.$eval('.pl-info .pl-name', e => e.textContent), 'Curl');
  assert.ok(/#\/play\//.test(await allowed.evaluate(() => location.hash)));
  await allowed.close();

  const other = await open({ user: { id: 'k', email: 'KINISIATHLETICS@gmail.com' } }, chosen);
  await seed(other);
  await other.goto(URL + '#/w/' + w.id + '/ex/' + w.items[0].id); await other.reload();
  await other.waitForSelector('[data-b=name]');
  assert.strictEqual(await other.$eval('[data-b=name]', e => e.value), 'Curl');
  await other.goto(URL + '#/subscriptions'); await other.reload();
  await other.waitForFunction(() => location.hash === '#/subscriptions' && document.body.innerText.includes('Choose how you want to train'));
  await new Promise(r => setTimeout(r, 300));
  assert.strictEqual(await other.evaluate(() => location.hash), '#/subscriptions');
  assert.strictEqual(await other.$eval('#header-signin', el => el.hidden), true);
  assert.ok(await other.$('#messages-nav'));
  assert.ok(await other.$('#workouts-nav'));
  assert.ok(await other.$('#redeem'));
  await other.click('#back');
  await other.waitForSelector('[data-a=run]');
  assert.strictEqual(await other.evaluate(() => location.hash), '#/');
  await other.goto(URL + '?invite=ABCD2345#/');
  await other.waitForSelector('[data-a=new]');
  assert.strictEqual(await other.evaluate(() => location.hash), '#/');
  await other.close();

  const fresh = await b.newPage();
  fresh.on('pageerror', e => errs.push(String(e)));
  await fresh.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await stubAuth(fresh, {
    session: { user: { id: 'new', email: 'new@example.com' } },
    profile: { id: 'new', email: 'new@example.com', membership: 'none', intended_plan: null }
  });
  await fresh.goto(URL + '#/join');
  await fresh.waitForSelector('#acct-email');
  await fresh.evaluate(() => {
    window.WBAuth.signUp = function () { return Promise.resolve({ session: { user: { id: 'new', email: 'new@example.com' } }, needsConfirmation: false }); };
  });
  await fresh.type('#acct-email', 'new@example.com');
  await fresh.type('#acct-pass', 'secret1234');
  await fresh.type('#confirm-pass', 'secret1234');
  await fresh.click('[data-auth=up]');
  await fresh.waitForFunction(() => location.hash === '#/subscriptions' && document.getElementById('level-lock') && document.getElementById('back').hidden);
  await fresh.evaluate(() => { location.hash = '#/programs'; });
  await fresh.waitForFunction(() => location.hash === '#/subscriptions' && document.getElementById('level-lock') && !document.getElementById('pv-gcal'));
  await fresh.screenshot({ path: '/tmp/signup-subscriptions-390.png' });

  const invited = await b.newPage();
  invited.on('pageerror', e => errs.push(String(e)));
  await invited.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await stubAuth(invited, {
    session: { user: { id: 'new2', email: 'invited@example.com' } },
    profile: { id: 'new2', email: 'invited@example.com', membership: 'none', intended_plan: null }
  });
  await invited.goto(URL + '#/join');
  await invited.waitForSelector('#invite-code');
  await invited.evaluate(() => {
    window.__redeemed = 0;
    window.WBAuth.signUp = function (email, password, captcha, code) {
      window.__signupCode = code;
      return Promise.resolve({ session: { user: { id: 'new2', email: 'invited@example.com' } }, needsConfirmation: false });
    };
    window.WBAuth.redeemInvite = function () {
      window.__redeemed++;
      window.WBAuth.profile = function () { return Promise.resolve({ id: 'new2', email: 'invited@example.com', membership: 'free_client', intended_plan: null }); };
      return Promise.resolve({ membership: 'free_client', message: 'You are connected as a Free Client.', trainerId: 't' });
    };
  });
  await invited.type('#acct-email', 'invited@example.com');
  await invited.type('#acct-pass', 'secret1234');
  await invited.type('#confirm-pass', 'secret1234');
  await invited.type('#invite-code', 'ABCD2345');
  await invited.click('[data-auth=up]');
  await invited.waitForSelector('[data-a=new]');
  assert.strictEqual(await invited.evaluate(() => window.__redeemed), 1);
  assert.strictEqual(await invited.evaluate(() => window.__signupCode), 'ABCD2345');
  assert.strictEqual(await invited.evaluate(() => location.hash), '#/');
  assert.strictEqual(await invited.$('#level-lock'), null);

  const client = await b.newPage();
  client.on('pageerror', e => errs.push(String(e)));
  client.on('dialog', d => d.dismiss());
  await client.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await stubAuth(client, {
    session: { user: { id: 'c', email: 'ada@example.com' } },
    profile: { id: 'c', email: 'ada@example.com', membership: 'free_client', intended_plan: null }
  });
  await client.goto(URL + '#/');
  await client.waitForSelector('[data-a=new]');
  await client.click('[data-a=new]');
  await client.waitForSelector('#level-note');
  const noteText = await client.$eval('#level-note', el => el.innerText);
  assert.ok(noteText.indexOf('Free Client') !== -1);
  assert.ok(noteText.indexOf('Get personalized workouts and programs from your trainer') !== -1);
  assert.ok(noteText.indexOf('Run your sessions from your program calendar, solo or with your trainer') !== -1);
  assert.ok(noteText.indexOf('Message your trainer') !== -1);
  assert.strictEqual(noteText.indexOf('Message your trainer anytime'), -1);
  assert.ok(noteText.indexOf('Keep all your data if you switch trainers') !== -1);
  assert.strictEqual(await client.$eval('#level-upgrade', el => el.textContent), 'Upgrade');
  await client.screenshot({ path: '/tmp/level-upgrade-note-390.png' });
  await client.click('#level-dismiss');
  await client.waitForFunction(() => !document.getElementById('level-note') && document.querySelector('[data-a=new]'));
  await client.click('[data-a=new]');
  await client.waitForSelector('#level-note');
  await client.click('#level-upgrade');
  await client.waitForFunction(() => location.hash === '#/subscriptions' && document.body.innerText.indexOf('Choose how you want to train') !== -1);

  const cold = await open({ user: { id: 'cold', email: 'cold@example.com' } }, { id: 'cold', email: 'cold@example.com', membership: 'none', intended_plan: null });
  await cold.goto(URL + '#/join');
  await cold.waitForSelector('#acct-email');
  await cold.evaluate(() => {
    window.WBAuth.signUp = function () { return Promise.resolve({ session: { user: { id: 'cold', email: 'cold@example.com' } }, needsConfirmation: false }); };
    window.WBAuth.profile = function () { return Promise.reject(new Error('membership storage is not ready')); };
  });
  await cold.type('#acct-email', 'cold@example.com');
  await cold.type('#acct-pass', 'secret1234');
  await cold.type('#confirm-pass', 'secret1234');
  await cold.click('[data-auth=up]');
  await cold.waitForFunction(() => location.hash === '#/subscriptions' && document.getElementById('level-lock') && document.getElementById('level-signout') && document.getElementById('back').hidden && document.getElementById('nav-links').hidden && !document.querySelector('[data-a=new]'));

  const retry = await open({ user: { id: 'retry', email: 'retry@example.com' } }, none);
  await retry.goto(URL + '#/signin');
  await retry.waitForSelector('h2');
  await retry.evaluate(() => {
    var n = 0;
    window.WBAuth.profile = function () {
      n += 1;
      window.__profileReads = n;
      if (n < 2) return Promise.reject(new Error('offline'));
      return Promise.resolve({ id: 'retry', email: 'retry@example.com', membership: 'enthusiast', intended_plan: 'enthusiast' });
    };
    location.hash = '#/';
  });
  await retry.waitForSelector('[data-a=new]');
  assert.strictEqual(await retry.evaluate(() => location.hash), '#/');
  assert.ok(await retry.evaluate(() => window.__profileReads >= 2));

  const held = await open({ user: { id: 'held', email: 'held@example.com' } }, { id: 'held', email: 'held@example.com', membership: 'trainer', intended_plan: 'trainer' });
  await held.goto(URL + '#/');
  await held.reload();
  await held.waitForSelector('[data-a=new]');
  await held.evaluate(() => {
    window.WBAuth.profile = function () { return Promise.reject(new Error('offline')); };
    location.hash = '#/?held=1';
  });
  await held.waitForFunction(() => location.hash === '#/?held=1' && document.querySelector('[data-a=new]') && !document.getElementById('level-lock'));

  const invitedOffline = await open({ user: { id: 'inv', email: 'inv@example.com' } }, { id: 'inv', email: 'inv@example.com', membership: 'none', intended_plan: null });
  await invitedOffline.goto(URL + '#/join');
  await invitedOffline.waitForSelector('#invite-code');
  await invitedOffline.evaluate(() => {
    window.WBAuth.signUp = function () { return Promise.resolve({ session: { user: { id: 'inv', email: 'inv@example.com' } }, needsConfirmation: false }); };
    window.WBAuth.profile = function () { return Promise.reject(new Error('membership storage is not ready')); };
    window.WBAuth.redeemInvite = function () {
      return Promise.resolve({ membership: 'free_client', message: 'You are connected as a Free Client.', trainerId: 't' });
    };
  });
  await invitedOffline.type('#acct-email', 'inv@example.com');
  await invitedOffline.type('#acct-pass', 'secret1234');
  await invitedOffline.type('#confirm-pass', 'secret1234');
  await invitedOffline.type('#invite-code', 'ABCD2345');
  await invitedOffline.click('[data-auth=up]');
  await invitedOffline.waitForSelector('#access-wait');
  assert.strictEqual(await invitedOffline.evaluate(() => location.hash), '#/');
  assert.strictEqual(await invitedOffline.$('#level-lock, [data-a=new]'), null);

  const saveFail = await open({ user: { id: 'save', email: 'save@example.com' } }, { id: 'save', email: 'save@example.com', membership: 'none', intended_plan: null });
  await saveFail.goto(URL + '#/subscriptions');
  await saveFail.reload();
  await saveFail.waitForSelector('#level-lock');
  await saveFail.evaluate(() => {
    window.WBAuth.saveIntended = function () { return Promise.reject(new Error('duplicate key')); };
  });
  await saveFail.click('[data-plan=enthusiast]');
  await saveFail.waitForFunction(() => {
    var plan = document.querySelector('[data-plan=enthusiast]');
    return location.hash === '#/subscriptions'
      && document.getElementById('level-lock')
      && document.getElementById('level-signout')
      && document.getElementById('back').hidden
      && document.getElementById('nav-links').hidden
      && document.body.innerText.indexOf('Could not save that plan. Please try again.') !== -1
      && plan && !plan.disabled;
  });

  const consumed = await open(null);
  await consumed.goto(URL + '?invite=ABCD2345#/signin');
  await consumed.waitForFunction(() => location.hash === '#/join' && document.getElementById('invite-code') && document.getElementById('invite-code').value === 'ABCD-2345');
  await consumed.click('[data-auth=switch]');
  await consumed.waitForFunction(() => location.hash === '#/signin' && !document.getElementById('invite-code') && sessionStorage.getItem('wb.invite') === 'ABCD2345');
  await consumed.evaluate(() => {
    window.__redeemed = 0;
    var session = { user: { id: 'used', email: 'used@example.com' } };
    var profile = { id: 'used', email: 'used@example.com', membership: 'free_client', intended_plan: null };
    window.WBAuth.signIn = function () { return Promise.resolve({ session: session }); };
    window.WBAuth.session = function () { return Promise.resolve(session); };
    window.WBAuth.profile = function () { return Promise.resolve(profile); };
    window.WBAuth.myConnection = function () { return Promise.resolve(null); };
    window.WBAuth.redeemInvite = function () {
      window.__redeemed++;
      return Promise.resolve({ membership: 'free_client', message: 'You are connected as a Free Client.', trainerId: 't' });
    };
  });
  await consumed.type('#acct-email', 'used@example.com');
  await consumed.type('#acct-pass', 'secret1234');
  await consumed.click('[data-auth=in]');
  await consumed.waitForFunction(() => window.__redeemed === 1 && location.hash === '#/');
  assert.strictEqual(await consumed.evaluate(() => sessionStorage.getItem('wb.invite')), null);
  await consumed.evaluate(() => { location.hash = '#/subscriptions'; });
  await consumed.waitForSelector('#redeem #invite-code');
  assert.strictEqual(await consumed.$eval('#invite-code', function (el) { return el.value; }), '');
  await consumed.evaluate(() => { location.hash = '#/subscriptions?again=1'; });
  await consumed.waitForFunction(() => location.hash === '#/subscriptions?again=1' && document.getElementById('invite-code'));
  assert.strictEqual(await consumed.$eval('#invite-code', function (el) { return el.value; }), '');
  assert.strictEqual(await consumed.evaluate(() => sessionStorage.getItem('wb.invite')), null);
  await consumed.evaluate(() => {
    var session = { user: { id: 'used', email: 'used@example.com' } };
    window.WBAuth.session = function () { return Promise.resolve(null); };
    window.WBAuth.signIn = function () {
      window.WBAuth.session = function () { return Promise.resolve(session); };
      return Promise.resolve({ session: session });
    };
    location.hash = '#/signin';
  });
  await consumed.waitForFunction(() => location.hash === '#/signin' && !document.getElementById('invite-code') && sessionStorage.getItem('wb.invite') == null);
  await consumed.type('#acct-email', 'used@example.com');
  await consumed.type('#acct-pass', 'secret1234');
  await consumed.click('[data-auth=in]');
  await consumed.waitForFunction(() => location.hash === '#/' && window.__redeemed === 1);

  const card = await open(
    { user: { id: 'card', email: 'card@example.com' } },
    { id: 'card', email: 'card@example.com', membership: 'none', intended_plan: null }
  );
  await card.goto(URL + '?invite=ABCD2345#/subscriptions');
  await card.waitForSelector('#redeem #invite-code');
  assert.strictEqual(await card.$eval('#invite-code', function (el) { return el.value; }), 'ABCD-2345');
  assert.strictEqual(await card.evaluate(() => new URLSearchParams(location.search).get('invite')), null);
  await card.evaluate(() => {
    window.__cardRedeemed = 0;
    window.WBAuth.myConnection = function () { return Promise.resolve(null); };
    window.WBAuth.redeemInvite = function () {
      window.__cardRedeemed++;
      return Promise.resolve({ message: 'Invite applied.' });
    };
  });
  await card.click('[data-invite=redeem]');
  await card.waitForFunction(() => window.__cardRedeemed === 1 && document.getElementById('invite-code') && document.getElementById('invite-code').value === '');
  await card.evaluate(() => { location.hash = '#/subscriptions?again=1'; });
  await card.waitForFunction(() => location.hash === '#/subscriptions?again=1' && document.getElementById('invite-code') && document.getElementById('invite-code').value === '');
  assert.strictEqual(await card.evaluate(() => sessionStorage.getItem('wb.invite')), null);
  assert.strictEqual(await card.evaluate(() => window.__cardRedeemed), 1);

  assert.deepStrictEqual(errs, []);
  console.log('ACCESS LOCK OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
