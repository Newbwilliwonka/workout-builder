// Subscriptions checkout and the return banners.
// node tests/checkout-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');
const stubAuth = require('./allow.js').stubAuth;

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const OUT = '/opt/cursor/artifacts';
const none = { id: 'payer', email: 'ada@example.com', membership: 'none', intended_plan: null, access_approved: true };
const paying = {
  id: 'payer',
  email: 'ada@example.com',
  membership: 'trainer',
  intended_plan: 'trainer',
  billing_status: 'active',
  access_approved: true,
  display_name: 'Ada'
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  async function open(profile) {
    const p = await b.newPage();
    p.on('pageerror', function (e) { errs.push(String(e)); });
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    p.__hits = [];
    await p.setRequestInterception(true);
    p.on('request', function (req) {
      var url = req.url();
      if (/checkout\.stripe\.com|billing\.stripe\.com|evil\.example/.test(url)) {
        p.__hits.push(url);
        req.abort('aborted');
        return;
      }
      req.continue();
    });
    await stubAuth(p, {
      session: { user: { id: 'payer', email: 'ada@example.com' } },
      profile: profile
    });
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await p.evaluate(function () {
      window.WBAuth.myConnection = function () { return Promise.resolve(null); };
      window.WBAuth.roster = function () { return Promise.resolve({ role: null }); };
      window.WBAuth.clientInfo = function () { return Promise.resolve(null); };
    });
    return p;
  }
  async function show(p, hash) {
    await p.evaluate(function (h) { location.hash = h; }, hash);
  }
  async function waitHit(p, url) {
    var start = Date.now();
    while (Date.now() - start < 8000) {
      if (p.__hits.indexOf(url) !== -1) return;
      await new Promise(function (resolve) { setTimeout(resolve, 40); });
    }
    throw new Error('no navigation to ' + url + ' saw ' + p.__hits.join(' | '));
  }

  const fresh = await open(none);
  await show(fresh, '#/subscriptions');
  await fresh.waitForSelector('[data-plan=enthusiast]');
  const offered = await fresh.evaluate(function () {
    var root = document.getElementById('app');
    var buttons = Array.prototype.map.call(root.querySelectorAll('button[data-plan]'), function (btn) {
      var card = btn.closest('article');
      var cs = getComputedStyle(card);
      var inner = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      var box = btn.getBoundingClientRect();
      return {
        plan: btn.getAttribute('data-plan'),
        text: btn.textContent,
        width: Math.round(box.width),
        inner: Math.round(inner),
        color: getComputedStyle(btn).backgroundColor,
        disabled: btn.disabled
      };
    });
    var free = root.querySelector('article.plan');
    return {
      buttons: buttons,
      foot: root.querySelector('.foot').textContent,
      beta: root.querySelector('.beta-note').textContent,
      was: Array.prototype.map.call(root.querySelectorAll('.was'), function (el) { return el.textContent; }),
      now: Array.prototype.map.call(root.querySelectorAll('.now'), function (el) { return el.textContent; }),
      betaPills: root.querySelectorAll('.pill.amber').length,
      freeName: free.querySelector('h3').textContent,
      freeButton: !!free.querySelector('button'),
      invite: !!document.getElementById('invite-code'),
      redeem: !!document.getElementById('redeem'),
      text: document.body.innerText
    };
  });
  assert.deepStrictEqual(offered.buttons.map(function (btn) { return btn.plan + ':' + btn.text; }), [
    'enthusiast:Subscribe',
    'trainer:Subscribe',
    'master_trainer:Subscribe'
  ]);
  offered.buttons.forEach(function (btn) {
    assert.ok(Math.abs(btn.width - btn.inner) <= 1, btn.plan + ' width ' + btn.width + ' vs ' + btn.inner);
    assert.strictEqual(btn.color, 'rgb(37, 99, 235)');
    assert.strictEqual(btn.disabled, false);
  });
  assert.strictEqual(offered.foot, "You'll finish payment on Stripe Checkout.");
  assert.strictEqual(offered.beta, 'Beta pricing for the first 100 members.');
  assert.deepStrictEqual(offered.was, ['$19.99', '$39.99', '$59.99']);
  assert.deepStrictEqual(offered.now, ['Free', '$9.99', '$19.99', '$29.99']);
  assert.strictEqual(offered.betaPills, 3);
  assert.strictEqual(offered.freeName, 'Free Client');
  assert.strictEqual(offered.freeButton, false);
  assert.strictEqual(offered.invite, false);
  assert.strictEqual(offered.redeem, false);
  await fresh.screenshot({ path: OUT + '/subscriptions-no-plan.png' });
  assert.ok(offered.text.indexOf('Choose Enthusiast') === -1);
  assert.ok(offered.text.indexOf('Choose Trainer') === -1);
  assert.ok(offered.text.indexOf('Choose Master Trainer') === -1);
  assert.ok(!/sold out/i.test(offered.text));
  await fresh.screenshot({ path: OUT + '/subscriptions-subscribe.png' });

  await fresh.evaluate(function () {
    window.__calls = [];
    var gate = {};
    gate.p = new Promise(function (resolve) { gate.resolve = resolve; });
    window.__gate = gate;
    window.WBAuth.startCheckout = function (plan) {
      window.__calls.push(plan);
      return gate.p;
    };
  });
  await fresh.click('[data-plan=trainer]');
  await fresh.waitForFunction(function () {
    var mine = document.querySelector('[data-plan=trainer]');
    var all = document.querySelectorAll('button[data-plan]');
    var disabled = all.length === 3;
    for (var i = 0; i < all.length; i++) if (!all[i].disabled) disabled = false;
    return window.__calls.length === 1 && window.__calls[0] === 'trainer' && mine && mine.textContent === 'Starting checkout…' && disabled;
  });
  await fresh.evaluate(function () { document.querySelector('[data-plan=enthusiast]').click(); });
  assert.deepStrictEqual(await fresh.evaluate(function () { return window.__calls; }), ['trainer']);
  await fresh.screenshot({ path: OUT + '/subscriptions-starting.png' });
  await fresh.evaluate(function () { window.__gate.resolve('https://checkout.stripe.com/c/pay/cs_test_trainer'); });
  await waitHit(fresh, 'https://checkout.stripe.com/c/pay/cs_test_trainer');

  const refused = await open(none);
  await show(refused, '#/subscriptions');
  await refused.waitForSelector('[data-plan=enthusiast]');
  await refused.evaluate(function () {
    window.__wbTestDb = {
      functions: {
        invoke: function (name, opts) {
          window.__invoke = { name: name, body: opts && opts.body };
          return Promise.resolve({
            data: null,
            error: { message: 'Edge Function returned a non-2xx status code' },
            response: {
              clone: function () { return this; },
              json: function () { return Promise.resolve({ error: 'Checkout is starting, try again in a moment.' }); }
            }
          });
        }
      }
    };
  });
  await refused.click('[data-plan=enthusiast]');
  await refused.waitForFunction(function () {
    var note = document.getElementById('plan-note');
    var plan = document.querySelector('[data-plan=enthusiast]');
    return note && note.className.indexOf('errs') !== -1
      && note.textContent === 'Checkout is starting, try again in a moment.'
      && plan && !plan.disabled && plan.textContent === 'Subscribe'
      && !document.getElementById('current-plan');
  });
  assert.deepStrictEqual(await refused.evaluate(function () { return window.__invoke; }), {
    name: 'create-checkout-session',
    body: { plan: 'enthusiast' }
  });

  await refused.evaluate(function () {
    window.__wbTestDb.functions.invoke = function () {
      return Promise.resolve({
        data: null,
        error: {},
        response: {
          clone: function () { return this; },
          json: function () { return Promise.resolve({ error: 'This account keeps its current plan. Checkout is not used.' }); }
        }
      });
    };
  });
  await refused.click('[data-plan=trainer]');
  await refused.waitForFunction(function () {
    return document.getElementById('plan-note').textContent === 'This account keeps its current plan. Checkout is not used.';
  });

  await refused.evaluate(function () {
    window.WBAuth.startCheckout = function () { return Promise.resolve('http://evil.example/checkout'); };
  });
  await refused.click('[data-plan=enthusiast]');
  await refused.waitForFunction(function () {
    return document.getElementById('plan-note').textContent === 'Checkout could not be started.';
  });
  assert.deepStrictEqual(refused.__hits, []);

  const current = await open(paying);
  await show(current, '#/subscriptions');
  await current.waitForSelector('#current-plan');
  const subscribed = await current.evaluate(function () {
    var root = document.getElementById('app');
    var pill = document.getElementById('current-plan');
    var card = pill.closest('article');
    var articles = Array.prototype.map.call(root.querySelectorAll('article.plan'), function (article) {
      return {
        name: article.querySelector('h3').textContent,
        button: article.querySelector('button') ? article.querySelector('button').textContent : '',
        billing: article.querySelector('[data-billing]') ? article.querySelector('[data-billing]').getAttribute('data-billing') : ''
      };
    });
    var title = card.querySelector('h3').getBoundingClientRect();
    var pillBox = pill.getBoundingClientRect();
    return {
      titleWidth: Math.round(title.width),
      titleRight: Math.round(title.right),
      titleBottom: Math.round(title.bottom),
      pillLeft: Math.round(pillBox.left),
      pillTop: Math.round(pillBox.top),
      label: pill.textContent,
      visual: getComputedStyle(pill).textTransform,
      next: pill.nextElementSibling ? pill.nextElementSibling.textContent : '',
      nextClass: pill.nextElementSibling ? pill.nextElementSibling.className : '',
      manage: card.querySelector('button').textContent,
      color: getComputedStyle(card.querySelector('button')).backgroundColor,
      articles: articles,
      subscribe: document.querySelectorAll('[data-plan]').length,
      beta: document.getElementById('app').querySelector('.beta-note').textContent,
      was: document.getElementById('app').querySelectorAll('.was').length,
      invite: !!document.querySelector('#invite-code'),
      foot: document.getElementById('app').querySelector('.foot') ? document.getElementById('app').querySelector('.foot').textContent : ''
    };
  });
  assert.strictEqual(subscribed.label, 'Current plan');
  assert.strictEqual(subscribed.visual, 'uppercase');
  assert.ok(subscribed.titleWidth >= 70, 'plan name stays readable beside the pills');
  assert.ok(subscribed.titleRight <= subscribed.pillLeft + 1 || subscribed.titleBottom <= subscribed.pillTop + 1);
  assert.strictEqual(subscribed.next, 'Beta');
  assert.ok(subscribed.nextClass.indexOf('amber') !== -1);
  assert.strictEqual(subscribed.manage, 'Manage billing');
  assert.strictEqual(subscribed.color, 'rgb(37, 99, 235)');
  assert.deepStrictEqual(subscribed.articles, [
    { name: 'Free Client', button: '', billing: '' },
    { name: 'Enthusiast', button: '', billing: '' },
    { name: 'Trainer', button: 'Manage billing', billing: 'portal' },
    { name: 'Master Trainer', button: '', billing: '' }
  ]);
  assert.strictEqual(subscribed.subscribe, 0);
  assert.strictEqual(subscribed.beta, 'Beta pricing for the first 100 members.');
  assert.strictEqual(subscribed.was, 3);
  assert.strictEqual(subscribed.invite, false);
  assert.strictEqual(subscribed.foot, '');
  await current.screenshot({ path: OUT + '/subscriptions-current.png' });

  await current.evaluate(function () {
    window.__wbTestDb = {
      functions: {
        invoke: function (name, opts) {
          window.__portal = { name: name, body: opts && opts.body };
          return Promise.resolve({ data: { url: 'https://billing.stripe.com/p/session/test_123' }, error: null });
        }
      }
    };
  });
  await current.click('[data-billing=portal]');
  await waitHit(current, 'https://billing.stripe.com/p/session/test_123');
  assert.deepStrictEqual(await current.evaluate(function () { return window.__portal; }), {
    name: 'create-portal-session',
    body: {}
  });

  const pastDue = await open(Object.assign({}, paying, { billing_status: 'past_due', membership: 'master_trainer' }));
  await show(pastDue, '#/subscriptions');
  await pastDue.waitForSelector('#current-plan');
  assert.strictEqual(await pastDue.evaluate(function () {
    return document.getElementById('current-plan').closest('article').querySelector('h3').textContent;
  }), 'Master Trainer');
  assert.strictEqual(await pastDue.$('[data-plan]'), null);

  const canceled = await open(Object.assign({}, paying, { billing_status: 'canceled' }));
  await show(canceled, '#/subscriptions');
  await canceled.waitForSelector('[data-plan=trainer]');
  assert.strictEqual(await canceled.$('#current-plan'), null);
  assert.strictEqual(await canceled.$('[data-billing]'), null);

  const cancel = await open(none);
  await show(cancel, '#/subscriptions?checkout=cancel');
  await cancel.waitForFunction(function () {
    var note = document.getElementById('checkout-note');
    return note && note.textContent === "Checkout was canceled. You can subscribe whenever you're ready."
      && note.className.indexOf('card') !== -1
      && note.className.indexOf('errs') === -1
      && location.hash === '#/subscriptions';
  });
  await cancel.screenshot({ path: OUT + '/subscriptions-cancel.png' });
  await show(cancel, '#/subscriptions?again=1');
  await cancel.waitForSelector('[data-plan=enthusiast]');
  assert.strictEqual(await cancel.$('#checkout-note'), null);

  const success = await open(paying);
  await show(success, '#/account?checkout=success');
  await success.waitForFunction(function () {
    var note = document.getElementById('checkout-note');
    return note && note.textContent === 'Your subscription is now active.'
      && location.hash === '#/account'
      && document.getElementById('account-card');
  });
  await success.screenshot({ path: OUT + '/account-success.png' });

  const early = await open(none);
  await show(early, '#/account?checkout=success');
  await early.waitForFunction(function () {
    var note = document.getElementById('checkout-note');
    return note && note.textContent === 'Your subscription is now active.' && location.hash === '#/account';
  });
  assert.strictEqual(await early.$('#level-lock'), null);
  assert.strictEqual(await early.$('#invite-code'), null);

  const already = await open(none);
  await show(already, '#/subscriptions');
  await already.waitForSelector('[data-plan=enthusiast]');
  await already.evaluate(function () {
    window.WBAuth.profile = function () {
      return Promise.resolve({
        id: 'payer',
        email: 'ada@example.com',
        membership: 'trainer',
        intended_plan: 'trainer',
        billing_status: 'active',
        access_approved: true,
        display_name: 'Ada'
      });
    };
    window.__wbTestDb = {
      functions: {
        invoke: function () {
          return Promise.resolve({
            data: null,
            error: { message: 'Edge Function returned a non-2xx status code' },
            response: {
              clone: function () { return this; },
              json: function () {
                return Promise.resolve({ error: 'You already have a subscription. Use Manage billing to change it.' });
              }
            }
          });
        }
      }
    };
  });
  await already.click('[data-plan=trainer]');
  await already.waitForFunction(function () {
    var note = document.getElementById('plan-note');
    var card = document.getElementById('current-plan') && document.getElementById('current-plan').closest('article');
    var links = document.getElementById('nav-links');
    var back = document.getElementById('back');
    var me = document.getElementById('account-me');
    return note && note.className.indexOf('errs') !== -1
      && note.textContent === 'You already have a subscription. Use Manage billing to change it.'
      && card && card.querySelector('h3').textContent === 'Trainer'
      && card.querySelector('[data-billing=portal]').textContent === 'Manage billing'
      && !document.querySelector('[data-plan]')
      && !document.getElementById('level-lock')
      && !document.getElementById('level-signout')
      && !document.querySelector('.foot')
      && !document.getElementById('invite-code')
      && links && !links.hidden
      && back && !back.hidden
      && me && !me.hidden;
  });
  await already.evaluate(function () { window.scrollTo(0, 0); });
  await already.screenshot({ path: OUT + '/subscriptions-409.png' });

  const late = await open(none);
  await late.evaluate(function () {
    window.__wbCheckoutPollMs = 40;
    window.__wbCheckoutPollLimit = 4;
    var n = 0;
    window.WBAuth.profile = function () {
      n++;
      if (n < 3) return Promise.resolve({ id: 'payer', email: 'ada@example.com', membership: 'none', intended_plan: null, access_approved: true });
      return Promise.resolve({ id: 'payer', email: 'ada@example.com', membership: 'enthusiast', billing_status: 'active', access_approved: true, display_name: 'Ada' });
    };
  });
  await show(late, '#/account?checkout=success');
  await late.waitForSelector('#checkout-note');
  await late.waitForFunction(function () {
    var label = document.querySelector('#account-card .mute');
    return label && label.textContent.indexOf('Enthusiast') !== -1 && location.hash === '#/account';
  }, { timeout: 5000 });

  const giveUp = await open(none);
  await giveUp.evaluate(function () {
    window.__wbCheckoutPollMs = 40;
    window.__wbCheckoutWaitMs = 320;
  });
  await show(giveUp, '#/account?checkout=success');
  await giveUp.waitForSelector('#checkout-note');
  await giveUp.waitForFunction(function () {
    return location.hash === '#/subscriptions' && !document.getElementById('checkout-note') && document.getElementById('level-lock');
  }, { timeout: 5000 });

  const roam = await open(none);
  await roam.evaluate(function () {
    window.__wbCheckoutPollMs = 40;
    window.__wbCheckoutWaitMs = 5000;
    var n = 0;
    window.WBAuth.profile = function () {
      n++;
      window.__polls = n;
      if (n < 8) return Promise.resolve({ id: 'payer', email: 'ada@example.com', membership: 'none', intended_plan: null, access_approved: true });
      return Promise.resolve({ id: 'payer', email: 'ada@example.com', membership: 'trainer', billing_status: 'active', access_approved: true, display_name: 'Ada' });
    };
  });
  await show(roam, '#/account?checkout=success');
  await roam.waitForSelector('#checkout-note');
  assert.ok(await roam.evaluate(function () { return sessionStorage.getItem('wb.checkout.wait'); }));
  await roam.evaluate(function () { location.hash = '#/'; });
  await roam.waitForFunction(function () {
    return (location.hash === '#/' || location.hash === '' || location.hash === '#')
      && window.__polls >= 3
      && sessionStorage.getItem('wb.checkout.wait');
  }, { timeout: 4000 });
  await roam.waitForFunction(function () {
    return !sessionStorage.getItem('wb.checkout.wait')
      && (location.hash === '#/' || location.hash === '' || location.hash === '#');
  }, { timeout: 5000 });
  await new Promise(function (resolve) { setTimeout(resolve, 250); });
  var pollsAfterPlan = await roam.evaluate(function () { return window.__polls; });
  await new Promise(function (resolve) { setTimeout(resolve, 200); });
  assert.strictEqual(await roam.evaluate(function () { return window.__polls; }), pollsAfterPlan);
  assert.ok(pollsAfterPlan >= 8);

  const roamEnd = await open(none);
  await roamEnd.evaluate(function () {
    window.__wbCheckoutPollMs = 40;
    window.__wbCheckoutWaitMs = 280;
  });
  await show(roamEnd, '#/account?checkout=success');
  await roamEnd.waitForSelector('#checkout-note');
  await roamEnd.evaluate(function () { location.hash = '#/'; });
  await roamEnd.waitForFunction(function () {
    return (location.hash === '#/' || location.hash === '' || location.hash === '#') && sessionStorage.getItem('wb.checkout.wait');
  }, { timeout: 2000 });
  await roamEnd.waitForFunction(function () {
    return location.hash === '#/subscriptions' && document.getElementById('level-lock') && !sessionStorage.getItem('wb.checkout.wait');
  }, { timeout: 4000 });

  async function accountOf(profile, conn) {
    var p = await open(profile);
    await p.evaluate(function (connection) {
      window.WBAuth.myConnection = function () { return Promise.resolve(connection); };
      window.WBAuth.roster = function () { return Promise.resolve({ role: null, clients: [] }); };
      window.WBAuth.clientInfo = function () { return Promise.resolve(null); };
    }, conn);
    await show(p, '#/account');
    await p.waitForSelector('#account-card');
    return p;
  }
  const freeAccount = await accountOf(
    { id: 'payer', email: 'ada@example.com', membership: 'free_client', intended_plan: null, access_approved: true, display_name: 'Ada Client' },
    null
  );
  await freeAccount.waitForSelector('#invite-code');
  assert.strictEqual(await freeAccount.$('[data-invite=end-self]'), null);
  assert.ok((await freeAccount.evaluate(function () { return document.body.innerText; })).indexOf('Your trainer') === -1);
  await freeAccount.evaluate(function () { document.getElementById('redeem').scrollIntoView({ block: 'center' }); });
  await freeAccount.screenshot({ path: OUT + '/account-free-unlinked.png' });

  const linkedAccount = await accountOf(
    { id: 'payer', email: 'ada@example.com', membership: 'free_client', intended_plan: null, access_approved: true, display_name: 'Ada Client' },
    { trainerId: 't1', trainerName: 'Coach Kim' }
  );
  await linkedAccount.waitForSelector('[data-invite=end-self]');
  assert.strictEqual(await linkedAccount.$('#invite-code'), null);
  assert.ok((await linkedAccount.evaluate(function () { return document.getElementById('redeem').innerText; })).indexOf('Your trainer') !== -1);
  assert.ok((await linkedAccount.evaluate(function () { return document.getElementById('redeem').innerText; })).indexOf('Coach Kim') !== -1);
  await linkedAccount.evaluate(function () { document.getElementById('redeem').scrollIntoView({ block: 'center' }); });
  await linkedAccount.screenshot({ path: OUT + '/account-client-linked.png' });

  const enthusiastAccount = await accountOf(
    { id: 'payer', email: 'ada@example.com', membership: 'none', intended_plan: 'enthusiast', access_approved: true, display_name: 'Ada Fan' },
    null
  );
  await enthusiastAccount.waitForSelector('#invite-code');
  assert.ok(await enthusiastAccount.$('#share-link'));
  assert.strictEqual(await enthusiastAccount.$('[data-invite=end-self]'), null);

  const linkedFan = await accountOf(
    { id: 'payer', email: 'ada@example.com', membership: 'enthusiast', intended_plan: 'enthusiast', access_approved: true, display_name: 'Ada Fan' },
    { trainerId: 't1', trainerName: 'Coach Kim' }
  );
  await linkedFan.waitForSelector('[data-invite=end-self]');
  assert.strictEqual(await linkedFan.$('#invite-code'), null);
  assert.strictEqual(await linkedFan.$('[data-invite=redeem]'), null);

  const trainerAccount = await accountOf(
    { id: 'payer', email: 'ada@example.com', membership: 'trainer', intended_plan: 'trainer', access_approved: true, display_name: 'Ada Coach' },
    null
  );
  await trainerAccount.waitForFunction(function () { return document.body.innerText.indexOf('Trainer') !== -1; });
  assert.strictEqual(await trainerAccount.$('#redeem'), null);
  assert.strictEqual(await trainerAccount.$('#invite-code'), null);
  await trainerAccount.screenshot({ path: OUT + '/account-trainer.png' });

  const linkedTrainer = await accountOf(
    { id: 'payer', email: 'ada@example.com', membership: 'trainer', intended_plan: 'trainer', access_approved: true, display_name: 'Ada Coach' },
    { trainerId: 'm1', trainerName: 'Master Kim' }
  );
  await linkedTrainer.waitForSelector('[data-invite=end-self]');
  assert.strictEqual(await linkedTrainer.$('#invite-code'), null);
  assert.strictEqual(await linkedTrainer.$('[data-invite=redeem]'), null);

  const wrong = await open(none);
  await show(wrong, '#/subscriptions?checkout=success');
  await wrong.waitForSelector('[data-plan=enthusiast]');
  await new Promise(function (resolve) { setTimeout(resolve, 200); });
  assert.strictEqual(await wrong.$('#checkout-note'), null);
  assert.ok((await wrong.evaluate(function () { return document.body.innerText; })).indexOf('Your subscription is now active.') === -1);

  assert.deepStrictEqual(errs, []);
  console.log('CHECKOUT UI OK');
  await b.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
