/* One conversation per active trainer/client link. */
(function (root) {
  'use strict';

  function cleanBody(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  }
  function mergeById(list, extras) {
    var map = {}, order = [];
    function add(m) {
      if (!m || m.id == null || m.id === '') return;
      var key = String(m.id);
      if (!map[key]) order.push(key);
      map[key] = m;
    }
    (list || []).forEach(add);
    (extras || []).forEach(add);
    return order.map(function (key) { return map[key]; });
  }
  function timeValue(m) {
    var t = new Date(m && m.at).getTime();
    return isNaN(t) ? null : t;
  }
  function byTime(a, b) {
    var ta = timeValue(a), tb = timeValue(b);
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    if (ta !== tb) return ta - tb;
    var ia = String(a.id), ib = String(b.id);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  }
  // The server list is the newest window. A cached row that is missing from
  // it is kept only when it is newer than that window (a send the fetch
  // missed). Older rows are not new, and the result is always time order.
  function applyServerList(serverList, cached) {
    var server = serverList || [];
    var seen = {};
    var newest = null;
    server.forEach(function (m) {
      if (!m || m.id == null) return;
      seen[String(m.id)] = 1;
      var t = timeValue(m);
      if (t != null && (newest == null || t > newest)) newest = t;
    });
    var extra = (cached || []).filter(function (m) {
      if (!m || m.id == null || seen[String(m.id)]) return false;
      var t = timeValue(m);
      if (newest == null) return t != null;
      return t != null && t > newest;
    });
    return mergeById(server, extra).sort(byTime);
  }
  // Same text keeps the same id, so a retry cannot mint a second message.
  function prepareAttempt(prev, text, makeId) {
    text = cleanBody(text);
    if (!text) return null;
    if (prev && prev.id && prev.body === text) return { id: prev.id, body: text };
    return { id: makeId(), body: text };
  }
  function initials(name) {
    var local = String(name || '').split('@')[0].replace(/[^a-z0-9]/gi, '');
    if (local.length >= 2) return local.slice(0, 2).toUpperCase();
    var bits = String(name || '').split(' ').filter(Boolean);
    return ((bits[0] || '?').charAt(0) + (bits[1] ? bits[1].charAt(0) : '')).toUpperCase();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function whenLabel(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function newId() {
    var c = (root && root.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    if (c && c.randomUUID) return c.randomUUID();
    var hex = '';
    for (var i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
  }
  function pollMs() {
    var n = Number(root && root.__wbMessagePollMs);
    if (n >= 200 && n <= 60000) return n;
    return 5000;
  }
  function currentThread() {
    var raw = typeof location !== 'undefined' && location.hash ? location.hash : '';
    var parts = raw.replace(/^#\/?/, '').split('?')[0].split('/');
    if (parts[0] !== 'messages' || !parts[1]) return '';
    try { return decodeURIComponent(parts[1]); } catch (e) { return parts[1]; }
  }
  function isUnavailable(err) {
    return !!(err && /not available yet|not ready/i.test(err.message || ''));
  }
  function isClosed(err) {
    return !!(err && /no connection/i.test(err.message || ''));
  }

  var ctx = null, gen = 0, openId = '', timer = 0, unwatch = null, onVis = null, listSeq = 0;
  var drafts = {}, draftGen = {}, attempts = {}, inflight = {}, cache = {}, threadSeq = {}, marked = {};

  function saveDraftFromDom() {
    if (typeof document === 'undefined' || !openId) return;
    var box = document.getElementById('msg-text');
    if (!box) return;
    drafts[openId] = box.value;
  }
  function stop() {
    saveDraftFromDom();
    openId = '';
    gen += 1;
    if (timer) clearInterval(timer);
    timer = 0;
    if (onVis && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVis);
      onVis = null;
    }
    if (unwatch) {
      var off = unwatch;
      unwatch = null;
      try { off(); } catch (e) {}
    }
  }
  function ensureLive(refresh) {
    if (timer) return;
    var myGen = gen;
    timer = setInterval(function () {
      if (myGen !== gen || (typeof document !== 'undefined' && document.hidden)) return;
      refresh();
    }, pollMs());
    onVis = function () {
      if (myGen !== gen || document.hidden) return;
      refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    var auth = root.WBAuth;
    if (!auth || !auth.watchMessages) return;
    auth.watchMessages(function () {
      if (myGen !== gen || document.hidden) return;
      refresh();
    }).then(function (off) {
      if (myGen !== gen) { if (off) off(); return; }
      unwatch = off;
    }).catch(function () {});
  }
  function syncButton(id) {
    if (currentThread() !== id || typeof document === 'undefined') return;
    var btn = document.getElementById('msg-send');
    if (btn) btn.disabled = !!inflight[id];
  }
  function applyServer(id, serverList) {
    cache[id] = applyServerList(serverList, cache[id]);
  }
  function absorb(id, row) {
    if (!row || row.id == null) return;
    cache[id] = mergeById(cache[id] || [], [{
      id: row.id,
      mine: row.mine !== false,
      body: row.body,
      at: row.at,
      readAt: row.readAt || null
    }]).sort(byTime);
  }
  function paintBubbles(id) {
    var thread = document.getElementById('thread');
    if (!thread) return;
    var list = cache[id] || [];
    var sig = list.map(function (m) { return m.id; }).join(',');
    if (list.length && thread.getAttribute('data-sig') === sig) return;
    var html = list.map(function (m) {
      return '<div class="bubble' + (m.mine ? ' me' : '') + '" data-id="' + esc(m.id) + '"><span>' + esc(m.body) + '</span><span class="when">' + esc(whenLabel(m.at)) + '</span></div>';
    }).join('');
    if (!list.length) html = '<p class="mute" id="thread-empty">No messages yet.</p>';
    var prev = thread.getAttribute('data-sig');
    thread.innerHTML = html;
    thread.setAttribute('data-sig', sig);
    var box = document.getElementById('msg-text');
    if (list.length && prev !== sig && box && document.activeElement !== box) {
      var last = thread.lastElementChild;
      if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end' });
    }
  }
  function personRow(p) {
    var unread = Number(p.unread) || 0;
    return '<button type="button" class="person" data-thread="' + esc(p.id) + '">' +
      '<span class="ava" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
      '<span class="grow"><span class="row" style="width:100%;margin:0"><span class="name">' + esc(p.name) + '</span>' +
      '<span class="mute" style="margin-left:auto">' + esc(whenLabel(p.at)) + '</span></span>' +
      '<span class="preview">' + esc(p.preview || 'No messages yet') + '</span>' +
      '<span class="mute">' + esc(p.plan || '') + '</span></span>' +
      (unread ? '<span class="count">' + esc(unread) + '</span>' : '') + '</button>';
  }
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('#msg-send, [data-thread-back], [data-thread]') : null;
    if (!t || !ctx) return;
    if (t.id === 'msg-send') return sendCurrent();
    if (t.hasAttribute('data-thread-back')) return ctx.go('#/messages');
    var id = t.getAttribute('data-thread');
    if (id) ctx.go('#/messages/' + encodeURIComponent(id));
  }
  function showUnavailable(err) {
    if (!ctx) return;
    openId = '';
    ctx.titleEl.textContent = 'Messages';
    ctx.backBtn.hidden = false;
    var detail = (err && err.message) || 'Messages are not available yet. Apply the messages SQL in the Supabase SQL editor.';
    ctx.app.innerHTML = '<div class="card" id="messages-wait"><div class="name">Not available yet</div><p class="mute">' + esc(detail) + '</p></div>';
    ctx.app.onclick = null;
  }
  function showClosed() {
    if (!ctx) return;
    openId = '';
    ctx.titleEl.textContent = 'Messages';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = '<div class="card" id="messages-closed"><div class="name">Conversation closed</div>' +
      '<p class="mute">This conversation is hidden because the connection has ended.</p></div>' +
      '<button type="button" data-thread-back style="width:100%">All messages</button>';
    ctx.app.onclick = onClick;
  }
  function showFailure(err) {
    if (isUnavailable(err)) return showUnavailable(err);
    if (isClosed(err)) return showClosed();
    if (!ctx) return;
    openId = '';
    ctx.titleEl.textContent = 'Messages';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = '<div class="errs" id="messages-error">' + esc((err && err.message) || 'Could not load messages') + '</div>';
    ctx.app.onclick = null;
  }
  function showList(data) {
    if (!ctx) return;
    openId = '';
    ctx.titleEl.textContent = 'Messages';
    ctx.backBtn.hidden = false;
    var threads = data.threads || [];
    var h;
    if (!threads.length) {
      h = '<div class="empty" id="thread-list">' + (data.role === 'trainer' ? 'No linked people yet.' : 'You are not connected to a trainer.') + '</div>';
    } else {
      h = '<div id="thread-list">';
      threads.forEach(function (p) { h += personRow(p); });
      h += '</div>';
    }
    ctx.app.innerHTML = h;
    ctx.app.onclick = onClick;
  }
  function showThread(id, data) {
    if (!ctx) return;
    var person = (data && data.person) || {};
    var shell = document.getElementById('talk');
    var existing = document.getElementById('msg-text');
    if (existing && shell && shell.getAttribute('data-person') === id) {
      paintBubbles(id);
      syncButton(id);
      return;
    }
    openId = id;
    ctx.titleEl.textContent = person.name || 'Messages';
    ctx.backBtn.hidden = false;
    var plan = person.plan || '';
    var sub = plan ? plan + (plan !== 'Trainer' ? ' · linked client' : '') : '';
    var h = '<div id="talk" data-person="' + esc(id) + '">';
    if (sub) h += '<p class="mute" id="with">' + esc(sub) + '</p>';
    h += '<div class="thread" id="thread"></div></div>';
    h += '<div class="dock"><div class="inner composer"><input id="msg-text" placeholder="Message" autocomplete="off" maxlength="2000">' +
      '<button type="button" class="pri" id="msg-send"' + (inflight[id] ? ' disabled' : '') + '>Send</button></div></div>';
    ctx.app.innerHTML = h;
    ctx.app.onclick = onClick;
    var box = document.getElementById('msg-text');
    if (box) {
      box.value = drafts[id] || '';
      box.oninput = function () {
        drafts[id] = box.value;
        draftGen[id] = (draftGen[id] || 0) + 1;
        if (attempts[id] && attempts[id].body !== cleanBody(box.value) && !inflight[id]) delete attempts[id];
      };
      box.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); sendCurrent(); }
      };
    }
    paintBubbles(id);
  }
  function noteRead(id, messages) {
    var auth = root.WBAuth;
    if (!auth || !auth.markRead) return;
    var fresh = [];
    (messages || []).forEach(function (m) {
      if (m && !m.mine && !m.readAt && !marked[m.id]) fresh.push(m.id);
    });
    if (!fresh.length) return;
    fresh.forEach(function (mid) { marked[mid] = 1; });
    auth.markRead(id).catch(function () {
      fresh.forEach(function (mid) { delete marked[mid]; });
    });
  }
  function loadThreads(quiet) {
    var auth = root.WBAuth;
    var myGen = gen;
    var seq = ++listSeq;
    if (!ctx) return Promise.resolve();
    if (!auth || !auth.threads) { showUnavailable(); return Promise.resolve(); }
    if (!quiet) {
      ctx.titleEl.textContent = 'Messages';
      ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    }
    return Promise.resolve().then(function () { return auth.threads(); }).then(function (data) {
      if (myGen !== gen || seq !== listSeq || currentThread()) return;
      showList(data || {});
      ensureLive(function () { loadThreads(true); });
    }, function (err) {
      if (myGen !== gen || seq !== listSeq || currentThread()) return;
      if (quiet && (document.getElementById('thread-list') || document.getElementById('messages-wait'))) return;
      showFailure(err);
    });
  }
  function loadThread(id, quiet) {
    var auth = root.WBAuth;
    var myGen = gen;
    var seq = (threadSeq[id] = (threadSeq[id] || 0) + 1);
    if (!ctx) return Promise.resolve();
    if (!auth || !auth.messages) { showUnavailable(); return Promise.resolve(); }
    if (!quiet && !document.getElementById('msg-text')) {
      ctx.titleEl.textContent = 'Messages';
      ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    }
    return Promise.resolve().then(function () { return auth.messages(id); }).then(function (data) {
      if (myGen !== gen || threadSeq[id] !== seq || currentThread() !== id) return;
      applyServer(id, (data && data.messages) || []);
      noteRead(id, data && data.messages);
      showThread(id, data || {});
      ensureLive(function () { if (currentThread() === id) loadThread(id, true); });
    }, function (err) {
      if (myGen !== gen || threadSeq[id] !== seq || currentThread() !== id) return;
      if (isClosed(err)) {
        if (timer) clearInterval(timer);
        timer = 0;
        return showClosed();
      }
      if (quiet && document.getElementById('msg-text')) return;
      showFailure(err);
    });
  }
  function settle(id, attemptId) {
    if (inflight[id] && inflight[id].id === attemptId) delete inflight[id];
    syncButton(id);
  }
  function finishOk(id, attempt, text, genAt, row) {
    settle(id, attempt.id);
    if (attempts[id] && attempts[id].id === attempt.id) delete attempts[id];
    if ((draftGen[id] || 0) === genAt) {
      drafts[id] = '';
      if (currentThread() === id && typeof document !== 'undefined') {
        var input = document.getElementById('msg-text');
        if (input && cleanBody(input.value) === text) input.value = '';
      }
    }
    // Do not bump the load sequence. A send that finishes after this
    // conversation was closed and opened again must not throw away the
    // load that replaces "Loading…".
    absorb(id, row);
    if (currentThread() === id) paintBubbles(id);
  }
  function finishErr(id, attempt, err) {
    settle(id, attempt.id);
    if (currentThread() === id && ctx && ctx.toast) ctx.toast((err && err.message) || 'Could not send');
  }
  function sendCurrent() {
    var id = currentThread();
    if (!id || inflight[id]) return;
    var box = typeof document !== 'undefined' ? document.getElementById('msg-text') : null;
    if (!box) return;
    var text = cleanBody(box.value);
    if (!text) return;
    var auth = root.WBAuth;
    if (!auth || !auth.sendMessage) return showUnavailable();
    var genAt = draftGen[id] || 0;
    var attempt = prepareAttempt(attempts[id], text, newId);
    attempts[id] = attempt;
    inflight[id] = { id: attempt.id, body: text };
    // The request settles the button. A timer must not call this a failure,
    // or a slow success could be sent again as a second message.
    syncButton(id);
    Promise.resolve().then(function () {
      return auth.sendMessage(id, attempt.id, text);
    }).then(function (row) {
      finishOk(id, attempt, text, genAt, row);
    }, function (err) {
      finishErr(id, attempt, err);
    });
  }
  function refresh() {
    if (!ctx) return Promise.resolve();
    var id = currentThread();
    if (id) return loadThread(id, true);
    return loadThreads(true);
  }
  function mount(next) {
    stop();
    ctx = next || null;
    if (!ctx) return;
    ctx.backBtn.hidden = false;
    if (currentThread()) loadThread(currentThread(), false);
    else loadThreads(false);
  }

  var api = {
    cleanBody: cleanBody,
    mergeById: mergeById,
    applyServerList: applyServerList,
    prepareAttempt: prepareAttempt,
    initials: initials,
    mount: mount,
    stop: stop,
    refresh: refresh
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBMessages = api;
})(typeof window !== 'undefined' ? window : globalThis);
