/* Signed-in feedback button, send sheet, and the admin list. */
(function (root) {
  'use strict';

  var MAX = 2000;
  var GAP_MS = 15000;
  var lastSent = 0;
  var sheet = null;
  var openHash = '';
  var openReply = '';
  var replyDraft = '';
  var rows = [];
  var signedIn = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clean(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  }
  function canSend(type, message) {
    if (type !== 'bug' && type !== 'idea' && type !== 'other') return false;
    var text = clean(message);
    return text.length > 0 && text.length <= MAX;
  }
  function typeLabel(type) {
    if (type === 'bug') return 'Bug';
    if (type === 'idea') return 'Idea';
    if (type === 'other') return 'Other';
    return '';
  }
  function safeName(row) {
    row = row || {};
    var name = clean(row.name || row.display_name || row.displayName || '');
    if (name && name.indexOf('@') === -1) return name;
    return 'Member';
  }
  function pageName() {
    var el = typeof document !== 'undefined' ? document.getElementById('title') : null;
    var text = clean(el ? String(el.textContent || '').replace(/\s+/g, ' ') : '');
    if (!text) text = 'Workouts';
    return text.slice(0, 120);
  }
  function hashParts() {
    var raw = '';
    try { raw = (root.location && root.location.hash) || ''; } catch (e) { raw = ''; }
    return raw.replace(/^#\/?/, '').split('?')[0].split('/');
  }
  function coversControls() {
    var parts = hashParts();
    var page = parts[0] || '';
    if (page === 'play' || page === 'view') return true;
    if (typeof document !== 'undefined' && document.body && document.body.classList.contains('playing')) return true;
    if (page === 'circuits' && (parts[2] === 'run' || parts[2] === 'view')) return true;
    return false;
  }
  function toast(msg) {
    if (typeof document === 'undefined') return;
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function button() {
    return typeof document !== 'undefined' ? document.getElementById('feedback-open') : null;
  }
  function currentHash() {
    try { return (root.location && root.location.hash) || ''; } catch (e) { return ''; }
  }
  function sync(opts) {
    opts = opts || {};
    if (opts.signedIn != null) signedIn = !!opts.signedIn;
    var btn = button();
    if (!btn) return;
    if (sheet && currentHash() !== openHash) closeSheet();
    var show = signedIn && !coversControls() && !sheet;
    if (sheet && (!signedIn || coversControls())) closeSheet();
    show = signedIn && !coversControls() && !sheet;
    btn.hidden = !show;
  }
  function formHtml(page) {
    return '<h2 id="fb-title">Send feedback</h2>' +
      '<p class="fb-page">Page · <span id="fb-page">' + esc(page) + '</span></p>' +
      '<label id="fb-type-label">TYPE</label>' +
      '<div class="seg" role="radiogroup" aria-labelledby="fb-type-label">' +
      '<button type="button" role="radio" aria-checked="false" data-fb-type="bug">Bug</button>' +
      '<button type="button" role="radio" aria-checked="false" data-fb-type="idea">Idea</button>' +
      '<button type="button" role="radio" aria-checked="false" data-fb-type="other">Other</button>' +
      '</div>' +
      '<label for="fb-message">MESSAGE</label>' +
      '<textarea id="fb-message" maxlength="2000" placeholder="What’s on your mind?"></textarea>' +
      '<button type="button" class="pri" id="fb-send" disabled>Send</button>';
  }
  function thanksHtml() {
    return '<div class="fb-thanks">' +
      '<div class="fb-check" aria-hidden="true"><svg viewBox="0 0 48 48" width="48" height="48" focusable="false"><circle cx="24" cy="24" r="24" fill="#16a34a"/><path d="M14 25 21 32 34 17" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<h2 id="fb-title">Thank you</h2>' +
      '<p>We’ve got your message.</p>' +
      '<button type="button" class="pri" id="fb-done">Done</button></div>';
  }
  function chosenType() {
    if (!sheet) return '';
    var on = sheet.querySelector('[data-fb-type][aria-checked="true"]');
    return on ? on.getAttribute('data-fb-type') : '';
  }
  function refreshSend() {
    if (!sheet) return;
    var send = document.getElementById('fb-send');
    var box = document.getElementById('fb-message');
    if (!send || !box) return;
    send.disabled = !canSend(chosenType(), box.value);
  }
  function closeSheet() {
    if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
    sheet = null;
    sync();
  }
  function openSheet() {
    if (!signedIn || coversControls() || typeof document === 'undefined') return;
    closeSheet();
    var page = pageName();
    sheet = document.createElement('div');
    sheet.className = 'fb-sheet';
    sheet.id = 'fb-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'fb-title');
    sheet.innerHTML = '<div class="fb-card" id="fb-card">' + formHtml(page) + '</div>';
    openHash = currentHash();
    document.body.appendChild(sheet);
    sync();
    var box = document.getElementById('fb-message');
    if (box) {
      try { box.focus(); } catch (e) {}
    }
  }
  function showThanks() {
    var card = document.getElementById('fb-card');
    if (!card) return;
    card.innerHTML = thanksHtml();
    var done = document.getElementById('fb-done');
    if (done) {
      try { done.focus(); } catch (e) {}
    }
  }
  function pickType(type) {
    if (!sheet) return;
    Array.prototype.forEach.call(sheet.querySelectorAll('[data-fb-type]'), function (btn) {
      var on = btn.getAttribute('data-fb-type') === type;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.classList.toggle('on', on);
    });
    refreshSend();
  }
  function submitSheet() {
    var auth = root.WBAuth;
    var box = document.getElementById('fb-message');
    var send = document.getElementById('fb-send');
    var pageEl = document.getElementById('fb-page');
    var type = chosenType();
    var message = box ? box.value : '';
    if (!canSend(type, message)) return;
    if (Date.now() - lastSent < GAP_MS) {
      toast('Please wait a moment before sending again.');
      return;
    }
    if (!auth || !auth.submitFeedback) {
      toast('Feedback is not ready yet. Apply the feedback SQL in the Supabase SQL editor.');
      return;
    }
    if (send) send.disabled = true;
    var page = pageEl ? clean(pageEl.textContent) : pageName();
    auth.submitFeedback(page, type, clean(message)).then(function () {
      lastSent = Date.now();
      showThanks();
    }, function (err) {
      refreshSend();
      toast((err && err.message) || 'Could not send feedback.');
    });
  }
  function onSheetClick(e) {
    if (!sheet) return;
    if (e.target === sheet) return closeSheet();
    var typeBtn = e.target.closest && e.target.closest('[data-fb-type]');
    if (typeBtn) return pickType(typeBtn.getAttribute('data-fb-type'));
    if (e.target.closest && e.target.closest('#fb-send')) return submitSheet();
    if (e.target.closest && e.target.closest('#fb-done')) return closeSheet();
  }
  function onKey(e) {
    if (!sheet) return;
    if (e.key === 'Escape') closeSheet();
  }
  function dayLabel(value, now) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!m) return '';
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var label = months[mo - 1] + ' ' + d;
    var year = now ? new Date(now).getFullYear() : new Date().getFullYear();
    if (y !== year) label += ', ' + y;
    return label;
  }
  function statusLabel(status) {
    if (status === 'replied') return 'REPLIED';
    if (status === 'fixed') return 'FIXED';
    return 'NEW';
  }
  function normalize(row) {
    row = row || {};
    return {
      id: row.id,
      userId: row.userId || row.user_id || '',
      name: safeName(row),
      page: row.page || '',
      type: row.type || '',
      message: row.message || '',
      status: row.status === 'replied' || row.status === 'fixed' ? row.status : 'new',
      createdAt: row.createdAt || row.created_at || ''
    };
  }
  function byNewest(list) {
    return list.slice().sort(function (a, b) {
      var ta = new Date(a.createdAt).getTime();
      var tb = new Date(b.createdAt).getTime();
      if (isNaN(ta)) ta = 0;
      if (isNaN(tb)) tb = 0;
      if (tb !== ta) return tb - ta;
      return String(b.id).localeCompare(String(a.id));
    });
  }
  function sectionShell() {
    return '<section id="feedback-section"><div class="sec">Feedback</div><div id="feedback-body"></div></section>';
  }
  function replyHtml(row) {
    if (openReply !== row.id) return '';
    var ready = clean(replyDraft).length > 0;
    return '<div class="fb-reply" id="fb-reply">' +
      '<div class="fb-reply-h">REPLY IN MESSAGES</div>' +
      '<p class="fb-to">To ' + esc(row.name) + '</p>' +
      '<textarea id="fb-reply-text" maxlength="2000" placeholder="Message">' + esc(replyDraft) + '</textarea>' +
      '<p class="fb-note">This is sent as a message in the app.</p>' +
      '<button type="button" class="pri" id="fb-reply-send"' + (ready ? '' : ' disabled') + '>Send</button>' +
      '</div>';
  }
  function cardHtml(row) {
    var meta = [row.page, typeLabel(row.type), dayLabel(row.createdAt)].filter(Boolean).join(' · ');
    return '<article class="card fb-entry" data-feedback="' + esc(row.id) + '">' +
      '<div class="fb-head">' +
      '<div class="name">' + esc(row.name) + '</div>' +
      '<select class="fb-pill is-' + esc(row.status) + '" data-fb-status="' + esc(row.id) + '" aria-label="Status">' +
      '<option value="new"' + (row.status === 'new' ? ' selected' : '') + '>NEW</option>' +
      '<option value="replied"' + (row.status === 'replied' ? ' selected' : '') + '>REPLIED</option>' +
      '<option value="fixed"' + (row.status === 'fixed' ? ' selected' : '') + '>FIXED</option>' +
      '</select></div>' +
      '<p class="mute fb-meta">' + esc(meta) + '</p>' +
      '<p class="fb-text">' + esc(row.message) + '</p>' +
      '<button type="button" class="sm" data-fb-reply="' + esc(row.id) + '">Reply</button>' +
      replyHtml(row) +
      '</article>';
  }
  function paintBody(html) {
    var body = typeof document !== 'undefined' ? document.getElementById('feedback-body') : null;
    if (body) body.innerHTML = html;
  }
  function renderRows(opts) {
    opts = opts || {};
    var current = typeof document !== 'undefined' ? document.getElementById('fb-reply-text') : null;
    if (current && openReply) replyDraft = current.value;
    if (!rows.length) {
      paintBody('');
      return;
    }
    paintBody(rows.map(cardHtml).join(''));
    var box = typeof document !== 'undefined' ? document.getElementById('fb-reply-text') : null;
    if (box && opts.focus) {
      try { box.focus(); } catch (e) {}
    }
  }
  function paint(next) {
    if (next == null) {
      rows = [];
      paintBody('<div class="card" id="feedback-wait"><div class="name">Not available yet</div><p class="mute">Feedback is not ready yet. Apply the feedback SQL in the Supabase SQL editor.</p></div>');
      return;
    }
    if (next && next.__err) {
      rows = [];
      var msg = (next.__err && next.__err.message) || 'Could not load feedback.';
      var unavailable = /not ready yet|not available yet/i.test(msg);
      if (unavailable) {
        paintBody('<div class="card" id="feedback-wait"><div class="name">Not available yet</div><p class="mute">' + esc(msg) + '</p></div>');
      } else {
        paintBody('<div class="errs" id="feedback-error">' + esc(msg) + '</div>');
      }
      return;
    }
    rows = byNewest((Array.isArray(next) ? next : []).map(normalize));
    renderRows();
  }
  function loadAdmin() {
    var auth = root.WBAuth;
    if (typeof document === 'undefined' || !document.getElementById('feedback-body')) return;
    if (!auth || !auth.feedbackList) return paint(null);
    paintBody('<p class="mute" id="feedback-loading">Loading…</p>');
    Promise.resolve().then(function () { return auth.feedbackList(); }).then(function (list) {
      if (!document.getElementById('feedback-body')) return;
      paint(list || []);
    }, function (err) {
      if (!document.getElementById('feedback-body')) return;
      paint({ __err: err });
    });
  }
  function rowById(id) {
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id) === String(id)) return rows[i];
    }
    return null;
  }
  function onAdminClick(e) {
    var reply = e.target.closest && e.target.closest('[data-fb-reply]');
    if (reply) {
      var id = reply.getAttribute('data-fb-reply');
      if (openReply === id) {
        openReply = '';
        replyDraft = '';
      } else {
        openReply = id;
        replyDraft = '';
      }
      renderRows({ focus: !!openReply });
      return true;
    }
    var send = e.target.closest && e.target.closest('#fb-reply-send');
    if (send) {
      sendReply();
      return true;
    }
    return false;
  }
  function onAdminChange(e) {
    var sel = e.target.closest && e.target.closest('[data-fb-status]');
    if (!sel) return false;
    var id = sel.getAttribute('data-fb-status');
    var status = sel.value;
    var row = rowById(id);
    var auth = root.WBAuth;
    if (!row || !auth || !auth.setFeedbackStatus) return true;
    if (status !== 'new' && status !== 'replied' && status !== 'fixed') return true;
    sel.disabled = true;
    auth.setFeedbackStatus(id, status).then(function () {
      row.status = status;
      renderRows();
    }, function (err) {
      sel.disabled = false;
      sel.value = row.status;
      toast((err && err.message) || 'Could not update that status.');
    });
    return true;
  }
  function onAdminInput(e) {
    if (!e.target || e.target.id !== 'fb-reply-text') return false;
    var send = document.getElementById('fb-reply-send');
    if (send) send.disabled = !clean(e.target.value);
    return true;
  }
  function sendReply() {
    var box = document.getElementById('fb-reply-text');
    var send = document.getElementById('fb-reply-send');
    var row = rowById(openReply);
    var text = box ? clean(box.value) : '';
    var auth = root.WBAuth;
    if (!row || !text) return;
    if (text.length > MAX) {
      toast('That message is too long.');
      return;
    }
    if (!auth || !auth.replyFeedback) {
      toast('Messages are not available yet. Apply the messages SQL in the Supabase SQL editor.');
      return;
    }
    if (send) send.disabled = true;
    auth.replyFeedback(row.userId, row.id, text).then(function () {
      row.status = 'replied';
      openReply = '';
      renderRows();
    }, function (err) {
      if (send) send.disabled = !text;
      toast((err && err.message) || 'Could not send that reply.');
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (e) {
      var open = e.target.closest && e.target.closest('#feedback-open');
      if (open) {
        e.preventDefault();
        openSheet();
        return;
      }
      if (sheet) onSheetClick(e);
    });
    document.addEventListener('input', function (e) {
      if (sheet && e.target && e.target.id === 'fb-message') refreshSend();
      onAdminInput(e);
    });
    document.addEventListener('keydown', onKey);
  }

  var api = {
    canSend: canSend,
    typeLabel: typeLabel,
    safeName: safeName,
    dayLabel: dayLabel,
    pageName: pageName,
    coversControls: coversControls,
    sync: sync,
    sectionShell: sectionShell,
    paint: paint,
    loadAdmin: loadAdmin,
    onAdminClick: onAdminClick,
    onAdminChange: onAdminChange,
    onAdminInput: onAdminInput
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBFeedback = api;
})(typeof window !== 'undefined' ? window : globalThis);
