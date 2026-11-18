/* Trainer Hub. Public to approved accounts. No network in the helpers. */
(function (root) {
  'use strict';

  var TITLE_MAX = 120;
  var POST_MAX = 4000;
  var REPLY_MAX = 2000;
  var ROLES = { 'Free Client': 1, Enthusiast: 1, Trainer: 1, 'Master Trainer': 1, Member: 1 };

  function clean(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function roleOf(value) {
    var role = clean(value);
    return ROLES[role] ? role : 'Member';
  }
  function publicName(name, role) {
    var text = clean(name);
    var label = roleOf(role);
    if (!text || text.indexOf('@') !== -1) {
      if (label === 'Free Client') return 'Client';
      if (label === 'Master Trainer') return 'Trainer';
      return label;
    }
    return text;
  }
  function authorOf(row) {
    row = row || {};
    var nested = row.author || {};
    return {
      name: publicName(nested.name != null ? nested.name : row.authorName, nested.role != null ? nested.role : row.authorRole),
      role: roleOf(nested.role != null ? nested.role : row.authorRole),
      verified: !!(nested.verified != null ? nested.verified : row.authorVerified)
    };
  }
  function validatePost(input) {
    input = input || {};
    var title = clean(input.title);
    var body = clean(input.body);
    if (!title) return { ok: false, message: 'Enter a title.' };
    if (title.length > TITLE_MAX) return { ok: false, message: 'That title is too long.' };
    if (!body) return { ok: false, message: 'Enter a post.' };
    if (body.length > POST_MAX) return { ok: false, message: 'That post is too long.' };
    return { ok: true, message: '', title: title, body: body };
  }
  function validateReply(input) {
    var body = clean(input && (input.body != null ? input.body : input));
    if (!body) return { ok: false, message: 'Enter a reply.' };
    if (body.length > REPLY_MAX) return { ok: false, message: 'That reply is too long.' };
    return { ok: true, message: '', body: body };
  }
  function previewText(body) {
    var text = clean(body).replace(/\s+/g, ' ');
    if (text.length > 140) return text.slice(0, 139) + '…';
    return text;
  }
  function timeValue(value) {
    var t = new Date(value).getTime();
    return isNaN(t) ? 0 : t;
  }
  function sortPosts(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var d = timeValue(b.activityAt || b.createdAt) - timeValue(a.activityAt || a.createdAt);
      if (d) return d;
      return String(b.id).localeCompare(String(a.id));
    });
  }
  function sortReplies(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var d = timeValue(a.createdAt) - timeValue(b.createdAt);
      if (d) return d;
      return String(a.id).localeCompare(String(b.id));
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
  function replyLabel(n) {
    n = Number(n) || 0;
    return n === 1 ? '1 reply' : (n + ' replies');
  }
  function nameHtml(author) {
    var name = author.name;
    if (root.WBProfile && root.WBProfile.nameHtml) return root.WBProfile.nameHtml(name, !!author.verified);
    return esc(name);
  }
  function badgeHtml(role) {
    var label = roleOf(role);
    return '<span class="tag" data-role="' + esc(label) + '">' + esc(label) + '</span>';
  }
  function bylineHtml(author) {
    return '<span class="hub-by"><span class="name">' + nameHtml(author) + '</span>' + badgeHtml(author.role) + '</span>';
  }
  function newId() {
    var c = (root && root.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    if (c && c.randomUUID) return c.randomUUID();
    var hex = '';
    for (var i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
  }
  function parts() {
    var raw = typeof location !== 'undefined' && location.hash ? location.hash : '';
    var bits = raw.replace(/^#\/?/, '').split('?')[0].split('/');
    bits = bits.map(function (bit) {
      try { return decodeURIComponent(bit); } catch (e) { return bit; }
    });
    return bits[0] === 'hub' ? bits : ['hub'];
  }
  function listHtml(rows) {
    var posts = sortPosts(rows);
    if (!posts.length) {
      return '<button type="button" class="pri" id="hub-new" style="width:100%;margin-bottom:12px">New post</button>' +
        '<div class="empty" id="hub-empty">No posts yet.</div>';
    }
    var h = '<button type="button" class="pri" id="hub-new" style="width:100%;margin-bottom:12px">New post</button><div id="hub-list">';
    posts.forEach(function (row) {
      var author = authorOf(row);
      h += '<button type="button" class="person" data-post="' + esc(row.id) + '">';
      h += '<span class="grow"><span class="row hub-line"><span class="name">' + esc(row.title || '') + '</span>';
      h += '<span class="mute hub-when">' + esc(whenLabel(row.activityAt || row.createdAt)) + '</span></span>';
      h += '<span class="preview">' + esc(previewText(row.body)) + '</span>';
      h += '<span class="hub-by">' + nameHtml(author) + badgeHtml(author.role);
      h += '<span class="mute">' + esc(replyLabel(row.replyCount)) + '</span></span></span></button>';
    });
    h += '</div>';
    return h;
  }
  function formHtml(post) {
    var editing = !!(post && post.id);
    var title = editing ? post.title : '';
    var body = editing ? post.body : '';
    var h = '<form id="hub-form" data-id="' + esc(editing ? post.id : '') + '">';
    h += '<label for="hub-title">Title</label>';
    h += '<input id="hub-title" maxlength="' + TITLE_MAX + '" autocomplete="off" value="' + esc(title) + '">';
    h += '<label for="hub-body">Post</label>';
    h += '<textarea id="hub-body" maxlength="' + POST_MAX + '" rows="8">' + esc(body) + '</textarea>';
    h += '<p class="errs" id="hub-error" hidden></p>';
    h += '<button type="button" class="pri" id="hub-save" style="width:100%;margin-top:12px">' + (editing ? 'Save' : 'Post') + '</button>';
    h += '</form>';
    return h;
  }
  function replyCardHtml(reply, editingId) {
    var author = authorOf(reply);
    var h = '<article class="card hub-reply" data-reply="' + esc(reply.id) + '">';
    h += '<div class="row" style="width:100%;margin:0">' + bylineHtml(author);
    h += '<span class="mute" style="margin-left:auto">' + esc(whenLabel(reply.createdAt)) + '</span></div>';
    if (editingId && editingId === reply.id) {
      h += '<label for="hub-reply-edit">Reply</label>';
      h += '<textarea id="hub-reply-edit" maxlength="' + REPLY_MAX + '" rows="4">' + esc(reply.body || '') + '</textarea>';
      h += '<p class="errs" id="hub-reply-error" hidden></p>';
      h += '<div class="actions"><button type="button" class="pri" data-reply-save="' + esc(reply.id) + '">Save</button>';
      h += '<button type="button" data-reply-cancel>Cancel</button></div>';
    } else {
      h += '<p class="hub-body">' + esc(reply.body || '') + '</p><div class="actions">';
      if (reply.mine) {
        h += '<button type="button" class="sm" data-reply-edit="' + esc(reply.id) + '">Edit</button>';
        h += '<button type="button" class="sm danger" data-reply-delete="' + esc(reply.id) + '">Delete</button>';
      } else if (reply.reported) {
        h += '<button type="button" class="sm" disabled>Reported</button>';
      } else {
        h += '<button type="button" class="sm" data-reply-report="' + esc(reply.id) + '">Report</button>';
      }
      h += '</div>';
    }
    h += '</article>';
    return h;
  }
  function postHtml(post, replies, editingId) {
    var author = authorOf(post);
    var h = '<article class="card" id="hub-post">';
    h += '<div class="row" style="width:100%;margin:0">' + bylineHtml(author);
    h += '<span class="mute" style="margin-left:auto">' + esc(whenLabel(post.createdAt)) + '</span></div>';
    h += '<h2 class="hub-title">' + esc(post.title || '') + '</h2>';
    h += '<p class="hub-body">' + esc(post.body || '') + '</p><div class="actions">';
    if (post.mine) {
      h += '<button type="button" class="sm" id="hub-edit">Edit</button>';
      h += '<button type="button" class="sm danger" id="hub-delete">Delete</button>';
    } else if (post.reported) {
      h += '<button type="button" class="sm" disabled>Reported</button>';
    } else {
      h += '<button type="button" class="sm" id="hub-report">Report</button>';
    }
    h += '</div></article>';
    h += '<h3 class="hub-replies-h">Replies</h3><div id="hub-replies">';
    var list = sortReplies(replies);
    if (!list.length) h += '<p class="mute" id="hub-no-replies">No replies yet.</p>';
    list.forEach(function (reply) { h += replyCardHtml(reply, editingId); });
    h += '</div>';
    h += '<div class="dock"><div class="inner composer">';
    h += '<textarea id="hub-reply" rows="2" maxlength="' + REPLY_MAX + '" placeholder="Write a reply"></textarea>';
    h += '<button type="button" class="pri" id="hub-reply-send">Reply</button>';
    h += '</div></div>';
    return h;
  }
  function reportCardsHtml(rows) {
    var list = rows || [];
    if (!list.length) return '<div class="empty" id="hub-reports-empty">No reports waiting.</div>';
    return list.map(function (row) {
      var author = authorOf({
        authorName: row.authorName != null ? row.authorName : (row.author && row.author.name),
        authorRole: row.authorRole != null ? row.authorRole : (row.author && row.author.role),
        authorVerified: row.authorVerified != null ? row.authorVerified : (row.author && row.author.verified)
      });
      var reporter = publicName(row.reporterName, 'Member');
      var kind = row.kind === 'reply' ? 'reply' : 'post';
      var h = '<article class="card" data-report="' + esc(row.id) + '">';
      h += '<div class="row" style="width:100%;margin:0">' + bylineHtml(author) + '</div>';
      h += '<p class="mute">' + (kind === 'reply' ? 'Reply' : 'Post') + ' · ' + esc(whenLabel(row.createdAt || row.created_at)) + '</p>';
      if (row.title) h += '<p class="hub-report-title">' + esc(row.title) + '</p>';
      h += '<p class="hub-body">' + esc(row.body || '') + '</p>';
      if (reporter) h += '<p class="mute">Reported by ' + esc(reporter) + '</p>';
      h += '<div class="actions">';
      h += '<button type="button" data-hub-report="view" data-post="' + esc(row.postId || row.post_id || '') + '">View</button>';
      h += '<button type="button" class="danger" data-hub-report="delete" data-id="' + esc(row.id) + '" data-kind="' + kind + '" data-post="' + esc(row.postId || row.post_id || '') + '" data-reply="' + esc(row.replyId || row.reply_id || '') + '">Delete</button>';
      h += '<button type="button" data-hub-report="dismiss" data-id="' + esc(row.id) + '">Dismiss</button>';
      h += '</div></article>';
      return h;
    }).join('');
  }

  var ctx = null, gen = 0, editingReply = '', replyDrafts = {}, postAttempt = null, replyAttempt = null, openCache = null;

  function ask(message) {
    if (root && typeof root.confirm === 'function') return root.confirm(message);
    return true;
  }
  function failMessage(err, fallback) {
    return (err && err.message) || fallback;
  }
  function showError(id, message) {
    var el = document.getElementById(id);
    if (!el) {
      if (ctx && ctx.toast) ctx.toast(message);
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }
  function stop() {
    gen += 1;
    editingReply = '';
    openCache = null;
    ctx = null;
  }
  function showUnavailable(err) {
    if (!ctx) return;
    ctx.titleEl.textContent = 'Trainer Hub';
    ctx.backBtn.hidden = false;
    var detail = failMessage(err, 'Trainer Hub is not available yet. Apply the hub SQL in the Supabase SQL editor.');
    ctx.app.innerHTML = '<div class="card" id="hub-wait"><div class="name">Not available yet</div><p class="mute">' + esc(detail) + '</p></div>';
    ctx.app.onclick = null;
  }
  function showFailure(err) {
    if (!ctx) return;
    var msg = failMessage(err, 'Could not load Trainer Hub.');
    if (/not available yet/i.test(msg)) return showUnavailable(err);
    ctx.titleEl.textContent = 'Trainer Hub';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = '<div class="errs" id="hub-error">' + esc(msg) + '</div>';
    ctx.app.onclick = null;
  }
  function showList(rows) {
    if (!ctx) return;
    editingReply = '';
    ctx.titleEl.textContent = 'Trainer Hub';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = listHtml(rows || []);
    ctx.app.onclick = onClick;
  }
  function showComposer(post) {
    if (!ctx) return;
    ctx.titleEl.textContent = post && post.id ? 'Edit post' : 'New post';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = formHtml(post);
    ctx.app.onclick = onClick;
    var form = document.getElementById('hub-form');
    if (form) form.onsubmit = function (e) { e.preventDefault(); savePost(); };
    var box = document.getElementById('hub-body');
    if (box) box.oninput = function () { postAttempt = null; };
  }
  function showThread(post, replies) {
    if (!ctx) return;
    openCache = { id: post.id, post: post, replies: replies || [] };
    ctx.titleEl.textContent = post.title || 'Post';
    ctx.backBtn.hidden = false;
    ctx.app.innerHTML = postHtml(post, replies || [], editingReply);
    ctx.app.onclick = onClick;
    var box = document.getElementById('hub-reply');
    if (box) {
      box.value = replyDrafts[post.id] || '';
      box.oninput = function () {
        replyDrafts[post.id] = box.value;
        replyAttempt = null;
      };
    }
  }
  function paintThread() {
    if (!openCache) return;
    var draft = '';
    var box = document.getElementById('hub-reply');
    if (box) draft = box.value;
    showThread(openCache.post, openCache.replies);
    var again = document.getElementById('hub-reply');
    if (again && openCache) {
      again.value = draft;
      replyDrafts[openCache.id] = draft;
    }
  }
  function loadList(myGen) {
    var auth = root.WBAuth;
    if (!ctx) return;
    if (!auth || !auth.hubPosts) return showUnavailable();
    ctx.titleEl.textContent = 'Trainer Hub';
    ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    Promise.resolve().then(function () { return auth.hubPosts(); }).then(function (rows) {
      if (!ctx || myGen !== gen || parts()[1]) return;
      showList(rows || []);
    }, function (err) {
      if (!ctx || myGen !== gen) return;
      showFailure(err);
    });
  }
  function loadPost(id, myGen, edit) {
    var auth = root.WBAuth;
    if (!ctx) return;
    if (!auth || !auth.hubPost) return showUnavailable();
    ctx.titleEl.textContent = edit ? 'Edit post' : 'Trainer Hub';
    ctx.app.innerHTML = '<p class="mute">Loading…</p>';
    Promise.resolve().then(function () { return auth.hubPost(id); }).then(function (data) {
      if (!ctx || myGen !== gen || parts()[1] !== id) return;
      var post = data && data.post;
      if (!post) return showFailure(new Error('That post is not available.'));
      if (edit) {
        if (!post.mine) {
          ctx.go('#/hub/' + id);
          return;
        }
        return showComposer(post);
      }
      showThread(post, (data && data.replies) || []);
    }, function (err) {
      if (!ctx || myGen !== gen) return;
      showFailure(err);
    });
  }
  function render() {
    var myGen = gen;
    var bits = parts();
    var id = bits[1] || '';
    if (!id) return loadList(myGen);
    if (id === 'new') return showComposer(null);
    if (bits[2] === 'edit') return loadPost(id, myGen, true);
    return loadPost(id, myGen, false);
  }
  function duplicate(err) {
    return !!(err && /duplicate key|already exists|23505/i.test(String(err.message || err.details || '')));
  }
  function savePost() {
    var form = document.getElementById('hub-form');
    var title = document.getElementById('hub-title');
    var body = document.getElementById('hub-body');
    var button = document.getElementById('hub-save');
    if (!form || !title || !body || !ctx) return;
    var existing = form.getAttribute('data-id') || '';
    var check = validatePost({ title: title.value, body: body.value });
    if (!check.ok) return showError('hub-error', check.message);
    var auth = root.WBAuth;
    if (!auth || !auth.hubSavePost) return showUnavailable();
    var id = existing;
    if (!existing) {
      if (!postAttempt || postAttempt.title !== check.title || postAttempt.body !== check.body) {
        postAttempt = { id: newId(), title: check.title, body: check.body };
      }
      id = postAttempt.id;
    }
    if (button) button.disabled = true;
    Promise.resolve().then(function () {
      return auth.hubSavePost({ id: id, title: check.title, body: check.body, existing: !!existing });
    }).then(function () {
      postAttempt = null;
      if (ctx) ctx.go('#/hub/' + id);
    }, function (err) {
      if (button) button.disabled = false;
      if (!existing && duplicate(err)) {
        postAttempt = null;
        if (ctx) ctx.go('#/hub/' + id);
        return;
      }
      showError('hub-error', failMessage(err, 'Could not save that post.'));
    });
  }
  function saveReply(postId, replyId) {
    var source = replyId ? document.getElementById('hub-reply-edit') : document.getElementById('hub-reply');
    var button = replyId ? document.querySelector('[data-reply-save]') : document.getElementById('hub-reply-send');
    if (!source || !ctx) return;
    var check = validateReply(source.value);
    if (!check.ok) {
      if (replyId) return showError('hub-reply-error', check.message);
      if (ctx.toast) ctx.toast(check.message);
      return;
    }
    var auth = root.WBAuth;
    if (!auth || !auth.hubSaveReply) return showUnavailable();
    var id = replyId;
    if (!replyId) {
      if (!replyAttempt || replyAttempt.postId !== postId || replyAttempt.body !== check.body) {
        replyAttempt = { id: newId(), postId: postId, body: check.body };
      }
      id = replyAttempt.id;
    }
    if (button) button.disabled = true;
    var myGen = gen;
    Promise.resolve().then(function () {
      return auth.hubSaveReply({ id: id, postId: postId, body: check.body, existing: !!replyId });
    }).then(function () {
      if (!replyId) {
        replyAttempt = null;
        replyDrafts[postId] = '';
      }
      editingReply = '';
      if (ctx && myGen === gen) loadPost(postId, myGen, false);
    }, function (err) {
      if (button) button.disabled = false;
      if (!replyId && duplicate(err)) {
        replyAttempt = null;
        replyDrafts[postId] = '';
        if (ctx && myGen === gen) loadPost(postId, myGen, false);
        return;
      }
      var message = failMessage(err, 'Could not save that reply.');
      if (replyId) showError('hub-reply-error', message);
      else if (ctx && ctx.toast) ctx.toast(message);
    });
  }
  function removePost(id) {
    if (!ask('Delete this post? This cannot be undone.')) return;
    var auth = root.WBAuth;
    if (!auth || !auth.hubDeletePost) return showUnavailable();
    Promise.resolve().then(function () { return auth.hubDeletePost(id); }).then(function () {
      if (ctx) ctx.go('#/hub');
    }, function (err) {
      if (ctx && ctx.toast) ctx.toast(failMessage(err, 'Could not delete that post.'));
    });
  }
  function removeReply(postId, replyId) {
    if (!ask('Delete this reply? This cannot be undone.')) return;
    var auth = root.WBAuth;
    if (!auth || !auth.hubDeleteReply) return showUnavailable();
    var myGen = gen;
    Promise.resolve().then(function () { return auth.hubDeleteReply(replyId); }).then(function () {
      if (ctx && myGen === gen) loadPost(postId, myGen, false);
    }, function (err) {
      if (ctx && ctx.toast) ctx.toast(failMessage(err, 'Could not delete that reply.'));
    });
  }
  function sendReport(postId, replyId) {
    var auth = root.WBAuth;
    if (!auth || !auth.hubReport) return showUnavailable();
    Promise.resolve().then(function () {
      return auth.hubReport({ postId: postId, replyId: replyId || null });
    }).then(function () {
      if (ctx && ctx.toast) ctx.toast('Reported.');
      var myGen = gen;
      if (ctx && openCache && openCache.id === postId) loadPost(postId, myGen, false);
    }, function (err) {
      if (ctx && ctx.toast) ctx.toast(failMessage(err, 'Could not report that.'));
    });
  }
  function onClick(e) {
    if (!ctx || !e.target || !e.target.closest) return;
    var t = e.target.closest('#hub-new, #hub-save, #hub-edit, #hub-delete, #hub-report, #hub-reply-send, [data-post], [data-reply-edit], [data-reply-save], [data-reply-cancel], [data-reply-delete], [data-reply-report]');
    if (!t) return;
    if (t.id === 'hub-new') return ctx.go('#/hub/new');
    if (t.id === 'hub-save') return savePost();
    var postId = (openCache && openCache.id) || parts()[1];
    if (t.id === 'hub-edit' && postId) return ctx.go('#/hub/' + postId + '/edit');
    if (t.id === 'hub-delete' && postId) return removePost(postId);
    if (t.id === 'hub-report' && postId) return sendReport(postId, null);
    if (t.id === 'hub-reply-send' && postId) return saveReply(postId, '');
    if (t.hasAttribute('data-post') && !t.getAttribute('data-hub-report')) {
      var id = t.getAttribute('data-post');
      if (id) ctx.go('#/hub/' + encodeURIComponent(id));
      return;
    }
    var editId = t.getAttribute('data-reply-edit');
    if (editId) {
      editingReply = editId;
      paintThread();
      var area = document.getElementById('hub-reply-edit');
      if (area) { try { area.focus(); } catch (err) {} }
      return;
    }
    if (t.hasAttribute('data-reply-cancel')) {
      editingReply = '';
      paintThread();
      return;
    }
    var saveId = t.getAttribute('data-reply-save');
    if (saveId && postId) return saveReply(postId, saveId);
    var dropId = t.getAttribute('data-reply-delete');
    if (dropId && postId) return removeReply(postId, dropId);
    var reportId = t.getAttribute('data-reply-report');
    if (reportId && postId) return sendReport(postId, reportId);
  }
  function mount(next) {
    stop();
    ctx = next || null;
    if (!ctx) return;
    ctx.backBtn.hidden = false;
    render();
  }

  var api = {
    TITLE_MAX: TITLE_MAX,
    POST_MAX: POST_MAX,
    REPLY_MAX: REPLY_MAX,
    clean: clean,
    esc: esc,
    roleOf: roleOf,
    publicName: publicName,
    authorOf: authorOf,
    validatePost: validatePost,
    validateReply: validateReply,
    previewText: previewText,
    sortPosts: sortPosts,
    sortReplies: sortReplies,
    listHtml: listHtml,
    formHtml: formHtml,
    postHtml: postHtml,
    reportCardsHtml: reportCardsHtml,
    mount: mount,
    stop: stop
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBHub = api;
})(typeof window !== 'undefined' ? window : globalThis);
