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
  await denied(signedOut, '#/', '#/signin');
  assert.strictEqual(await signedOut.$eval('h2', e => e.textContent), 'Sign in');
  assert.deepStrictEqual(await signedOut.$eval('#back', e => ({ hidden: e.hidden, display: getComputedStyle(e).display })), { hidden: true, display: 'none' });
  await signedOut.screenshot({ path: '/tmp/signed-out-signin-412.png' });
  await signedOut.evaluate(() => { window.__left = 0; window.addEventListener('hashchange', function () { window.__left++; }); document.getElementById('back').click(); });
  await new Promise(r => setTimeout(r, 250));
  assert.strictEqual(await signedOut.evaluate(() => location.hash), '#/signin');
  assert.strictEqual(await signedOut.evaluate(() => window.__left), 0, 'header back left sign-in');
  assert.strictEqual(await signedOut.$eval('h2', e => e.textContent), 'Sign in');
  assert.strictEqual(await signedOut.evaluate(() => window.__leak), false, 'back button opened the builder');
  await denied(signedOut, '#/w/' + w.id, '#/signin');
  await denied(signedOut, '#/w/' + w.id + '/ex/new', '#/signin');
  await denied(signedOut, '#/play/' + w.id, '#/signin');
  await signedOut.evaluate(() => { window.__left = 0; document.getElementById('back').click(); });
  await new Promise(r => setTimeout(r, 250));
  assert.strictEqual(await signedOut.evaluate(() => location.hash), '#/signin');
  assert.strictEqual(await signedOut.evaluate(() => window.__left), 0, 'header back left sign-in after a player link');
  await denied(signedOut, '#/programs', '#/signin');
  await denied(signedOut, '#/account', '#/signin');
  await denied(signedOut, '#/messages', '#/signin');
  await denied(signedOut, '#/client/abc', '#/signin');
  await denied(signedOut, '#/send', '#/signin');
  await denied(signedOut, '#/received', '#/signin');
  await denied(signedOut, '#/preview', '#/signin');
  await signedOut.goto(URL + '?invite=ABCD2345#/signin');
  await signedOut.waitForSelector('#invite-code');
  assert.strictEqual(await signedOut.$eval('#invite-code', function (el) { return el.value; }), 'ABCD-2345');
  await signedOut.goto(URL + '?code=reset-code');
  await signedOut.waitForFunction(function () {
    return location.hash === '#/signin' && document.querySelector('h2') && document.querySelector('h2').textContent === 'Sign in';
  });
  await signedOut.goto(URL + '#/subscriptions');
  await signedOut.waitForFunction(function () {
    return location.hash === '#/subscriptions' && document.body.innerText.indexOf('Choose how you want to train') !== -1 && !document.querySelector('[data-a=new]');
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
  await other.click('#back');
  await other.waitForSelector('[data-a=run]');
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
  await fresh.type('#acct-pass', 'secret12');
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
    window.WBAuth.signUp = function () { return Promise.resolve({ session: { user: { id: 'new2', email: 'invited@example.com' } }, needsConfirmation: false }); };
    window.WBAuth.redeemInvite = function () {
      window.__redeemed++;
      window.WBAuth.profile = function () { return Promise.resolve({ id: 'new2', email: 'invited@example.com', membership: 'free_client', intended_plan: null }); };
      return Promise.resolve({ membership: 'free_client', message: 'You are connected as a Free Client.', trainerId: 't' });
    };
  });
  await invited.type('#acct-email', 'invited@example.com');
  await invited.type('#acct-pass', 'secret12');
  await invited.type('#invite-code', 'ABCD2345');
  await invited.click('[data-auth=up]');
  await invited.waitForSelector('[data-a=new]');
  assert.strictEqual(await invited.evaluate(() => window.__redeemed), 1);
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
  assert.ok(noteText.indexOf('Run the workouts your trainer sends you') !== -1);
  assert.strictEqual(await client.$eval('#level-upgrade', el => el.textContent), 'Upgrade');
  await client.screenshot({ path: '/tmp/level-upgrade-note-390.png' });
  await client.click('#level-dismiss');
  await client.waitForFunction(() => !document.getElementById('level-note') && document.querySelector('[data-a=new]'));
  await client.click('[data-a=new]');
  await client.waitForSelector('#level-note');
  await client.click('#level-upgrade');
  await client.waitForFunction(() => location.hash === '#/subscriptions' && document.body.innerText.indexOf('Choose how you want to train') !== -1);

  assert.deepStrictEqual(errs, []);
  console.log('ACCESS LOCK OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
