// Trainer Hub screens. The live Supabase project is not used.
// node tests/hub-ui.test.js [url]
const assert = require('assert');
const fs = require('fs');
const pp = require('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8787/';
const ART = '/opt/cursor/artifacts';

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const chrome = process.env.CHROME || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : '/usr/local/bin/google-chrome');
  const b = await pp.launch({ executablePath: chrome, args: ['--no-sandbox', '--hide-scrollbars'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', function (e) { errs.push(String(e)); });
  p.on('dialog', function (d) { d.accept(); });
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument(function () {
    window.__mode = 'trainer';
    window.__fail = '';
    var T = '11111111-1111-4111-8111-111111111111';
    var C = '22222222-2222-4222-8222-222222222222';
    var E = '33333333-3333-4333-8333-333333333333';
    var A = '44444444-4444-4444-8444-444444444444';
    var now = Date.now();
    window.__hub = {
      posts: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          authorId: E,
          title: 'How do you program a deload week?',
          body: 'I have been adding weight for six weeks. What do you change, and what do you keep?',
          createdAt: new Date(now - 3 * 3600000).toISOString(),
          updatedAt: new Date(now - 3 * 3600000).toISOString(),
          activityAt: new Date(now - 2 * 3600000).toISOString()
        },
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
          authorId: T,
          title: 'Saturday strength block',
          body: 'Looking for a simple Saturday plan the group can run together.',
          createdAt: new Date(now - 30 * 60000).toISOString(),
          updatedAt: new Date(now - 30 * 60000).toISOString(),
          activityAt: new Date(now - 10 * 60000).toISOString()
        }
      ],
      replies: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
          postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
          authorId: C,
          body: 'I can do 9am if the rack is free.',
          createdAt: new Date(now - 10 * 60000).toISOString(),
          updatedAt: new Date(now - 10 * 60000).toISOString()
        }
      ],
      reports: [
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
          reporterId: C,
          postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          replyId: '',
          status: 'open',
          createdAt: new Date(now - 20 * 60000).toISOString()
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
          reporterId: E,
          postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
          replyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
          status: 'open',
          createdAt: new Date(now - 8 * 60000).toISOString()
        }
      ]
    };
    var people = {};
    people[T] = { name: 'Coach Kim', role: 'Master Trainer', verified: true };
    people[C] = { name: 'Ada Lee', role: 'Free Client', verified: false };
    people[E] = { name: 'Jo Park', role: 'Enthusiast', verified: false };
    people[A] = { name: 'Kinisi', role: 'Trainer', verified: false };
    function me() {
      if (window.__mode === 'client') return { id: C, email: 'ada@example.com', membership: 'free_client', name: 'Ada Lee' };
      if (window.__mode === 'waiting') return { id: '55555555-5555-4555-8555-555555555555', email: 'pat@example.com', membership: 'none', name: 'Pat Lee', approved: false };
      if (window.__mode === 'admin') return { id: A, email: 'kinisiathletics@gmail.com', membership: 'trainer', name: 'Kinisi' };
      return { id: T, email: 'coach@example.com', membership: 'master_trainer', name: 'Coach Kim' };
    }
    function box() { return window.__hub; }
    function author(id) { return people[id] || { name: 'Member', role: 'Member', verified: false }; }
    function postRow(row, who) {
      var person = author(row.authorId);
      return {
        id: row.id,
        title: row.title,
        body: row.body,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        activityAt: row.activityAt,
        replyCount: box().replies.filter(function (r) { return r.postId === row.id; }).length,
        reported: box().reports.some(function (r) {
          return r.status === 'open' && r.reporterId === who.id && r.postId === row.id && !r.replyId;
        }),
        mine: row.authorId === who.id,
        author: { name: person.name, role: person.role, verified: !!person.verified }
      };
    }
    function replyRow(row, who) {
      var person = author(row.authorId);
      return {
        id: row.id,
        postId: row.postId,
        body: row.body,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        reported: box().reports.some(function (r) {
          return r.status === 'open' && r.reporterId === who.id && r.replyId === row.id;
        }),
        mine: row.authorId === who.id,
        author: { name: person.name, role: person.role, verified: !!person.verified }
      };
    }
    function reportRow(row) {
      var post = box().posts.filter(function (item) { return item.id === row.postId; })[0] || {};
      var reply = box().replies.filter(function (item) { return item.id === row.replyId; })[0];
      var wrote = author(reply ? reply.authorId : post.authorId);
      return {
        id: row.id,
        postId: row.postId,
        replyId: row.replyId || '',
        kind: row.replyId ? 'reply' : 'post',
        createdAt: row.createdAt,
        title: post.title || '',
        body: reply ? reply.body : (post.body || ''),
        authorName: wrote.name,
        authorRole: wrote.role,
        authorVerified: !!wrote.verified,
        reporterName: author(row.reporterId).name
      };
    }
    var current;
    function patch(api) {
      if (!api || api.__hubStub) return api;
      api.__hubStub = true;
      api.TURNSTILE_SITE_KEY = '';
      api.session = function () {
        if (window.__mode === 'out') return Promise.resolve(null);
        var who = me();
        return Promise.resolve({ user: { id: who.id, email: who.email } });
      };
      api.freshSession = function () { return api.session(); };
      api.profile = function () {
        var who = me();
        return Promise.resolve({
          id: who.id,
          email: who.email,
          membership: who.membership,
          intended_plan: who.membership === 'none' ? null : who.membership,
          display_name: who.name,
          access_approved: who.approved !== false,
          profileReady: true,
          online_only: true
        });
      };
      api.signOut = function () { return Promise.resolve(); };
      api.myConnection = function () { return Promise.resolve(null); };
      api.roster = function () { return Promise.resolve({ role: null, clients: [], invites: [] }); };
      api.workoutCopies = function () { return Promise.resolve([]); };
      api.accountPull = function () { return Promise.resolve([]); };
      api.accountImport = function () { return Promise.resolve({}); };
      api.accountPush = function () { return Promise.resolve({}); };
      api.avatarUrl = function () { return Promise.resolve(''); };
      api.verificationQueue = function () { return Promise.resolve([]); };
      api.accessAccounts = function () { return Promise.resolve([]); };
      api.hubPosts = function () {
        var who = me();
        return Promise.resolve(box().posts.map(function (row) { return postRow(row, who); }));
      };
      api.hubPost = function (id) {
        var who = me();
        var row = box().posts.filter(function (item) { return item.id === id; })[0];
        if (!row) return Promise.reject(new Error('That post is not available.'));
        return Promise.resolve({
          post: postRow(row, who),
          replies: box().replies.filter(function (item) { return item.postId === id; }).map(function (item) { return replyRow(item, who); })
        });
      };
      api.hubSavePost = function (row) {
        if (window.__fail === 'post') return Promise.reject(new Error('You can post again in a little while.'));
        var who = me();
        var found = box().posts.filter(function (item) { return item.id === row.id; })[0];
        if (row.existing && found) {
          if (found.authorId !== who.id) return Promise.reject(new Error('You can only edit your own post.'));
          found.title = row.title;
          found.body = row.body;
          found.updatedAt = new Date().toISOString();
          return Promise.resolve({ id: found.id });
        }
        box().posts.push({
          id: row.id,
          authorId: who.id,
          title: row.title,
          body: row.body,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          activityAt: new Date().toISOString()
        });
        return Promise.resolve({ id: row.id });
      };
      api.hubDeletePost = function (id) {
        var who = me();
        var row = box().posts.filter(function (item) { return item.id === id; })[0];
        if (!row || (row.authorId !== who.id && window.__mode !== 'admin')) return Promise.reject(new Error('You can only delete your own post.'));
        box().posts = box().posts.filter(function (item) { return item.id !== id; });
        box().replies = box().replies.filter(function (item) { return item.postId !== id; });
        box().reports = box().reports.filter(function (item) { return item.postId !== id; });
        return Promise.resolve(true);
      };
      api.hubSaveReply = function (row) {
        if (window.__fail === 'reply') return Promise.reject(new Error('You can reply again in a little while.'));
        var who = me();
        var found = box().replies.filter(function (item) { return item.id === row.id; })[0];
        if (row.existing && found) {
          if (found.authorId !== who.id) return Promise.reject(new Error('You can only edit your own reply.'));
          found.body = row.body;
          found.updatedAt = new Date().toISOString();
          return Promise.resolve({ id: found.id });
        }
        var post = box().posts.filter(function (item) { return item.id === row.postId; })[0];
        if (post) post.activityAt = new Date().toISOString();
        box().replies.push({
          id: row.id,
          postId: row.postId,
          authorId: who.id,
          body: row.body,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        return Promise.resolve({ id: row.id });
      };
      api.hubDeleteReply = function (id) {
        var who = me();
        var row = box().replies.filter(function (item) { return item.id === id; })[0];
        if (!row || (row.authorId !== who.id && window.__mode !== 'admin')) return Promise.reject(new Error('You can only delete your own reply.'));
        box().replies = box().replies.filter(function (item) { return item.id !== id; });
        box().reports = box().reports.filter(function (item) { return item.replyId !== id; });
        return Promise.resolve(true);
      };
      api.hubReport = function (row) {
        var who = me();
        var dup = box().reports.some(function (item) {
          return item.status === 'open' && item.reporterId === who.id && item.postId === row.postId && (item.replyId || '') === (row.replyId || '');
        });
        if (dup) return Promise.reject(new Error('You already reported this.'));
        box().reports.push({
          id: 'cccccccc-cccc-4ccc-8ccc-' + String(box().reports.length + 1).padStart(12, '0'),
          reporterId: who.id,
          postId: row.postId,
          replyId: row.replyId || '',
          status: 'open',
          createdAt: new Date().toISOString()
        });
        return Promise.resolve({ id: 'ok' });
      };
      api.hubReports = function () {
        return Promise.resolve(box().reports.filter(function (item) { return item.status === 'open'; }).map(reportRow));
      };
      api.hubDismissReport = function (id) {
        var row = box().reports.filter(function (item) { return item.id === id; })[0];
        if (!row) return Promise.reject(new Error('That report is not available.'));
        row.status = 'dismissed';
        return Promise.resolve({ id: id });
      };
      api.hubDeleteReported = function (row) {
        if (window.__mode !== 'admin') return Promise.reject(new Error('Only the admin can review a report.'));
        if (row.kind === 'reply') return api.hubDeleteReply(row.replyId);
        return api.hubDeletePost(row.postId);
      };
      return api;
    }
    Object.defineProperty(window, 'WBAuth', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (v) { current = patch(v); }
    });
  });

  await p.goto(URL + '#/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#hub-nav');
  const nav = await p.evaluate(function () {
    function box(id) {
      var el = document.getElementById(id);
      var r = el.getBoundingClientRect();
      return { text: el.textContent, left: r.left, right: r.right, width: r.width };
    }
    return {
      tools: document.getElementById('home-tools').innerText.replace(/\s+/g, ' '),
      messages: box('messages-nav'),
      hub: box('hub-nav'),
      send: box('send-nav'),
      width: window.innerWidth
    };
  });
  assert.ok(nav.tools.indexOf('Messages') !== -1);
  assert.ok(nav.tools.indexOf('Trainer Hub') !== -1);
  assert.ok(nav.tools.indexOf('Send workout') !== -1);
  [nav.messages, nav.hub, nav.send].forEach(function (item) {
    assert.ok(item.left >= -1 && item.right <= nav.width + 1, item.text + ' overflows');
    assert.ok(item.width > 70, item.text + ' is too narrow');
  });

  await p.click('#hub-nav');
  await p.waitForSelector('#hub-list');
  const list = await p.evaluate(function () {
    var text = document.getElementById('app').innerText;
    var ids = Array.prototype.map.call(document.querySelectorAll('[data-post]'), function (el) {
      return el.getAttribute('data-post');
    });
    return {
      title: document.getElementById('title').textContent,
      text: text,
      ids: ids,
      script: document.querySelector('#app script, #hub-list script')
    };
  });
  assert.strictEqual(list.title, 'Trainer Hub');
  assert.ok(list.text.indexOf('@') === -1);
  assert.ok(list.text.indexOf('Saturday strength block') !== -1);
  assert.ok(list.text.indexOf('Coach Kim') !== -1);
  assert.ok(list.text.indexOf('Master Trainer') !== -1);
  assert.ok(list.text.indexOf('Jo Park') !== -1);
  assert.ok(list.text.indexOf('Enthusiast') !== -1);
  assert.strictEqual(list.ids[0], 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
  assert.strictEqual(list.script, null);
  await p.screenshot({ path: ART + '/hub_post_list.png' });

  await p.click('[data-post="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"]');
  await p.waitForFunction(function () {
    return document.getElementById('hub-post') && document.body.innerText.indexOf('I can do 9am if the rack is free.') !== -1;
  });
  const open = await p.evaluate(function () {
    return {
      title: document.getElementById('title').textContent,
      text: document.getElementById('app').innerText,
      edit: !!document.getElementById('hub-edit'),
      reportReply: !!document.querySelector('[data-reply-report]'),
      script: document.querySelector('#hub-post script, #hub-replies script')
    };
  });
  assert.strictEqual(open.title, 'Saturday strength block');
  assert.ok(open.text.indexOf('@') === -1);
  assert.ok(open.text.indexOf('Ada Lee') !== -1);
  assert.ok(open.text.indexOf('Free Client') !== -1);
  assert.ok(open.edit);
  assert.ok(open.reportReply);
  assert.strictEqual(open.script, null);
  await p.screenshot({ path: ART + '/hub_open_post.png' });

  await p.evaluate(function () { location.hash = '#/hub/new'; });
  await p.waitForSelector('#hub-form');
  const form = await p.evaluate(function () {
    var title = document.getElementById('hub-title');
    var body = document.getElementById('hub-body');
    var save = document.getElementById('hub-save');
    return {
      heading: document.getElementById('title').textContent,
      titleLabel: document.querySelector('label[for="hub-title"]').textContent,
      bodyLabel: document.querySelector('label[for="hub-body"]').textContent,
      save: save.textContent,
      empty: title.value === '' && body.value === '',
      wide: save.getBoundingClientRect().width > 200
    };
  });
  assert.strictEqual(form.heading, 'New post');
  assert.strictEqual(form.titleLabel, 'Title');
  assert.strictEqual(form.bodyLabel, 'Post');
  assert.strictEqual(form.save, 'Post');
  assert.strictEqual(form.empty, true);
  assert.strictEqual(form.wide, true);
  await p.screenshot({ path: ART + '/hub_new_post.png' });

  await p.type('#hub-title', '<script>alert(1)</script>');
  await p.type('#hub-body', 'Plain text only.\nSecond line.');
  await p.click('#hub-save');
  await p.waitForSelector('#hub-post');
  const saved = await p.evaluate(function () {
    return {
      html: document.getElementById('hub-post').innerHTML,
      text: document.getElementById('hub-post').innerText,
      scripts: document.querySelectorAll('#app script').length
    };
  });
  assert.strictEqual(saved.scripts, 0);
  assert.ok(saved.html.indexOf('<script>') === -1);
  assert.ok(saved.text.indexOf('<script>alert(1)</script>') !== -1);
  assert.ok(saved.text.indexOf('Plain text only.') !== -1);
  assert.ok(saved.text.indexOf('Second line.') !== -1);

  await p.type('#hub-reply', 'Count this as a reply.');
  await p.click('#hub-reply-send');
  await p.waitForFunction(function () { return document.body.innerText.indexOf('Count this as a reply.') !== -1; });
  await p.click('[data-reply-edit]');
  await p.waitForSelector('#hub-reply-edit');
  await p.evaluate(function () {
    var box = document.getElementById('hub-reply-edit');
    box.value = 'Count this edited reply.';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('[data-reply-save]');
  await p.waitForFunction(function () { return document.body.innerText.indexOf('Count this edited reply.') !== -1; });
  await p.click('[data-reply-delete]');
  await p.waitForFunction(function () { return document.body.innerText.indexOf('Count this edited reply.') === -1; });

  await p.evaluate(function () { window.__fail = 'reply'; location.hash = '#/hub/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'; });
  await p.waitForSelector('#hub-reply');
  await p.type('#hub-reply', 'Too fast');
  await p.click('#hub-reply-send');
  await p.waitForFunction(function () { return document.getElementById('toast').textContent.indexOf('a little while') !== -1; });

  await p.evaluate(function () { window.__mode = 'client'; location.hash = '#/'; });
  await p.waitForSelector('#hub-nav');
  await p.click('#hub-nav');
  await p.waitForSelector('#hub-list');
  const client = await p.evaluate(function () {
    return {
      level: !!document.getElementById('level-note'),
      text: document.getElementById('app').innerText
    };
  });
  assert.strictEqual(client.level, false);
  assert.ok(client.text.indexOf('@') === -1);
  assert.ok(client.text.indexOf('Saturday strength block') !== -1);

  await p.evaluate(function () { window.__mode = 'waiting'; location.hash = '#/subscriptions'; });
  await p.waitForSelector('#access-wait');
  await p.evaluate(function () { location.hash = '#/hub'; });
  await p.waitForSelector('#access-wait');
  assert.strictEqual(await p.$('#hub-list'), null);
  assert.strictEqual(await p.$('#hub-nav'), null);

  await p.evaluate(function () {
    var toast = document.getElementById('toast');
    if (toast) { toast.classList.remove('show'); toast.textContent = ''; }
    window.__mode = 'admin';
    location.hash = '#/account';
  });
  await p.waitForFunction(function () {
    var badge = document.getElementById('admin-count');
    return document.getElementById('admin-open') && badge && !badge.hidden && badge.textContent === '2';
  });
  await p.click('#admin-open');
  await p.waitForSelector('#hub-reports-section [data-report]');
  await p.evaluate(function () { document.getElementById('hub-reports-section').scrollIntoView({ block: 'start' }); });
  const reports = await p.evaluate(function () {
    var section = document.getElementById('hub-reports-section');
    var badge = document.getElementById('hub-report-count');
    var style = getComputedStyle(badge);
    return {
      heading: section.querySelector('h2').textContent,
      count: badge.textContent,
      label: badge.getAttribute('aria-label'),
      bg: style.backgroundColor,
      hidden: badge.hidden,
      text: section.innerText,
      cards: section.querySelectorAll('[data-report]').length
    };
  });
  assert.strictEqual(reports.heading, 'Hub reports');
  assert.strictEqual(reports.count, '2');
  assert.strictEqual(reports.label, '2 unreviewed reports');
  assert.strictEqual(reports.hidden, false);
  assert.strictEqual(reports.bg, 'rgb(220, 38, 38)');
  assert.strictEqual(reports.cards, 2);
  assert.ok(reports.text.indexOf('@') === -1);
  assert.ok(reports.text.indexOf('Jo Park') !== -1);
  assert.ok(reports.text.indexOf('Ada Lee') !== -1);
  assert.ok(reports.text.indexOf('Delete') !== -1);
  assert.ok(reports.text.indexOf('Dismiss') !== -1);
  await p.screenshot({ path: ART + '/hub_admin_reports.png' });

  await p.click('[data-hub-report="view"]');
  await p.waitForSelector('#hub-post');
  assert.ok((await p.evaluate(function () { return document.getElementById('hub-post').innerText; })).indexOf('deload') !== -1);

  await p.evaluate(function () { location.hash = '#/admin'; });
  await p.waitForSelector('#hub-reports-section [data-report]');
  await p.click('[data-hub-report="dismiss"]');
  await p.waitForFunction(function () {
    var badge = document.getElementById('hub-report-count');
    return badge && badge.textContent === '1' && document.querySelectorAll('#hub-reports-section [data-report]').length === 1;
  });
  await p.click('[data-hub-report="delete"]');
  await p.waitForSelector('#hub-reports-empty');
  const gone = await p.evaluate(function () {
    return {
      reports: window.__hub.reports.filter(function (row) { return row.status === 'open'; }).length,
      posts: window.__hub.posts.map(function (row) { return row.id; })
    };
  });
  assert.strictEqual(gone.reports, 0);

  await p.evaluate(function () { window.__mode = 'trainer'; location.hash = '#/hub/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'; });
  await p.waitForSelector('#hub-report');
  await p.click('#hub-report');
  await p.waitForFunction(function () {
    var button = document.querySelector('#hub-post button[disabled]');
    return button && button.textContent === 'Reported';
  });
  assert.ok((await p.evaluate(function () { return document.getElementById('app').innerText; })).indexOf('@') === -1);

  await p.evaluate(function () { window.__mode = 'out'; location.hash = '#/hub'; });
  await p.waitForFunction(function () { return location.hash.indexOf('signin') !== -1 || location.hash.indexOf('subscriptions') !== -1; });
  assert.strictEqual(await p.$('#hub-list'), null);

  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('hub ui ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
