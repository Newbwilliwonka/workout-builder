// Trainer invites in the browser, using the in-memory invite book. No live database.
// node tests/invites-ui.test.js [url]
const assert = require('assert');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';

(async () => {
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.evaluateOnNewDocument(() => {
    var current;
    function persist(book) {
      try {
        sessionStorage.setItem('wb.inviteBook', JSON.stringify({
          users: book.state.users, me: book.state.me, signedIn: book.state.signedIn,
          invites: book.state.invites, links: book.state.links,
          now: typeof book.state.now === 'number' ? book.state.now : null
        }));
      } catch (e) {}
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return current; },
      set: function (api) {
        if (!localStorage.getItem('wb.data.v1')) {
          localStorage.setItem('wb.data.v1', JSON.stringify({
            version: 4, sessions: [],
            workouts: [
              { id: 'own', name: 'My workout', items: [], createdAt: 1, updatedAt: 1 },
              { id: 'from', name: 'Trainer day', items: [], sourceTrainerId: 't1', createdAt: 1, updatedAt: 1 }
            ]
          }));
        }
        var saved = null;
        try { saved = JSON.parse(sessionStorage.getItem('wb.inviteBook') || 'null'); } catch (e) {}
        var book = window.WBInvites.createBook(saved || {
          me: 't1', signedIn: true,
          users: {
            t1: { id: 't1', email: 'coach@example.com', membership: 'none', intended_plan: 'trainer' },
            n1: { id: 'n1', email: 'new@example.com', membership: 'none', intended_plan: null },
            e1: { id: 'e1', email: 'fan@example.com', membership: 'none', intended_plan: 'enthusiast' },
            t2: { id: 't2', email: 'other@example.com', membership: 'none', intended_plan: 'master_trainer' }
          }
        });
        if (saved && saved.now != null) book.setNow(saved.now);
        window.__inviteBook = book;
        var mem = book.api();
        ['session', 'profile', 'signIn', 'signUp', 'signOut', 'saveIntended', 'roster', 'createInvite', 'cancelInvite', 'redeemInvite', 'endConnection', 'myConnection'].forEach(function (k) {
          var fn = mem[k];
          api[k] = function () {
            var result = fn.apply(null, arguments);
            return Promise.resolve(result).then(function (v) { persist(book); return v; }, function (err) { persist(book); throw err; });
          };
        });
        var setMe = book.setMe, setNow = book.setNow;
        book.setMe = function () { var r = setMe.apply(book, arguments); persist(book); return r; };
        book.setNow = function () { var r = setNow.apply(book, arguments); persist(book); return r; };
        current = api;
      }
    });
  });

  const wait = ms => new Promise(r => setTimeout(r, ms));
  await p.goto(URL + '#/account');
  await p.waitForSelector('#invites');
  assert.ok((await p.$eval('#invites', e => e.textContent)).includes('0 of 15 clients'));
  await p.click('[data-invite=create]');
  await p.waitForSelector('[data-open-invite]');
  const first = await p.$eval('[data-open-invite]', e => e.getAttribute('data-open-invite'));
  const link = await p.$eval('[data-invite=copy-link]', e => e.getAttribute('data-link'));
  assert.ok(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(first), first);
  assert.ok(link.indexOf('https://coachtrainerapp.com/?invite=' + first + '#/signin') === 0, link);
  assert.ok((await p.$eval('#invites', e => e.textContent)).includes('left'));
  await p.screenshot({ path: '/tmp/invite-trainer-412.png' });
  await p.click('[data-invite=cancel]');
  await p.waitForFunction(() => !document.querySelector('[data-open-invite]'));

  await p.evaluate(async () => {
    for (var i = 0; i < 15; i++) await window.WBAuth.createInvite();
  });
  await p.evaluate(() => { location.hash = '#/account?cap=1'; });
  await p.waitForFunction(() => document.querySelector('[data-invite=create]') && document.querySelector('[data-invite=create]').disabled);
  assert.ok((await p.$eval('#invites', e => e.textContent)).includes('0 of 15 clients'));
  await p.click('[data-invite=cancel]');
  await p.waitForFunction(() => document.querySelector('[data-invite=create]') && !document.querySelector('[data-invite=create]').disabled);

  const code = await p.$eval('[data-open-invite]', e => e.getAttribute('data-open-invite'));
  await p.evaluate(() => window.__inviteBook.setMe('n1', false));
  await p.goto(URL + '/?invite=' + code + '#/signin');
  await p.waitForSelector('#invite-code');
  assert.strictEqual(await p.$eval('#invite-code', e => e.value.replace(/-/g, '')), code);
  await p.type('#acct-email', 'new@example.com');
  await p.type('#acct-pass', 'secret12');
  await p.click('[data-auth=in]');
  await p.waitForFunction(() => location.hash === '#/subscriptions' && document.body.innerText.includes('You are connected as a Free Client'));
  await p.screenshot({ path: '/tmp/invite-redeem-412.png' });
  assert.strictEqual(await p.evaluate(() => window.__inviteBook.state.users.n1.membership), 'free_client');
  await p.evaluate(() => { location.hash = '#/'; });
  await p.waitForFunction(() => location.hash === '#/subscriptions' && !document.querySelector('[data-a=new]'));
  await p.click('[data-invite=end-self]');
  await p.waitForFunction(() => document.body.innerText.includes('Connection ended'));
  await wait(200);
  assert.deepStrictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('wb.data.v1')).workouts.map(w => w.name)), ['My workout']);
  assert.strictEqual(await p.evaluate(() => window.__inviteBook.state.users.n1.membership), 'free_client');
  await p.screenshot({ path: '/tmp/invite-ended-412.png' });

  await p.evaluate(() => window.__inviteBook.setMe('t1', true));
  await p.evaluate(() => { location.hash = '#/account?back=1'; });
  await p.waitForSelector('#invites');
  assert.ok((await p.$eval('#invites', e => e.textContent)).includes('0 of 15 clients'));
  await p.click('[data-invite=create]');
  await p.waitForFunction(() => document.querySelector('[data-open-invite]'));
  const typed = await p.$eval('[data-open-invite]', e => e.getAttribute('data-open-invite'));
  await p.evaluate(() => window.__inviteBook.setMe('e1', true));
  await p.evaluate(() => { location.hash = '#/subscriptions?fan=1'; });
  await p.waitForSelector('#redeem');
  await p.click('#invite-code', { clickCount: 3 });
  await p.type('#invite-code', typed);
  await p.click('[data-invite=redeem]');
  await p.waitForFunction(() => document.body.innerText.includes('Your Enthusiast plan is unchanged'));
  assert.strictEqual(await p.evaluate(() => window.__inviteBook.state.users.e1.intended_plan), 'enthusiast');
  assert.strictEqual(await p.evaluate(() => window.__inviteBook.state.users.e1.membership), 'none');

  await p.evaluate(() => {
    var d = JSON.parse(localStorage.getItem('wb.data.v1'));
    d.workouts.push({ id: 'from', name: 'Trainer day', items: [], sourceTrainerId: 't1', createdAt: 1, updatedAt: 1 });
    localStorage.setItem('wb.data.v1', JSON.stringify(d));
    window.__inviteBook.setMe('t1', true);
  });
  await p.goto(URL + '#/account');
  await p.waitForFunction(() => document.body.innerText.includes('fan@example.com'));
  await p.click('[data-invite=end]');
  await p.waitForFunction(() => document.body.innerText.includes('Connection ended') && !document.body.innerText.includes('fan@example.com'));
  await p.evaluate(() => window.__inviteBook.setMe('e1', true));
  await p.evaluate(() => { location.hash = '#/subscriptions?after=1'; });
  await p.waitForFunction(() => document.body.innerText.includes('Choose how you want to train'));
  await wait(250);
  assert.deepStrictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('wb.data.v1')).workouts.map(w => w.name)), ['My workout']);
  assert.strictEqual(await p.evaluate(() => window.__inviteBook.state.users.e1.intended_plan), 'enthusiast');

  await p.click('#invite-code', { clickCount: 3 });
  await p.type('#invite-code', 'ZZZZZZZZ');
  await p.click('[data-invite=redeem]');
  await p.waitForFunction(() => document.body.innerText.includes('That invite code was not found'));

  await p.evaluate(() => window.__inviteBook.setMe('t1', true));
  await p.evaluate(() => { location.hash = '#/account?exp=1'; });
  await p.waitForSelector('[data-invite=create]:not([disabled])');
  await p.click('[data-invite=create]');
  await p.waitForSelector('[data-open-invite]');
  const expiring = await p.$eval('[data-open-invite]', e => e.getAttribute('data-open-invite'));
  await p.evaluate(() => window.__inviteBook.setNow(Date.now() + 25 * 60 * 60 * 1000));
  await p.evaluate(() => window.__inviteBook.setMe('n1', true));
  await p.evaluate((c) => { sessionStorage.setItem('wb.invite', c); location.hash = '#/subscriptions?exp=2'; }, expiring);
  await p.waitForSelector('#invite-code');
  await p.click('[data-invite=redeem]');
  await p.waitForFunction(() => document.body.innerText.includes('That invite has expired'));

  await p.evaluate(() => { window.__inviteBook.setNow(null); window.__inviteBook.setMe('t1', true); });
  await p.evaluate(() => { location.hash = '#/account?used=1'; });
  await p.waitForSelector('[data-invite=create]:not([disabled])');
  await p.click('[data-invite=create]');
  await p.waitForFunction(() => document.querySelector('[data-open-invite]'));
  const once = await p.$eval('[data-open-invite]', e => e.getAttribute('data-open-invite'));
  await p.evaluate(() => window.__inviteBook.setMe('n1', true));
  await p.evaluate((c) => { var el = document.getElementById('invite-code'); if (el) el.value = c; location.hash = '#/subscriptions?used=2'; }, once);
  await p.waitForSelector('#redeem');
  await p.evaluate((c) => { document.getElementById('invite-code').value = c; }, once);
  await p.click('[data-invite=redeem]');
  await p.waitForFunction(() => document.body.innerText.includes('You are connected as a Free Client'));
  await p.evaluate((c) => { document.getElementById('invite-code').value = c; document.querySelector('[data-invite=redeem]').click(); }, once);
  await p.waitForFunction(() => document.body.innerText.includes('That invite has already been used') || document.body.innerText.includes('already connected'));

  await p.evaluate(() => window.__inviteBook.setMe('t1', true));
  await p.evaluate(() => { location.hash = '#/account?cancel=1'; });
  await p.waitForSelector('[data-invite=cancel]');
  const doomed = await p.$eval('[data-invite=cancel]', e => e.getAttribute('data-code'));
  await p.click('[data-invite=cancel]');
  await p.waitForFunction((c) => !document.querySelector('[data-open-invite="' + c + '"]'), {}, doomed);
  await p.evaluate(() => window.__inviteBook.setMe('e1', true));
  await p.evaluate(async (c) => {
    window.__inviteBook.state.links.forEach(function (l) { if (l.client_id === 'e1') l.ended_at = Date.now(); });
    try { await window.WBAuth.redeemInvite(c); } catch (e) { window.__redeemErr = e.message; }
  }, doomed);
  assert.ok(/canceled/.test(await p.evaluate(() => window.__redeemErr)), await p.evaluate(() => window.__redeemErr));

  assert.deepStrictEqual(errs, []);
  console.log('INVITES UI OK');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
