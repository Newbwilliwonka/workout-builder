// Two signed-in roles, plus failed, slow, and disconnected sends.
// The live Supabase project is not used. node tests/messages-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';
const T = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';

function install(page, who) {
  return page.evaluateOnNewDocument(function (who) {
    var T = '11111111-1111-4111-8111-111111111111';
    var C = '22222222-2222-4222-8222-222222222222';
    var E = '33333333-3333-4333-8333-333333333333';
    var KEY = 'wb.msgbox';
    window.__wbMessagePollMs = 250;
    window.__sentIds = [];
    function seed() {
      var now = Date.now();
      return {
        people: {
          [T]: { email: 'kinisiathletics@gmail.com', plan: 'Trainer' },
          [C]: { email: 'ada@example.com', plan: 'Free Client' },
          [E]: { email: 'fan@example.com', plan: 'Enthusiast' }
        },
        links: [
          { trainerId: T, clientId: C, endedAt: null },
          { trainerId: T, clientId: E, endedAt: null }
        ],
        messages: [
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', trainerId: T, clientId: E, senderId: E, body: 'Can we move Thursday to Friday morning?', at: new Date(now - 2 * 60000).toISOString(), readAt: null },
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', trainerId: T, clientId: C, senderId: T, body: 'Friday full body is ready when you are.', at: new Date(now - 60 * 60000).toISOString(), readAt: new Date(now - 50 * 60000).toISOString() },
          { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', trainerId: T, clientId: C, senderId: C, body: 'Got it, thank you.', at: new Date(now - 55 * 60000).toISOString(), readAt: new Date(now - 50 * 60000).toISOString() }
        ]
      };
    }
    function read() {
      try { return JSON.parse(localStorage.getItem(KEY) || 'null') || seed(); }
      catch (e) { return seed(); }
    }
    function write(box) { localStorage.setItem(KEY, JSON.stringify(box)); }
    if (!localStorage.getItem(KEY)) write(seed());
    function linkOf(box, other) {
      return (box.links || []).filter(function (l) {
        return !l.endedAt && ((l.trainerId === who.id && l.clientId === other) || (l.clientId === who.id && l.trainerId === other));
      })[0] || null;
    }
    function shape(m) {
      return { id: m.id, senderId: m.senderId, mine: m.senderId === who.id, body: m.body, at: m.at, readAt: m.readAt };
    }
    function threads() {
      var box = read();
      var role = who.membership === 'trainer' || who.membership === 'master_trainer' ? 'trainer' : 'client';
      var rows = (box.links || []).filter(function (l) {
        return !l.endedAt && (l.trainerId === who.id || l.clientId === who.id);
      }).map(function (l) {
        var other = l.trainerId === who.id ? l.clientId : l.trainerId;
        var person = box.people[other] || { email: 'Linked', plan: '' };
        var mine = (box.messages || []).filter(function (m) {
          return m.trainerId === l.trainerId && m.clientId === l.clientId;
        }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
        var last = mine[0];
        var unread = mine.filter(function (m) { return m.senderId !== who.id && !m.readAt; }).length;
        return { id: other, name: person.email, plan: person.plan, preview: last ? last.body : null, at: last ? last.at : null, unread: unread };
      }).sort(function (a, b) {
        var at = a.at ? new Date(a.at).getTime() : 0;
        var bt = b.at ? new Date(b.at).getTime() : 0;
        if (bt !== at) return bt - at;
        return String(a.name).localeCompare(String(b.name));
      });
      return { role: role, threads: rows };
    }
    function sendMessage(personId, messageId, body) {
      var fail = window.__msgFail || '';
      window.__msgFail = '';
      window.__sentIds.push(messageId);
      var wait = fail === 'slow' ? 1200 : 0;
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try {
            var box = read();
            var link = linkOf(box, personId);
            if (!link) throw new Error('There is no connection.');
            var text = String(body || '').trim();
            if (!text) throw new Error('Enter a message.');
            var existing = (box.messages || []).filter(function (m) { return m.id === messageId; })[0];
            if (existing) {
              if (existing.senderId !== who.id || existing.trainerId !== link.trainerId || existing.clientId !== link.clientId) {
                throw new Error('Could not send that message.');
              }
              resolve(shape(existing));
              return;
            }
            if (fail === 'offline') throw new Error('Failed to fetch');
            box.messages.push({
              id: messageId, trainerId: link.trainerId, clientId: link.clientId, senderId: who.id,
              body: text, at: new Date().toISOString(), readAt: null
            });
            write(box);
            if (fail === 'lose') throw new Error('Failed to fetch');
            resolve(shape(box.messages[box.messages.length - 1]));
          } catch (err) { reject(err); }
        }, wait);
      });
    }
    var stub = {
      session: function () { return Promise.resolve({ user: { id: who.id, email: who.email } }); },
      profile: function () {
        return Promise.resolve({ id: who.id, email: who.email, membership: who.membership, intended_plan: who.intended || null });
      },
      signOut: function () { return Promise.resolve(); },
      saveIntended: function () { return stub.profile(); },
      myConnection: function () {
        var box = read();
        var link = (box.links || []).filter(function (l) { return !l.endedAt && l.clientId === who.id; })[0];
        if (!link) return Promise.resolve(null);
        var trainer = box.people[link.trainerId] || {};
        return Promise.resolve({ trainerId: link.trainerId, trainerEmail: trainer.email || '' });
      },
      roster: function () {
        if (who.membership !== 'trainer' && who.membership !== 'master_trainer') return Promise.resolve({ role: null });
        var box = read();
        var clients = (box.links || []).filter(function (l) { return !l.endedAt && l.trainerId === who.id; }).map(function (l) {
          var person = box.people[l.clientId] || {};
          return { id: l.clientId, email: person.email || '', plan: person.plan || 'Free Client' };
        });
        return Promise.resolve({ role: 'trainer', cap: 15, clientCount: clients.length, canCreate: true, clients: clients, invites: [] });
      },
      createInvite: function () { return Promise.resolve({ code: 'ABCD2345', expires_at: new Date(Date.now() + 86400000).toISOString() }); },
      cancelInvite: function () { return Promise.resolve({ code: 'ABCD2345' }); },
      redeemInvite: function () { return Promise.resolve({ message: 'You are connected as a Free Client.' }); },
      endConnection: function () { return Promise.resolve({ message: 'Connection ended.' }); },
      threads: function () { return Promise.resolve(threads()); },
      messages: function (personId) {
        var wait = window.__msgOpenDelay || 0;
        window.__msgOpenDelay = 0;
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            try {
              var box = read();
              var link = linkOf(box, personId);
              if (!link) throw new Error('There is no connection.');
              var person = box.people[personId] || { email: 'Linked', plan: '' };
              var msgs = (box.messages || []).filter(function (m) {
                return m.trainerId === link.trainerId && m.clientId === link.clientId;
              }).sort(function (a, b) { return a.at < b.at ? -1 : 1; });
              resolve({
                person: { id: personId, name: person.email, plan: person.plan },
                messages: msgs.map(shape)
              });
            } catch (err) { reject(err); }
          }, wait);
        });
      },
      sendMessage: sendMessage,
      markRead: function (personId) {
        var box = read();
        var link = linkOf(box, personId);
        if (!link) return Promise.reject(new Error('There is no connection.'));
        box.messages.forEach(function (m) {
          if (m.trainerId === link.trainerId && m.clientId === link.clientId && m.senderId !== who.id && !m.readAt) {
            m.readAt = new Date().toISOString();
          }
        });
        write(box);
        return Promise.resolve({ ok: true });
      },
      watchMessages: function (handler) {
        function onStorage(e) {
          if (!e || e.key === KEY) { try { handler(); } catch (err) {} }
        }
        window.addEventListener('storage', onStorage);
        return Promise.resolve(function () { window.removeEventListener('storage', onStorage); });
      }
    };
    var current = stub;
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function () { current = stub; }
    });
  }, who);
}

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  const trainer = await browser.newPage();
  trainer.on('pageerror', function (e) { errs.push(String(e)); });
  await trainer.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await install(trainer, { id: T, email: 'kinisiathletics@gmail.com', membership: 'trainer' });

  await trainer.goto(URL + '#/');
  await trainer.reload();
  await trainer.waitForSelector('[data-a=new]');
  assert.ok(await trainer.$('[data-a=account]'));
  assert.ok(await trainer.$('#messages-nav'));
  assert.ok((await trainer.evaluate(function () { return document.body.innerText; })).includes('No workouts yet'));
  await trainer.click('#messages-nav');
  await trainer.waitForSelector('.count');
  assert.strictEqual(await trainer.$eval('[data-thread="' + E + '"] .count', function (el) { return el.textContent; }), '1');
  assert.strictEqual(await trainer.$('[data-thread="' + C + '"] .count'), null);
  assert.ok((await trainer.evaluate(function () { return document.body.innerText; })).includes('Can we move Thursday'));
  assert.strictEqual(await trainer.$('#sample-role, [data-role]'), null);
  await trainer.screenshot({ path: ART + '/trainer-messages-unread.png' });

  await trainer.click('[data-thread="' + E + '"]');
  await trainer.waitForFunction(function () { return document.body.innerText.indexOf('Can we move Thursday to Friday morning?') !== -1 && document.getElementById('msg-send'); });
  assert.strictEqual(await trainer.$eval('#with', function (el) { return el.textContent; }), 'Enthusiast · linked client');
  await trainer.type('#msg-text', 'Friday at 8 works.');
  await trainer.click('#msg-send');
  await trainer.waitForFunction(function () {
    return document.body.innerText.indexOf('Friday at 8 works.') !== -1 && document.getElementById('msg-text').value === '' && !document.getElementById('msg-send').disabled;
  });
  assert.strictEqual(await trainer.$$eval('.bubble', function (els) { return els.length; }), 2);
  await trainer.evaluate(function () { return window.WBMessages.refresh(); });
  assert.strictEqual(await trainer.$eval('#msg-send', function (el) { return el.disabled; }), false);
  await trainer.screenshot({ path: ART + '/trainer-conversation.png' });

  await trainer.evaluate(function () {
    var el = document.getElementById('msg-text');
    el.focus();
    el.value = 'abcdef';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.setSelectionRange(2, 2);
  });
  await trainer.evaluate(function () { return window.WBMessages.refresh(); });
  assert.deepStrictEqual(await trainer.evaluate(function () {
    var el = document.getElementById('msg-text');
    return { s: el.selectionStart, e: el.selectionEnd, v: el.value, focused: document.activeElement === el };
  }), { s: 2, e: 2, v: 'abcdef', focused: true });
  await trainer.evaluate(function () {
    var el = document.getElementById('msg-text');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await trainer.goto(URL + '#/account');
  await trainer.waitForSelector('#invites');
  assert.ok(await trainer.$('#messages-nav'));
  await trainer.click('#messages-nav');
  await trainer.waitForSelector('#thread-list');

  const client = await browser.newPage();
  client.on('pageerror', function (e) { errs.push('client ' + e); });
  await client.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await install(client, { id: C, email: 'ada@example.com', membership: 'free_client' });
  await client.goto(URL + '#/');
  await client.reload();
  await client.waitForFunction(function () { return location.hash === '#/' && document.querySelector('#messages-nav') && document.querySelector('[data-a=new]'); });
  await client.click('#messages-nav');
  await client.waitForSelector('[data-thread="' + T + '"]');
  assert.strictEqual(await client.$('#sample-role, [data-role]'), null);
  await client.click('[data-thread="' + T + '"]');
  await client.waitForFunction(function (id) {
    return location.hash.indexOf(id) !== -1 && document.getElementById('with') && document.getElementById('msg-send');
  }, {}, T);
  assert.strictEqual(await client.$eval('#with', function (el) { return el.textContent; }), 'Trainer');
  assert.ok(await client.$('.bubble.me'));
  assert.ok(await client.$('.bubble:not(.me)'));
  await client.screenshot({ path: ART + '/client-conversation.png' });
  await client.click('#back');
  await client.waitForSelector('#thread-list');

  await trainer.evaluate(function (id) { location.hash = '#/messages/' + id; }, C);
  await trainer.waitForFunction(function () { return document.getElementById('with') && document.getElementById('with').textContent === 'Free Client · linked client'; });
  await trainer.evaluate(function () {
    var el = document.getElementById('msg-text');
    el.focus();
    el.value = 'still typing';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.setSelectionRange(5, 5);
  });
  await trainer.bringToFront();
  await client.evaluate(function () {
    return window.WBAuth.sendMessage('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Adding a set');
  });
  await trainer.waitForFunction(function () { return document.body.innerText.indexOf('Adding a set') !== -1; });
  assert.deepStrictEqual(await trainer.evaluate(function () {
    var el = document.getElementById('msg-text');
    return { s: el.selectionStart, e: el.selectionEnd, v: el.value };
  }), { s: 5, e: 5, v: 'still typing' });
  await client.close();

  await trainer.evaluate(function () {
    var el = document.getElementById('msg-text');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    window.__msgFail = 'slow';
    window.__sentIds = [];
  });
  await trainer.type('#msg-text', 'See you Friday');
  await trainer.click('#msg-send');
  await trainer.evaluate(function (id) { location.hash = '#/messages/' + id; }, E);
  await trainer.waitForSelector('#msg-text');
  assert.strictEqual(await trainer.$eval('#msg-send', function (el) { return el.disabled; }), false);
  await trainer.evaluate(function () { return window.WBMessages.refresh(); });
  assert.strictEqual(await trainer.$eval('#msg-send', function (el) { return el.disabled; }), false);
  await trainer.type('#msg-text', 'keep this draft');
  await trainer.waitForFunction(function () {
    var box = JSON.parse(localStorage.getItem('wb.msgbox'));
    return box.messages.filter(function (m) { return m.body === 'See you Friday'; }).length === 1;
  });
  assert.strictEqual(await trainer.$eval('#msg-text', function (el) { return el.value; }), 'keep this draft');
  assert.strictEqual(await trainer.$eval('#msg-send', function (el) { return el.disabled; }), false);
  await trainer.evaluate(function (id) { location.hash = '#/messages/' + id; }, C);
  await trainer.waitForFunction(function () {
    return document.body.innerText.indexOf('See you Friday') !== -1 && document.getElementById('msg-text') && document.getElementById('msg-text').value === '';
  });
  assert.strictEqual(await trainer.$$eval('.bubble', function (els) {
    return els.filter(function (el) { return el.textContent.indexOf('See you Friday') !== -1; }).length;
  }), 1);
  assert.strictEqual(await trainer.$eval('#msg-send', function (el) { return el.disabled; }), false);

  // Reopen this same conversation while the send is still in flight, and let
  // the send finish before that reload returns. The screen must not stay on Loading.
  await trainer.evaluate(function () { window.__msgFail = 'slow'; window.__sentIds = []; });
  await trainer.type('#msg-text', 'back soon');
  await trainer.click('#msg-send');
  await trainer.evaluate(function () { location.hash = '#/messages'; });
  await trainer.waitForSelector('#thread-list');
  await trainer.evaluate(function (id) {
    window.__msgOpenDelay = 2000;
    location.hash = '#/messages/' + id;
  }, C);
  await trainer.waitForFunction(function () {
    var input = document.getElementById('msg-text');
    var button = document.getElementById('msg-send');
    return input && button && !button.disabled && input.value === '' && document.body.innerText.indexOf('back soon') !== -1;
  }, { timeout: 8000 });
  assert.strictEqual(await trainer.$$eval('.bubble', function (els) {
    return els.filter(function (el) { return el.textContent.indexOf('back soon') !== -1; }).length;
  }), 1);

  await trainer.evaluate(function () { window.__msgFail = 'offline'; window.__sentIds = []; });
  await trainer.type('#msg-text', 'retry me');
  await trainer.click('#msg-send');
  await trainer.waitForFunction(function () {
    return document.getElementById('toast').textContent.indexOf('Failed to fetch') !== -1 && !document.getElementById('msg-send').disabled && document.getElementById('msg-text').value === 'retry me';
  });
  assert.strictEqual(await trainer.evaluate(function () {
    return JSON.parse(localStorage.getItem('wb.msgbox')).messages.filter(function (m) { return m.body === 'retry me'; }).length;
  }), 0);
  const offlineIds = await trainer.evaluate(function () { return window.__sentIds.slice(); });
  await trainer.click('#msg-send');
  await trainer.waitForFunction(function () {
    return document.getElementById('msg-text').value === '' && !document.getElementById('msg-send').disabled && document.body.innerText.indexOf('retry me') !== -1;
  });
  const retried = await trainer.evaluate(function () { return window.__sentIds.slice(); });
  assert.strictEqual(offlineIds.length, 1);
  assert.deepStrictEqual(retried, [offlineIds[0], offlineIds[0]]);
  assert.strictEqual(await trainer.evaluate(function () {
    return JSON.parse(localStorage.getItem('wb.msgbox')).messages.filter(function (m) { return m.body === 'retry me'; }).length;
  }), 1);

  await trainer.evaluate(function () { window.__msgFail = 'lose'; window.__sentIds = []; });
  await trainer.type('#msg-text', 'only once');
  await trainer.click('#msg-send');
  await trainer.waitForFunction(function () {
    var box = JSON.parse(localStorage.getItem('wb.msgbox'));
    return box.messages.filter(function (m) { return m.body === 'only once'; }).length === 1
      && document.getElementById('msg-text').value === 'only once'
      && !document.getElementById('msg-send').disabled;
  });
  await trainer.click('#msg-send');
  await trainer.waitForFunction(function () {
    return document.getElementById('msg-text').value === '' && document.body.innerText.indexOf('only once') !== -1;
  });
  assert.strictEqual(await trainer.evaluate(function () {
    var box = JSON.parse(localStorage.getItem('wb.msgbox'));
    var rows = box.messages.filter(function (m) { return m.body === 'only once'; });
    return rows.length === 1 && window.__sentIds[0] === window.__sentIds[1] && window.__sentIds.length === 2;
  }), true);
  assert.strictEqual(await trainer.$$eval('.bubble', function (els) {
    return els.filter(function (el) { return el.textContent.indexOf('only once') !== -1; }).length;
  }), 1);

  await trainer.evaluate(function (id) {
    var box = JSON.parse(localStorage.getItem('wb.msgbox'));
    box.links.forEach(function (l) { if (l.clientId === id) l.endedAt = new Date().toISOString(); });
    localStorage.setItem('wb.msgbox', JSON.stringify(box));
    location.hash = '#/messages/' + id;
  }, E);
  await trainer.waitForSelector('#messages-closed');
  assert.strictEqual(await trainer.$('#msg-send'), null);
  assert.strictEqual(await trainer.evaluate(function (id) {
    return window.WBAuth.sendMessage(id, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'after end').then(function () { return 'sent'; }, function (err) { return err.message; });
  }, E), 'There is no connection.');
  await trainer.click('[data-thread-back]');
  await trainer.waitForSelector('#thread-list');
  assert.strictEqual(await trainer.$('[data-thread="' + E + '"]'), null);
  assert.ok(await trainer.$('[data-thread="' + C + '"]'));
  await trainer.click('#back');
  await trainer.waitForSelector('[data-a=new]');

  const closed = await browser.newPage();
  closed.on('pageerror', function (e) { errs.push('closed ' + e); });
  await closed.setViewport({ width: 412, height: 915, isMobile: true, deviceScaleFactor: 2 });
  await closed.evaluateOnNewDocument(function () {
    var stub = {
      session: function () { return Promise.resolve({ user: { id: '22222222-2222-4222-8222-222222222222', email: 'ada@example.com' } }); },
      profile: function () { return Promise.resolve({ id: '22222222-2222-4222-8222-222222222222', email: 'ada@example.com', membership: 'free_client', intended_plan: null }); },
      myConnection: function () { return Promise.resolve(null); },
      threads: function () { return Promise.reject(new Error('Messages are not available yet. Apply the messages SQL in the Supabase SQL editor.')); }
    };
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return stub; },
      set: function () {}
    });
  });
  await closed.goto(URL + '#/messages');
  await closed.reload();
  await closed.waitForSelector('#messages-wait');
  assert.ok((await closed.evaluate(function () { return document.body.innerText; })).includes('Not available yet'));
  assert.strictEqual(await closed.$('[data-a=new], .pl-screen, #msg-send'), null);
  await closed.evaluate(function () { location.hash = '#/subscriptions'; });
  await closed.waitForFunction(function () { return document.body.innerText.indexOf('Choose how you want to train') !== -1; });

  const signedOut = await browser.newPage();
  signedOut.on('pageerror', function (e) { errs.push('out ' + e); });
  await signedOut.evaluateOnNewDocument(function () {
    var stub = { session: function () { return Promise.resolve(null); } };
    Object.defineProperty(window, 'WBAuth', {
      configurable: true, enumerable: true,
      get: function () { return stub; },
      set: function () {}
    });
  });
  await signedOut.goto(URL + '#/messages');
  await signedOut.reload();
  await signedOut.waitForFunction(function () { return location.hash === '#/signin' && document.querySelector('h2') && document.querySelector('h2').textContent === 'Sign in'; });

  assert.deepStrictEqual(errs, []);
  console.log('MESSAGES UI OK');
  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
