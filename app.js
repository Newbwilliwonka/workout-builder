/* Workout Builder UI (Stage 2). Hash routes: #/  |  #/w/<id>  |  #/w/<id>/ex/<exId or new> */
(function () {
  'use strict';
  var M = window.WB, app = document.getElementById('app'), titleEl = document.getElementById('title'), backBtn = document.getElementById('back');
  var data = M.load(localStorage), selected = {}, draft = null;

  function persist() { M.save(localStorage, data); scheduleCopySave(); scheduleSharePush(); }
  function persistLocal() { M.save(localStorage, data); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getW(id) { return data.workouts.filter(function (w) { return w.id === id; })[0]; }
  function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function go(h) { location.hash = h; }
  function hashBody() { return location.hash.replace(/^#\/?/, '').split('?')[0]; }
  function hashPage() { return hashBody().split('/')[0]; }
  backBtn.onclick = function () {
    var page = hashPage();
    if (page === 'signin' || page === 'join') return;
    var p = location.hash.split('/');
    if (p[1] === 'play') return WBPlayer.requestEnd();
    if (page === 'messages' && hashBody().split('/')[1]) return go('#/messages');
    if (page === 'send') return go('#/');
    if (page === 'received') return go(hashBody().split('/')[1] ? '#/received' : '#/account');
    if (page === 'client') return go('#/account');
    if (page === 'w') {
      var segs = hashBody().split('/');
      if (segs.length > 2) return go('#/w/' + segs[1]);
      var back = receivedBack(getW(segs[1]));
      if (back) return go(back);
    }
    go(p.length > 3 ? '#/w/' + p[2] : '#/');
  };

  function onAuthPage() { var p = hashPage(); return p === 'signin' || p === 'join'; }
  var INVITE_KEY = 'wb.invite', TRAINER_KEY = 'wb.trainer', pendingInviteNotice = null;
  function pendingCode() { try { return sessionStorage.getItem(INVITE_KEY) || ''; } catch (e) { return ''; } }
  function rememberCode(code) {
    try { if (code) sessionStorage.setItem(INVITE_KEY, code); else sessionStorage.removeItem(INVITE_KEY); } catch (e) {}
  }
  function captureInvite() {
    var code = '';
    try {
      code = new URLSearchParams(location.search).get('invite') || '';
      if (!code) code = new URLSearchParams(location.hash.split('?')[1] || '').get('invite') || '';
    } catch (e) {}
    if (code) rememberCode(WBInvites.normalizeCode(code));
  }
  function takeInviteNotice() { var n = pendingInviteNotice; pendingInviteNotice = null; return n; }
  function rememberTrainer(trainerId, clientId) {
    try {
      if (trainerId && clientId) localStorage.setItem(TRAINER_KEY, JSON.stringify({ trainerId: trainerId, clientId: clientId }));
      else localStorage.removeItem(TRAINER_KEY);
    } catch (e) {}
  }
  function rememberedTrainer() {
    try {
      var raw = localStorage.getItem(TRAINER_KEY) || '';
      if (!raw) return null;
      if (raw.charAt(0) !== '{') return { trainerId: raw, clientId: '' };
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function syncTrainerWorkouts(conn, clientId) {
    var prev = rememberedTrainer();
    if (conn && conn.trainerId) { rememberTrainer(conn.trainerId, clientId); return; }
    if (!prev || (clientId && prev.clientId && prev.clientId !== clientId)) return;
    data.workouts = WBInvites.withoutTrainerWorkouts(data.workouts, prev.trainerId);
    persist();
    rememberTrainer('');
  }
  // Temporary, until a payment processor exists. Not a subscription limit.
  var BUILDER_EMAILS = ['kinisiathletics@gmail.com', 'hempled@gmail.com'];
  function builderAllowed(session) {
    var email = session && session.user && session.user.email;
    return BUILDER_EMAILS.indexOf(String(email || '').trim().toLowerCase()) !== -1;
  }
  var routeToken = 0;
  var cachedProfile = null, applyingCopies = false, copyStamp = {}, copySaveGen = {}, removedCopies = [], pullToken = 0, profileLookup = 0;
  var shareState = window.WBSharing ? WBSharing.initialState() : null;
  var shareUser = '', shareLoadGen = 0, shareSaveGen = 0, linkShareChoice = true, pushFlight = null, pushDirty = false;
  var COPY_RETURN = 'wb.copyReturn';
  function setCopyReturn(hash) {
    try {
      if (hash) sessionStorage.setItem(COPY_RETURN, hash);
      else sessionStorage.removeItem(COPY_RETURN);
    } catch (e) {}
  }
  function receivedBack(w) {
    if (!w || !w.sourceTrainerId) return '';
    try { return sessionStorage.getItem(COPY_RETURN) || ''; } catch (e) { return ''; }
  }
  function copyLocked(w) {
    if (!w || !w.sourceTrainerId || !window.WBSends) return false;
    if (!cachedProfile) return true;
    return !WBSends.canEditCopy(cachedProfile, w);
  }
  function copyNote(w) {
    if (!w || !w.sourceTrainerId) return '';
    return '<span class="tag">From ' + esc(w.sourceTrainerEmail || 'your trainer') + '</span>' +
      '<p class="mute" id="copy-note">Copy from your trainer. Edits stay on this copy and do not change their workout.</p>';
  }
  function ensureProfile() {
    if (cachedProfile) return Promise.resolve(cachedProfile);
    if (!WBAuth.profile) return Promise.resolve(null);
    return WBAuth.profile().then(function (p) {
      if (p) cachedProfile = p;
      return cachedProfile;
    }, function () { return null; });
  }
  function copyBody(name, items) {
    try { return name + '\n' + JSON.stringify(items || []); } catch (e) { return null; }
  }
  function listSig(list) {
    return (list || []).map(function (w) {
      if (!w) return '';
      return [w.id, w.name, w.updatedAt || 0, w.sourceTrainerId || '', w.items ? w.items.length : 0].join('~');
    }).join('|');
  }
  function applyCopies(list) {
    if (!window.WBSends || !Array.isArray(list)) return;
    // No profile yet means we do not know. A newer local copy stays; a Free Client result is never invented.
    var canEdit = !cachedProfile || WBSends.canEditCopy(cachedProfile, { sourceTrainerId: '1' });
    applyingCopies = true;
    data.workouts = WBSends.mergeCopies(data.workouts, list, { canEdit: canEdit, removed: removedCopies });
    var serverBody = {};
    list.forEach(function (row) {
      if (!row || row.id == null) return;
      var body = copyBody(row.name, row.items);
      if (body != null) serverBody[String(row.id)] = body;
    });
    data.workouts.forEach(function (w) {
      if (!w || !w.sourceTrainerId) return;
      var body = copyBody(w.name, w.items);
      if (body == null) return;
      var server = serverBody[String(w.id)];
      // A local edit the server does not have yet stays pending so the next refresh can send it.
      if (server != null && server !== body) return;
      copyStamp[w.id] = body;
    });
    persistLocal();
    applyingCopies = false;
    scheduleCopySave();
  }
  function pullCopies() {
    if (!WBAuth.workoutCopies || !window.WBSends) return;
    var token = ++pullToken;
    var route = routeToken;
    var pending;
    try { pending = WBAuth.workoutCopies(); } catch (e) { return; }
    if (!pending || !pending.then) return;
    pending.then(function (list) {
      if (token !== pullToken || route !== routeToken) return;
      var incoming = Array.isArray(list) ? list : [];
      var need = incoming.length || data.workouts.some(function (w) { return w && w.sourceTrainerId; });
      var step = need ? ensureProfile() : Promise.resolve();
      step.then(function () {
        if (token !== pullToken || route !== routeToken) return;
        var before = listSig(data.workouts);
        applyCopies(incoming);
        if (listSig(data.workouts) !== before && hashPage() === '') renderList();
      });
    }, function () {});
  }
  function scheduleCopySave() {
    if (applyingCopies || !window.WBSends || !WBAuth.saveWorkoutCopy) return;
    var pending = data.workouts.some(function (w) { return w && w.sourceTrainerId && WBSends.serverId(w.id); });
    if (!pending) return;
    ensureProfile().then(function () {
      if (applyingCopies || !WBSends.canEditCopy(cachedProfile, { sourceTrainerId: '1' })) return;
      data.workouts.forEach(function (w) {
        if (!w || !w.sourceTrainerId || !WBSends.serverId(w.id)) return;
        var stamp = copyBody(w.name, w.items);
        if (stamp == null) return;
        if (copyStamp[w.id] === stamp) return;
        copyStamp[w.id] = stamp;
        var gen = (copySaveGen[w.id] = (copySaveGen[w.id] || 0) + 1);
        var id = w.id, name = w.name, items;
        try { items = JSON.parse(JSON.stringify(w.items || [])); } catch (e2) { return; }
        WBAuth.saveWorkoutCopy(id, name, items).then(function (row) {
          if (copySaveGen[id] !== gen) return;
          var current = getW(id);
          if (!current || !row || row.updatedAt == null) return;
          if (copyStamp[id] !== stamp) return;
          current.updatedAt = WBSends.stamp(row.updatedAt);
          applyingCopies = true;
          persistLocal();
          applyingCopies = false;
        }, function () {
          if (copySaveGen[id] === gen && copyStamp[id] === stamp) delete copyStamp[id];
          toast('Could not save that copy');
        });
      });
    });
  }
  function renderLocked(w) {
    titleEl.textContent = w.name;
    backBtn.hidden = false;
    app.innerHTML = window.WBSends ? WBSends.lockedHtml(w) : '<p class="mute" id="copy-note">You can run this copy.</p>';
    app.onclick = function (e) { if (e.target.closest('#copy-run')) go('#/play/' + w.id); };
    app.oninput = null;
    app.onchange = null;
  }
  var pendingSignNotice = null, authBusy = false, planBusy = false;
  function openAccount() {
    var from = hashPage();
    WBAuth.session().then(function (session) {
      if (hashPage() !== from) return;
      if (!session) return go('#/signin');
      WBAuth.profile().then(function (profile) {
        if (hashPage() !== from) return;
        go(WBMembership.hasDesignated(profile) ? '#/account' : '#/subscriptions');
      }).catch(function () { if (hashPage() === from) go('#/subscriptions'); });
    }).catch(function () { if (hashPage() === from) go('#/signin'); });
  }
  function afterSignIn() {
    if (!onAuthPage()) return;
    var pending;
    try { pending = WBAuth.session(); } catch (e) { return go('#/subscriptions'); }
    if (!pending || !pending.then) return go('#/subscriptions');
    pending.then(function (session) {
      if (!onAuthPage()) return;
      var dest = builderAllowed(session) ? '#/' : '#/subscriptions';
      var code = pendingCode();
      if (!code || !WBAuth.redeemInvite) return go(dest);
      WBAuth.redeemInvite(code).then(function (res) {
        if (!onAuthPage()) return;
        rememberCode('');
        pendingInviteNotice = { text: (res && res.message) || 'Invite applied.', isError: false };
        go(dest);
      }).catch(function (err) {
        if (!onAuthPage()) return;
        pendingInviteNotice = { text: (err && err.message) || 'Could not use that invite.', isError: true };
        go(dest);
      });
    }).catch(function () { if (onAuthPage()) go('#/subscriptions'); });
  }
  function showSignInNotice(text, isError) {
    var here = hashPage();
    if (here !== 'signin' && here !== 'join' && here !== 'subscriptions') return;
    pendingSignNotice = { text: text, isError: !!isError };
    if (here === 'signin') renderSign('in');
    else go('#/signin');
  }
  function renderSign(mode, message, isError) {
    var create = mode === 'up';
    if (create) pendingSignNotice = null;
    else if (message != null) pendingSignNotice = { text: message, isError: !!isError };
    if (!create && pendingSignNotice) { message = pendingSignNotice.text; isError = pendingSignNotice.isError; }
    titleEl.textContent = create ? 'Create account' : 'Sign in';
    backBtn.hidden = true;
    var h = '<div class="gate">';
    if (message) h += '<div class="' + (isError ? 'errs' : 'card') + '">' + esc(message) + '</div>';
    h += '<h2>' + (create ? 'Create your account' : 'Sign in') + '</h2>';
    h += '<p class="lede">Built for trainers and the people they coach.</p>';
    h += '<label for="acct-email">Email</label><input id="acct-email" type="email" autocomplete="username">';
    h += '<label for="acct-pass">Password</label><input id="acct-pass" type="password" autocomplete="' + (create ? 'new-password' : 'current-password') + '">';
    h += '<label for="invite-code">Invite code</label><input id="invite-code" autocomplete="off" value="' + esc(WBInvites.formatCode(pendingCode())) + '">';
    h += '<div class="actions"><button class="pri" data-auth="' + (create ? 'up' : 'in') + '" style="width:100%"' + (authBusy ? ' disabled' : '') + '>' + (create ? 'Create account' : 'Sign in') + '</button></div>';
    h += create
      ? '<button class="linkish" data-auth="switch" data-mode="in">Already have an account? Sign in</button>'
      : '<button class="linkish" data-auth="switch" data-mode="up">Create an account</button>';
    h += '</div>';
    app.innerHTML = h;
    app.onclick = function (e) {
      var b = e.target.closest('[data-auth]'); if (!b) return;
      if (b.dataset.auth === 'switch') {
        var dest = b.dataset.mode === 'up' ? '#/join' : '#/signin';
        if (location.hash === dest) return route();
        return go(dest);
      }
      if (authBusy) return;
      var emailEl = document.getElementById('acct-email'), passEl = document.getElementById('acct-pass'), codeEl = document.getElementById('invite-code');
      var email = emailEl ? emailEl.value.trim() : '', password = passEl ? passEl.value : '';
      rememberCode(WBInvites.normalizeCode(codeEl ? codeEl.value : ''));
      if (!email || password.length < 6) return renderSign(create ? 'up' : 'in', 'Enter your email and a password of at least 6 characters.', true);
      authBusy = true; b.disabled = true;
      var startedOn = hashPage();
      var op = b.dataset.auth === 'up' ? WBAuth.signUp(email, password) : WBAuth.signIn(email, password);
      op.then(function (result) {
        authBusy = false;
        if (hashPage() !== startedOn) return;
        if (b.dataset.auth === 'up' && result.needsConfirmation) return showSignInNotice('Check your email to confirm the account, then sign in.');
        afterSignIn();
      }).catch(function (err) {
        authBusy = false;
        if (hashPage() !== startedOn) return;
        renderSign(startedOn === 'join' ? 'up' : 'in', (err && err.message) || 'Could not reach sign-in', true);
      });
    };
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, function () { toast('Could not copy'); });
    } else toast('Could not copy');
  }
  function redeemCard(conn, profile) {
    var h = '<div class="card" id="redeem">';
    var linked = !!(conn && conn.trainerId);
    if (linked) {
      h += '<div class="name">Your trainer</div><p class="mute">' + esc(conn.trainerEmail || 'Connected') + '</p>';
      h += '<button class="danger" data-invite="end-self" style="width:100%">End connection</button>';
    }
    h += '<label for="invite-code">Invite code</label><input id="invite-code" autocomplete="off" value="' + esc(WBInvites.formatCode(pendingCode())) + '">';
    if (!linked && window.WBInvites && window.WBSharing && WBInvites.isEnthusiast(profile)) h += WBSharing.linkOption(linkShareChoice);
    h += '<button class="pri" data-invite="redeem" style="width:100%;margin-top:10px">Redeem invite</button></div>';
    return h;
  }
  function noteProfile(profile) {
    var id = profile && profile.id;
    if (shareUser && id && shareUser !== id && window.WBSharing) shareState = WBSharing.initialState();
    if (id) shareUser = id;
    if (profile) cachedProfile = profile;
  }
  function paintShare() {
    var slot = document.getElementById('share-slot');
    if (!slot || !window.WBSharing) return;
    slot.innerHTML = WBSharing.accountCard(shareState);
  }
  function loadShare() {
    if (!window.WBSharing) return;
    if (!WBAuth.shareSetting) {
      shareState = WBSharing.reduce(shareState, { type: 'load-unavailable' });
      paintShare();
      return;
    }
    var gen = ++shareLoadGen;
    var seenSave = shareSaveGen;
    shareState = WBSharing.reduce(shareState, { type: 'load-start' });
    paintShare();
    var pending;
    try { pending = WBAuth.shareSetting(); } catch (e) { pending = Promise.reject(e); }
    Promise.resolve(pending).then(function (row) {
      if (gen !== shareLoadGen || seenSave !== shareSaveGen) return;
      var parsed = WBSharing.parseSetting(row);
      shareState = WBSharing.reduce(shareState, { type: 'load-ok', on: parsed.ok ? parsed.on : null });
      paintShare();
      if (WBSharing.shouldPush(shareState)) scheduleSharePush();
    }, function (err) {
      if (gen !== shareLoadGen || seenSave !== shareSaveGen) return;
      shareState = WBSharing.reduce(shareState, WBSharing.isUnavailable(err)
        ? { type: 'load-unavailable', message: err && err.message }
        : { type: 'load-error', message: (err && err.message) || 'Could not load sharing.' });
      paintShare();
    });
  }
  function toggleShare() {
    if (!window.WBSharing || !shareState || shareState.busy || typeof shareState.confirmed !== 'boolean') return;
    var next = !shareState.confirmed;
    var started = WBSharing.reduce(shareState, { type: 'save-start' });
    if (!started.busy) return;
    var saveGen = ++shareSaveGen;
    shareLoadGen++;
    shareState = started;
    paintShare();
    function finishSave(apply) {
      if (saveGen !== shareSaveGen) return;
      shareSaveGen++;
      apply();
      paintShare();
    }
    var pending;
    try { pending = WBAuth.setShare(next); } catch (e) { pending = Promise.reject(e); }
    Promise.resolve(pending).then(function (row) {
      finishSave(function () {
        var parsed = WBSharing.parseSetting(row);
        shareState = WBSharing.reduce(shareState, { type: 'save-ok', on: parsed.ok ? parsed.on : null });
        if (!parsed.ok) toast('Could not confirm that choice.');
        else if (WBSharing.shouldPush(shareState)) scheduleSharePush();
      });
    }, function (err) {
      finishSave(function () {
        if (WBSharing.isUnavailable(err)) {
          shareState = WBSharing.reduce(shareState, { type: 'load-unavailable', message: err && err.message });
        } else {
          shareState = WBSharing.reduce(shareState, { type: 'save-fail', message: (err && err.message) || 'Could not save that choice.' });
          toast((err && err.message) || 'Could not save that choice.');
        }
      });
    });
  }
  function scheduleSharePush(force) {
    if (!window.WBSharing || !WBAuth.pushOwn) return;
    if (force === true && shareState && shareState.confirmed === true && shareState.phase === 'ready') {
      /* caller already confirmed this push */
    } else if (!WBSharing.shouldPush(shareState)) return;
    if (!(cachedProfile && window.WBInvites && WBInvites.isEnthusiast(cachedProfile))) return;
    if (pushFlight) { pushDirty = true; return; }
    var log = WBSharing.readLog(localStorage);
    var body = WBSharing.payload(data, log);
    if (!body) return;
    var run = Promise.resolve().then(function () { return WBAuth.pushOwn(body.workouts, body.sessions); });
    pushFlight = run.then(function () {
      pushFlight = null;
      if (pushDirty && WBSharing.shouldPush(shareState)) { pushDirty = false; scheduleSharePush(); }
      else pushDirty = false;
    }, function () {
      pushFlight = null;
      pushDirty = false;
    });
  }
  function capturePlayedSession() {
    try {
      var S = window.__wbPlayer;
      if (!S || !S.done || !window.WBSharing) return;
      if (WBSharing.rememberSession(localStorage, S.done, data.workouts) && WBSharing.shouldPush(shareState)) scheduleSharePush();
    } catch (e) {}
  }
  function trainerSection(roster) {
    if (!roster) return '';
    if (roster.error) return '<div class="errs">' + esc(roster.error) + '</div>';
    if (!roster.role) return '';
    var h = '<div class="card" id="invites"><div class="name">Invites</div>';
    h += '<p class="mute">' + roster.clientCount + ' of ' + roster.cap + ' clients</p>';
    h += '<button class="pri" data-invite="create" style="width:100%"' + (roster.canCreate ? '' : ' disabled') + '>Create invite</button>';
    if (!roster.invites.length) h += '<p class="mute">No open invites.</p>';
    roster.invites.forEach(function (inv) {
      var link = WBInvites.inviteLink(inv.code);
      h += '<div class="card" data-open-invite="' + esc(inv.code) + '"><div class="invite-code">' + esc(WBInvites.formatCode(inv.code)) + '</div>';
      h += '<p class="mute">' + esc(WBInvites.timeLeft(inv.expiresAt, Date.now())) + '</p>';
      h += '<p class="mute invite-code">' + esc(link) + '</p><div class="actions">';
      h += '<button class="sm" data-invite="copy-code" data-code="' + esc(inv.code) + '">Copy code</button>';
      h += '<button class="sm" data-invite="copy-link" data-link="' + esc(link) + '">Copy link</button>';
      h += '<button class="sm danger" data-invite="cancel" data-code="' + esc(inv.code) + '">Cancel</button></div></div>';
    });
    h += '<div class="name">Clients</div>';
    if (!roster.clients.length) h += '<p class="mute">No clients yet.</p>';
    roster.clients.forEach(function (c) {
      h += '<div class="row"><div class="grow"><b>' + esc(c.email || 'Client') + '</b><div class="mute">' + esc(c.plan) + '</div></div>';
      h += '<button class="sm" type="button" data-client-view="' + esc(c.id) + '">View</button>';
      h += '<button class="sm danger" data-invite="end" data-client="' + esc(c.id) + '">End connection</button></div>';
    });
    return h + '</div>';
  }
  function handleInvite(e, redraw) {
    var b = e.target.closest('[data-invite]');
    if (!b || b.disabled) return false;
    var a = b.dataset.invite;
    if (a === 'copy-code') { copyText(b.dataset.code); return true; }
    if (a === 'copy-link') { copyText(b.dataset.link); return true; }
    function fail(err) {
      pendingInviteNotice = { text: (err && err.message) || 'Could not use invites.', isError: true };
      redraw();
    }
    if (a === 'create') {
      b.disabled = true;
      WBAuth.createInvite().then(function () { redraw(); }).catch(fail);
      return true;
    }
    if (a === 'cancel') {
      WBAuth.cancelInvite(b.dataset.code).then(function () { redraw(); }).catch(fail);
      return true;
    }
    if (a === 'end' || a === 'end-self') {
      var clientId = a === 'end-self' ? null : b.dataset.client;
      WBAuth.endConnection(clientId).then(function (res) {
        if (res && res.trainerId && !clientId) {
          data.workouts = WBInvites.withoutTrainerWorkouts(data.workouts, res.trainerId);
          persist();
          rememberTrainer('');
        }
        pendingInviteNotice = { text: (res && res.message) || 'Connection ended.', isError: false };
        redraw();
      }).catch(fail);
      return true;
    }
    if (a === 'redeem') {
      var input = document.getElementById('invite-code');
      var code = WBInvites.normalizeCode(input ? input.value : '');
      rememberCode(code);
      if (!code) { pendingInviteNotice = { text: 'Enter an invite code.', isError: true }; redraw(); return true; }
      var shareBox = document.getElementById('share-link');
      var share = shareBox ? !!shareBox.checked : undefined;
      var redeem = shareBox ? WBAuth.redeemInvite(code, share) : WBAuth.redeemInvite(code);
      Promise.resolve(redeem).then(function (res) {
        rememberCode('');
        if (res && res.shareStored === true && typeof share === 'boolean' && window.WBSharing) {
          shareState = WBSharing.reduce(shareState, { type: 'redeemed', on: share });
          if (WBSharing.shouldPush(shareState)) scheduleSharePush(true);
        }
        pendingInviteNotice = { text: (res && res.message) || 'Invite applied.', isError: false };
        redraw();
      }).catch(fail);
      return true;
    }
    return false;
  }
  function renderSubscriptions(message, isError) {
    titleEl.textContent = 'Subscriptions'; backBtn.hidden = false;
    app.innerHTML = '<p class="mute">Loading…</p>';
    WBAuth.session().then(function (session) {
      if (hashPage() !== 'subscriptions') return;
      if (!session) return go('#/signin');
      WBAuth.profile().then(function (profile) {
        if (hashPage() !== 'subscriptions') return;
        var connP = WBAuth.myConnection ? WBAuth.myConnection() : Promise.resolve(null);
        connP.then(function (conn) {
          if (hashPage() !== 'subscriptions') return;
          syncTrainerWorkouts(conn, session.user && session.user.id);
          noteProfile(profile);
          drawSubscriptions(session, profile, message, isError, conn);
        }).catch(function () {
          if (hashPage() === 'subscriptions') drawSubscriptions(session, profile, message, isError, null);
        });
      }).catch(function () {
        if (hashPage() === 'subscriptions') drawSubscriptions(session, null, message || 'Signed in, but membership storage is not ready yet. Apply the profiles SQL in the Supabase SQL editor.', true);
      });
    }).catch(function (e) {
      if (hashPage() !== 'subscriptions') return;
      showSignInNotice((e && e.message) || 'Could not reach sign-in', true);
    });
  }
  function drawSubscriptions(session, profile, message, isError, conn) {
    var note = takeInviteNotice();
    var h = '<div class="sales">';
    if (note) h += '<div class="' + (note.isError ? 'errs' : 'card') + '">' + esc(note.text) + '</div>';
    if (message) h += '<div class="' + (isError ? 'errs' : 'card') + '">' + esc(message) + '</div>';
    h += '<button id="messages-nav" type="button" data-go="messages" style="width:100%;margin-bottom:12px">Messages</button>';
    if (!(window.WBInvites && profile && WBInvites.trainerRole(profile))) {
      h += '<button id="workouts-nav" type="button" data-go="received" style="width:100%;margin-bottom:12px">Workouts</button>';
    }
    h += '<h2>Choose how you want to train</h2>';
    h += '<p class="lede">Every plan is defined by what you can do, now and as the next features arrive.</p>';
    h += '<p class="note">Beta pricing for the first 100 members.</p>';
    h += redeemCard(conn, profile);
    WBMembership.TIERS.forEach(function (t) {
      h += '<article class="card plan' + (t.recommended ? ' recommended' : '') + '">';
      h += '<div class="row"><h3 class="grow">' + esc(t.name) + '</h3>' + (t.recommended ? '<span class="tag">Recommended</span>' : '') + '</div>';
      h += '<div class="price">' + esc(WBMembership.priceLine(t)) + '</div>';
      h += '<p class="value">' + esc(t.value) + '</p><ul>';
      t.available.forEach(function (line) { h += '<li>' + esc(line) + '</li>'; });
      h += '</ul><p class="soon">Coming soon</p><ul>';
      t.comingSoon.forEach(function (line) { h += '<li>' + esc(line) + '</li>'; });
      h += '</ul>';
      if (t.inviteOnly) h += '<p class="invite">' + esc(t.cta) + '</p>';
      else h += '<button class="pri" data-plan="' + t.id + '" style="width:100%;margin-top:16px">' + esc(t.cta) + '</button>';
      h += '</article>';
    });
    h += '<p class="foot">Choosing a plan saves your selection.</p></div>';
    app.innerHTML = h;
    app.onchange = function (e) {
      if (e.target && e.target.id === 'share-link') linkShareChoice = !!e.target.checked;
    };
    app.onclick = function (e) {
      var nav = e.target.closest('[data-go]');
      if (nav && nav.dataset.go === 'messages') return go('#/messages');
      if (nav && nav.dataset.go === 'received') return go('#/received');
      if (handleInvite(e, function () { renderSubscriptions(); })) return;
      if (e.target && e.target.id === 'share-link') linkShareChoice = !!e.target.checked;
      var b = e.target.closest('[data-plan]'); if (!b) return;
      if (planBusy || !WBMembership.canSelectIntended(b.dataset.plan)) return;
      planBusy = true; b.disabled = true;
      WBAuth.saveIntended(b.dataset.plan).then(function () {
        planBusy = false;
        if (hashPage() !== 'subscriptions') return;
        go('#/');
      }).catch(function (err) {
        planBusy = false;
        if (hashPage() !== 'subscriptions') return;
        drawSubscriptions(session, profile, (err && err.message) || 'Could not save that plan', true);
      });
    };
  }
  function renderSimpleAccount() {
    titleEl.textContent = 'Account'; backBtn.hidden = false;
    app.innerHTML = '<p class="mute">Loading account…</p>';
    WBAuth.session().then(function (session) {
      if (hashPage() !== 'account') return;
      if (!session) return go('#/signin');
      WBAuth.profile().then(function (profile) {
        if (hashPage() !== 'account') return;
        if (!WBMembership.hasDesignated(profile)) return go('#/subscriptions');
        var rosterP = WBAuth.roster ? WBAuth.roster() : Promise.resolve({ role: null });
        var connP = WBAuth.myConnection ? WBAuth.myConnection() : Promise.resolve(null);
        Promise.all([
          rosterP.then(function (v) { return v; }, function (err) { return { __err: err }; }),
          connP.then(function (v) { return v; }, function () { return null; })
        ]).then(function (pair) {
          if (hashPage() !== 'account') return;
          var roster = pair[0], conn = pair[1];
          if (roster && roster.__err) {
            roster = WBInvites.trainerRole(profile) ? { error: roster.__err.message || 'Invite storage is not ready yet. Apply the invite SQL in the Supabase SQL editor.' } : { role: null };
          }
          syncTrainerWorkouts(conn, session.user && session.user.id);
          noteProfile(profile);
          drawAccount(session, profile, roster, conn);
        });
      }).catch(function () { if (hashPage() === 'account') go('#/subscriptions'); });
    }).catch(function () { if (hashPage() === 'account') go('#/signin'); });
  }
  function drawAccount(session, profile, roster, conn) {
    var note = takeInviteNotice();
    var ent = WBMembership.entitlements(profile);
    var plan = ent.active ? ent.tier : WBMembership.tier(profile.intended_plan);
    var h = '<div class="gate">';
    if (note) h += '<div class="' + (note.isError ? 'errs' : 'card') + '">' + esc(note.text) + '</div>';
    h += '<div class="card"><div class="name">' + esc(session.user.email || 'Signed in') + '</div>' +
      '<p class="mute">' + esc(plan ? plan.name : 'Membership') + '</p>' +
      '<button data-auth="out" style="width:100%">Sign out</button></div>';
    var trainerNav = window.WBInvites && WBInvites.trainerRole(profile);
    h += '<div class="row" id="account-nav" style="margin-bottom:12px">' +
      '<button id="messages-nav" class="grow" type="button" data-go="messages">Messages</button>' +
      (trainerNav
        ? '<button id="send-nav" class="grow" type="button" data-go="send">Send workout</button>'
        : '<button id="workouts-nav" class="grow" type="button" data-go="received">Workouts</button>') +
      '</div>';
    if (conn && conn.trainerId) h += redeemCard(conn, profile);
    var shareHere = !!(window.WBInvites && window.WBSharing && WBInvites.isEnthusiast(profile) && conn && conn.trainerId);
    if (shareHere) h += '<div id="share-slot"></div>';
    h += trainerSection(roster);
    h += '</div>';
    app.innerHTML = h;
    if (shareHere) loadShare();
    app.onclick = function (e) {
      var nav = e.target.closest('[data-go]');
      if (nav && nav.dataset.go === 'messages') return go('#/messages');
      if (nav && nav.dataset.go === 'send') return go('#/send');
      if (nav && nav.dataset.go === 'received') return go('#/received');
      var viewBtn = e.target.closest('[data-client-view]');
      if (viewBtn) return go('#/client/' + viewBtn.getAttribute('data-client-view'));
      if (e.target.closest('#share-account')) { toggleShare(); return; }
      if (handleInvite(e, function () { renderSimpleAccount(); })) return;
      var b = e.target.closest('[data-auth]'); if (!b) return;
      WBAuth.signOut().then(function () {
        cachedProfile = null;
        copyStamp = {};
        removedCopies = [];
        shareUser = '';
        if (window.WBSharing) shareState = WBSharing.initialState();
        if (hashPage() !== 'account') return;
        go('#/signin');
      }).catch(function (err) {
        if (hashPage() !== 'account') return;
        app.insertAdjacentHTML('afterbegin', '<div class="errs">' + esc((err && err.message) || 'Could not sign out') + '</div>');
      });
    };
  }
  function showBuilder() {
    var p = location.hash.replace(/^#\/?/, '').split('/');
    var current = (p[0] === 'play' || p[0] === 'w') ? getW(p[1]) : null;
    if (current && current.sourceTrainerId && !cachedProfile && WBAuth.profile && profileLookup !== routeToken) {
      profileLookup = routeToken;
      var token = routeToken;
      WBAuth.profile().then(function (prof) {
        if (token !== routeToken) return;
        if (prof) cachedProfile = prof;
        showBuilder();
      }, function () {
        if (token !== routeToken) return;
        showBuilder();
      });
      return;
    }
    if (p[0] === 'play' && current && current.items.length) {
      titleEl.textContent = current.name; backBtn.hidden = false;
      return WBPlayer.mount(app, current, data, persist, function () { go('#/w/' + current.id); });
    }
    if (p[0] === 'w' && current) {
      if (copyLocked(current)) {
        if (p[2] === 'ex') return go('#/w/' + current.id);
        return renderLocked(current);
      }
      if (p[2] === 'ex') return renderEditor(current, p[3]);
      return renderWorkout(current);
    }
    renderList();
  }
  function openSends(token) {
    var requested = location.hash;
    backBtn.hidden = false;
    app.onclick = null; app.oninput = null; app.onchange = null;
    app.innerHTML = '<p class="mute">Loading…</p>';
    var pending;
    try { pending = WBAuth.session(); } catch (e) { return go('#/signin'); }
    if (!pending || !pending.then) return go('#/signin');
    pending.then(function (session) {
      if (token !== routeToken || location.hash !== requested) return;
      if (!session) return go('#/signin');
      var profileP = WBAuth.profile ? WBAuth.profile() : Promise.resolve(null);
      profileP.then(function (profile) { return profile; }, function () { return null; }).then(function (profile) {
        if (token !== routeToken || location.hash !== requested) return;
        cachedProfile = profile || cachedProfile;
        if (!window.WBSends) return;
        WBSends.mount({
          app: app, titleEl: titleEl, backBtn: backBtn, go: go, toast: toast,
          profile: function () { return cachedProfile; },
          workouts: function () { return data.workouts; },
          applyCopies: function (list) { applyCopies(list || []); }
        });
      });
    }).catch(function () {
      if (token !== routeToken || location.hash !== requested) return;
      go('#/signin');
    });
  }
  function openMessages(token) {
    var requested = location.hash;
    backBtn.hidden = false;
    app.onclick = null; app.oninput = null; app.onchange = null;
    app.innerHTML = '<p class="mute">Loading…</p>';
    var pending;
    try { pending = WBAuth.session(); } catch (e) { return go('#/signin'); }
    if (!pending || !pending.then) return go('#/signin');
    pending.then(function (session) {
      if (token !== routeToken || location.hash !== requested) return;
      if (!session) return go('#/signin');
      if (!window.WBMessages) return;
      WBMessages.mount({ app: app, titleEl: titleEl, backBtn: backBtn, go: go, toast: toast });
    }).catch(function () {
      if (token !== routeToken || location.hash !== requested) return;
      go('#/signin');
    });
  }
  function openClient(token) {
    var id = hashBody().split('/')[1] || '';
    var requested = location.hash;
    titleEl.textContent = 'Client';
    backBtn.hidden = false;
    app.onclick = null; app.oninput = null; app.onchange = null;
    app.innerHTML = '<p class="mute" id="client-loading">Loading…</p>';
    function showWait(err) {
      if (!window.WBSharing) return;
      app.innerHTML = WBSharing.unavailableHtml(err && err.message);
    }
    function showError(message) {
      if (!window.WBSharing) return;
      app.innerHTML = WBSharing.errorHtml(message);
    }
    var pending;
    try { pending = WBAuth.session(); } catch (e) { return go('#/signin'); }
    if (!pending || !pending.then) return go('#/signin');
    pending.then(function (session) {
      if (token !== routeToken || location.hash !== requested) return;
      if (!session) return go('#/signin');
      if (!id || !WBAuth.clientStatus || !window.WBSharing) return showWait();
      return WBAuth.clientStatus(id).then(function (row) {
        if (token !== routeToken || location.hash !== requested) return;
        var status = WBSharing.parseStatus(row);
        if (!status.ok) return showError('Could not load this client.');
        titleEl.textContent = status.email || 'Client';
        if (!status.shared) {
          app.innerHTML = WBSharing.clientHtml(status, null, null);
          return;
        }
        return Promise.all([
          WBAuth.clientWorkouts(id),
          WBAuth.clientSessions(id)
        ]).then(function (pair) {
          if (token !== routeToken || location.hash !== requested) return;
          if (!Array.isArray(pair[0]) || !Array.isArray(pair[1])) return showError('Could not load workouts.');
          app.innerHTML = WBSharing.clientHtml(status, pair[0], pair[1]);
        }, function (err) {
          if (token !== routeToken || location.hash !== requested) return;
          if (WBSharing.isUnavailable(err)) return showWait(err);
          showError((err && err.message) || 'Could not load workouts.');
        });
      }, function (err) {
        if (token !== routeToken || location.hash !== requested) return;
        if (WBSharing.isUnavailable(err)) return showWait(err);
        showError((err && err.message) || 'Could not load this client.');
      });
    }).catch(function () {
      if (token !== routeToken || location.hash !== requested) return;
      go('#/signin');
    });
  }
  function route() {
    capturePlayedSession();
    var token = ++routeToken;
    window.WBPlayer && WBPlayer.unmount();
    window.WBMessages && WBMessages.stop();
    window.WBSends && WBSends.stop();
    document.body.classList.remove('playing');
    var page = hashPage();
    if (page === 'signin') return renderSign('in');
    if (page === 'join') return renderSign('up');
    if (page === 'subscriptions') return renderSubscriptions();
    if (page === 'account') return renderSimpleAccount();
    if (page === 'messages') return openMessages(token);
    if (page === 'client') return openClient(token);
    if (page === 'send' || page === 'received') return openSends(token);
    var requested = location.hash;
    app.innerHTML = '';
    app.onclick = null; app.oninput = null; app.onchange = null;
    var pending;
    try { pending = WBAuth.session(); } catch (e) { return go('#/signin'); }
    if (!pending || !pending.then) return go('#/signin');
    pending.then(function (session) {
      if (token !== routeToken || location.hash !== requested) return;
      if (!session) return go('#/signin');
      if (builderAllowed(session)) return showBuilder();
      var receivedId = hashBody().split('/')[1];
      var received = (page === 'play' || page === 'w') ? getW(receivedId) : null;
      if (received && received.sourceTrainerId) return showBuilder();
      go('#/subscriptions');
    }).catch(function () {
      if (token !== routeToken || location.hash !== requested) return;
      go('#/signin');
    });
  }
  function releasePendingImage() {
    if (!draft || !draft.pendingUrl) return;
    try { URL.revokeObjectURL(draft.pendingUrl); } catch (e) {}
    draft.pendingUrl = '';
  }
  window.addEventListener('hashchange', function () {
    releasePendingImage();
    draft = null;
    if (hashPage() !== 'signin') pendingSignNotice = null;
    route();
    window.scrollTo(0, 0);
  });

  // ---------- Workout list ----------
  function renderList() {
    titleEl.textContent = 'Workouts'; backBtn.hidden = true;
    var note = takeInviteNotice();
    var h = (note ? '<div class="' + (note.isError ? 'errs' : 'card') + '">' + esc(note.text) + '</div>' : '') +
      '<button style="width:100%;margin-bottom:8px" data-a="account">Account</button>' +
      '<div class="row" style="margin-bottom:8px">' +
      '<button id="messages-nav" class="grow" type="button" data-a="messages">Messages</button>' +
      '<button id="send-nav" class="grow" type="button" data-a="send">Send workout</button></div>' +
      '<button class="pri" style="width:100%;margin-bottom:12px" data-a="new">+ New workout</button>';
    if (!data.workouts.length) h += '<div class="empty">No workouts yet.<br>Tap “New workout” to build one.</div>';
    data.workouts.forEach(function (w, wi) {
      var n = w.items.length, nW = data.workouts.length;
      var locked = copyLocked(w);
      h += '<div class="card">';
      if (w.sourceTrainerId) h += '<span class="tag" style="margin-bottom:6px">From ' + esc(w.sourceTrainerEmail || 'your trainer') + '</span>';
      h += '<div class="name" data-a="open" data-id="' + w.id + '" style="cursor:pointer">' + esc(w.name) + '</div>' +
        '<div class="mute">' + n + ' exercise' + (n === 1 ? '' : 's') +
        (w.sourceTrainerId ? (locked ? ' · You can run it' : ' · You can edit it') : '') + '</div><div class="actions">';
      if (!locked) {
        h += '<button class="sm" data-a="wup" data-id="' + w.id + '" aria-label="Move up"' + (wi === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button class="sm" data-a="wdown" data-id="' + w.id + '" aria-label="Move down"' + (wi === nW - 1 ? ' disabled' : '') + '>▼</button>';
      }
      h += '<button class="pri sm" data-a="open" data-id="' + w.id + '">Open</button>' +
        '<button class="sm" data-a="run" data-id="' + w.id + '"' + (n ? '' : ' disabled') + '>Run</button>';
      if (!locked) {
        h += '<button class="sm" data-a="rename" data-id="' + w.id + '">Rename</button>' +
          '<button class="sm" data-a="dup" data-id="' + w.id + '">Duplicate</button>' +
          '<button class="sm danger" data-a="del" data-id="' + w.id + '">Delete</button>';
      }
      h += '</div></div>';
    });
    app.innerHTML = h;
    if (data.workouts.some(function (w) { return w && w.sourceTrainerId; }) && !cachedProfile) {
      var paint = routeToken;
      ensureProfile().then(function () {
        if (paint !== routeToken || hashPage() !== '' || !cachedProfile) return;
        renderList();
      });
    }
    pullCopies();
    app.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.dataset.a, w = getW(b.dataset.id);
      if (a === 'account') return openAccount();
      if (a === 'messages') return go('#/messages');
      if (a === 'send') return go('#/send');
      if (a === 'new') {
        var name = prompt('Workout name', 'New workout'); if (name === null) return;
        var nw = M.newWorkout(name.trim() || 'New workout'); data.workouts.unshift(nw); persist(); go('#/w/' + nw.id);
      } else if (a === 'open') { setCopyReturn(''); go('#/w/' + w.id); }
      else if (a === 'run') { if (w.items.length) { setCopyReturn(''); go('#/play/' + w.id); } }
      else if (a === 'rename') { var r = prompt('Rename workout', w.name); if (r && r.trim()) { w.name = r.trim(); w.updatedAt = Date.now(); persist(); renderList(); } }
      else if (a === 'dup') {
        var c = M.duplicateWorkout(w);
        var copies = c.imageCopies ? c.imageCopies.slice() : [];
        if (c.imageCopies) delete c.imageCopies;
        var finishDup = function () {
          var i = data.workouts.indexOf(w);
          if (i < 0) return false;
          data.workouts.splice(i + 1, 0, c);
          persist();
          if (!hashPage()) renderList();
          toast('Duplicated');
          return true;
        };
        if (!copies.length) { finishDup(); return; }
        if (!window.WBMedia) { toast('Could not copy the images on this device'); return; }
        var chain = Promise.resolve();
        copies.forEach(function (pair) {
          chain = chain.then(function () { return WBMedia.copy(pair.from, pair.to); });
        });
        chain.then(function () {
          if (!finishDup()) copies.forEach(function (pair) { WBMedia.remove(pair.to); });
        }).catch(function () {
          copies.forEach(function (pair) { WBMedia.remove(pair.to); });
          toast('Could not copy the images on this device');
        });
      }
      else if (a === 'del') {
        if (confirm('Delete “' + w.name + '”? This cannot be undone.')) {
          var dropKeys = [];
          (w.items || []).forEach(function (it) {
            var gone = M.cleanMedia(it.media);
            if (gone && gone.kind === 'custom' && dropKeys.indexOf(gone.imageKey) < 0) dropKeys.push(gone.imageKey);
          });
          if (w.sourceTrainerId) {
            removedCopies.push(w.id);
            delete copyStamp[w.id];
            if (WBAuth.deleteWorkoutCopy && !copyLocked(w)) {
              WBAuth.deleteWorkoutCopy(w.id).catch(function () { toast('Could not remove that copy'); });
            }
          }
          data.workouts.splice(data.workouts.indexOf(w), 1);
          dropKeys.forEach(function (key) {
            if (!customKeyInUse(key) && window.WBMedia) WBMedia.remove(key);
          });
          persist();
          renderList();
          toast('Deleted');
        }
      }
      else if (a === 'wup' || a === 'wdown') {
        var i = data.workouts.indexOf(w), j = i + (a === 'wup' ? -1 : 1);
        if (j >= 0 && j < data.workouts.length) { var t = data.workouts[i]; data.workouts[i] = data.workouts[j]; data.workouts[j] = t; persist(); renderList(); }
      }
    };
  }

  // ---------- Workout detail ----------
  function exCard(w, it, i, n, inGroup) {
    return '<div class="card"><div class="row">' +
      '<input type="checkbox" class="sel" data-sel="' + it.id + '"' + (selected[it.id] ? ' checked' : '') + ' aria-label="Select for superset">' +
      '<div class="grow"><div class="name">' + esc(it.name) + '</div><div class="mute">' + esc(M.summarize(it)) + '</div>' +
      (it.notes ? '<div class="mute" style="font-style:italic">' + esc(it.notes) + '</div>' : '') + '</div></div>' +
      '<div class="actions">' +
      '<button class="sm" data-a="up" data-id="' + it.id + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
      '<button class="sm" data-a="down" data-id="' + it.id + '" aria-label="Move down"' + (i === n - 1 ? ' disabled' : '') + '>▼</button>' +
      '<button class="sm" data-a="edit" data-id="' + it.id + '">Edit</button>' +
      (inGroup ? '<button class="sm" data-a="unlink1" data-id="' + it.id + '">Unlink</button>' : '') +
      '<button class="sm danger" data-a="delex" data-id="' + it.id + '">Delete</button></div></div>';
  }
  function renderWorkout(w) {
    titleEl.textContent = w.name; backBtn.hidden = false;
    Object.keys(selected).forEach(function (k) { if (!w.items.some(function (x) { return x.id === k; })) delete selected[k]; });
    var bl = M.blocks(w), h = copyNote(w), chain = '<svg class="chain-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M17 7h-4v2h4a3 3 0 010 6h-4v2h4a5 5 0 000-10zm-6 8H7a3 3 0 010-6h4V7H7a5 5 0 000 10h4v-2zm-3-4h8v2H8v-2z"/></svg>';
    if (!w.items.length) h += '<div class="empty">No exercises yet.<br>Tap “+ Exercise” below.</div>';
    else h += '<p class="mute">Tick 2 or more exercises, then tap “Link superset”.</p>';
    bl.forEach(function (b, bi) {
      if (b.groupId) {
        h += '<div class="ss"><div class="ss-head"><span class="grow">' + chain + ' Superset · ' + b.items.length + ' exercises</span>' +
          '<button class="sm" data-a="gup" data-g="' + b.groupId + '"' + (bi === 0 ? ' disabled' : '') + ' aria-label="Move superset up">▲</button>' +
          '<button class="sm" data-a="gdown" data-g="' + b.groupId + '"' + (bi === bl.length - 1 ? ' disabled' : '') + ' aria-label="Move superset down">▼</button>' +
          '<button class="sm" data-a="unlink" data-g="' + b.groupId + '">Unlink all</button></div>';
        b.items.forEach(function (it, i) {
          if (i) h += '<div class="ss-chain" aria-hidden="true">' + chain + '</div>';
          h += exCard(w, it, i, b.items.length, true);
        });
        h += '</div>';
      } else h += exCard(w, b.items[0], bi, bl.length, false);
    });
    var nSel = Object.keys(selected).length;
    h += '<div class="dock"><div class="inner">' +
      '<button class="pri" data-a="add">+ Exercise</button>' +
      '<button data-a="link"' + (nSel < 2 ? ' disabled' : '') + ' style="background:var(--ss);color:#fff">Link superset' + (nSel ? ' (' + nSel + ')' : '') + '</button>' +
      '<button data-a="play" class="pri" style="background:#059669"' + (w.items.length ? '' : ' disabled') + '>▶ Start</button></div></div>';
    app.innerHTML = h;
    app.onchange = function (e) { var id = e.target.dataset.sel; if (!id) return; if (e.target.checked) selected[id] = 1; else delete selected[id]; renderWorkout(w); };
    app.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
      var a = b.dataset.a, id = b.dataset.id, g = b.dataset.g;
      if (a === 'add') return go('#/w/' + w.id + '/ex/new');
      if (a === 'play') return go('#/play/' + w.id);
      if (a === 'edit') return go('#/w/' + w.id + '/ex/' + id);
      if (a === 'up' || a === 'down') M.moveExercise(w, id, a === 'up' ? -1 : 1);
      else if (a === 'gup' || a === 'gdown') M.moveGroup(w, g, a === 'gup' ? -1 : 1);
      else if (a === 'unlink') { M.unlinkGroup(w, g); toast('Superset unlinked'); }
      else if (a === 'unlink1') M.unlinkExercise(w, id);
      else if (a === 'link') {
        var ids = Object.keys(selected);
        M.linkSuperset(w, ids); selected = {}; toast('Superset linked — only the final rest period will function in each set');
      }
      else if (a === 'delex') {
        var ex = w.items.filter(function (x) { return x.id === id; })[0]; if (!confirm('Delete “' + ex.name + '”?')) return;
        var gone = M.cleanMedia(ex.media);
        M.deleteExercise(w, id); delete selected[id];
        if (gone && gone.kind === 'custom' && !customKeyInUse(gone.imageKey, id) && window.WBMedia) WBMedia.remove(gone.imageKey);
      }
      persist(); renderWorkout(w);
    };
  }

  // ---------- Exercise editor ----------
  // Draft holds raw input strings + a config per mode, so switching mode/type keeps what was typed.
  function makeDraft(ex) {
    var media = M.cleanMedia(ex.media);
    var d = { id: ex.id, name: ex.name, sets: String(ex.sets), unit: ex.weight.unit, wval: ex.weight.value == null ? '' : String(ex.weight.value),
      mode: ex.mode, notes: ex.notes, groupId: ex.groupId, media: media, cfg: {},
      source: media && media.kind === 'library' ? 'library' : 'custom',
      libraryId: media && media.kind === 'library' ? media.libraryId : '',
      view: media && media.kind === 'library' ? media.view : '180',
      imageKey: media && media.kind === 'custom' ? media.imageKey : '',
      pendingBlob: null, pendingUrl: '', clearImage: false, savedMedia: media,
      libQuery: '', libBody: '', libEquip: '', libTarget: '', libRows: [], libMore: false, libStatus: '', libError: false, libCollapsed: false };
    M.MODES.forEach(function (m) { d.cfg[m] = M.defaultModeConfig(m); });
    Object.assign(d.cfg[ex.mode], ex.modeConfig);
    ['reps', 'intervals', 'timer'].forEach(function (m) { var x = d.cfg[m]; ['count', 'min', 'max'].forEach(function (k) { x[k] = x[k] == null ? '' : String(x[k]); }); });
    var r = d.cfg.reps; if (r.repsType === 'static') r.repsType = 'number';
    r.restSec = r.restSec || 0; r.rm = String(Math.floor(r.restSec / 60)); r.rs = String(r.restSec % 60);
    d.cfg.stopwatch.lapCount = String(d.cfg.stopwatch.lapCount || 1);
    ['intervals', 'timer'].forEach(function (m) {
      var c = d.cfg[m];
      c.wm = String(Math.floor(c.workSec / 60)); c.ws = String(c.workSec % 60);
      if (m === 'timer') { c.rm = String(Math.floor(c.restSec / 60)); c.rs = String(c.restSec % 60); }
    });
    return d;
  }
  function seg(key, opts, cur) {
    return '<div class="seg">' + opts.map(function (o) { return '<button type="button" data-seg="' + key + '" data-v="' + o[0] + '" class="' + (o[0] === cur ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>';
  }
  function numIn(bind, val, ph, step) { return '<input type="number" inputmode="' + (step ? 'decimal' : 'numeric') + '" min="0" step="' + (step || 1) + '" data-b="' + bind + '" value="' + esc(val) + '" placeholder="' + (ph || '') + '">'; }
  function timeIn(prefix, c, mk, sk, dis) {
    var d = dis ? ' disabled' : '', off = dis ? ' is-off' : '';
    return '<div class="time' + off + '">' +
      '<input type="number" inputmode="numeric" min="0" step="1" data-b="' + prefix + '.' + mk + '" value="' + esc(c[mk]) + '" placeholder="min"' + d + '><span>:</span>' +
      '<input type="number" inputmode="numeric" min="0" max="59" data-b="' + prefix + '.' + sk + '" value="' + esc(c[sk]) + '" placeholder="sec"' + d + '><span class="mute" style="font-size:14px;font-weight:400">mm:ss</span></div>';
  }
  function lapQuantity(v) {
    var n = M.num(v);
    return Number.isInteger(n) && n >= 1 ? n : 0;
  }
  function ensureEventDraft(c) {
    if (!c.eventDraft) {
      c.eventDraft = [];
      (c.events || []).forEach(function (ev) {
        if (!ev || !(ev.lap >= 1)) return;
        c.eventDraft[ev.lap - 1] = { on: true, name: ev.name || '' };
      });
    }
    var n = lapQuantity(c.lapCount);
    for (var i = 0; i < n; i++) if (!c.eventDraft[i]) c.eventDraft[i] = { on: false, name: '' };
    return c.eventDraft;
  }
  function lapEventsHtml(c) {
    var n = lapQuantity(c.lapCount);
    if (!n) return '';
    var rows = ensureEventDraft(c), h = '';
    for (var i = 0; i < n; i++) {
      var row = rows[i];
      h += '<div class="lap-ev"><div class="row" style="margin-top:10px"><span class="grow" style="font-weight:600">Lap ' + (i + 1) + '</span>' +
        '<label class="row" style="font-weight:400;margin:0"><input type="checkbox" class="sel" data-lev="' + i + '"' + (row.on ? ' checked' : '') + '> Event</label></div>';
      if (row.on) h += '<input data-lename="' + i + '" value="' + esc(row.name) + '" placeholder="Event name" autocomplete="off">';
      h += '</div>';
    }
    return h;
  }
  var libToken = 0, libFilters = { bodyParts: [], equipment: [], targets: [] }, libFiltersLoaded = false;
  var PHOTO_LIMIT = 5 * 1024 * 1024;
  function gifBase() { return (window.WBAuth && WBAuth.gifBase) || ''; }
  function customKeyInUse(key, exceptId) {
    if (!key) return false;
    return data.workouts.some(function (w) {
      return (w.items || []).some(function (it) {
        if (exceptId && it.id === exceptId) return false;
        var m = M.cleanMedia(it.media);
        return m && m.kind === 'custom' && m.imageKey === key;
      });
    });
  }
  function filterSelect(id, label, value, options) {
    var h = '<select id="' + id + '" aria-label="' + esc(label) + '"><option value="">' + esc(label) + '</option>';
    (options || []).forEach(function (o) {
      h += '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>';
    });
    return h + '</select>';
  }
  function libMeta(row) { return [row.body_part, row.equipment, row.target].filter(Boolean).join(' · '); }
  function resultsHtml(d) {
    // A pick hides the list. It stays hidden through filter changes and re-renders
    // until the search text itself changes, then the usual search output comes back.
    if (d.libCollapsed) return '';
    if (d.libStatus) return '<p class="' + (d.libError ? 'errs' : 'mute') + '">' + esc(d.libStatus) + '</p>';
    var q = String(d.libQuery || '').trim();
    var filtered = d.libBody || d.libEquip || d.libTarget;
    if (q.length < 2 && !filtered) return '<p class="mute">Type at least 2 letters, or choose a filter.</p>';
    if (!d.libRows || !d.libRows.length) return '<p class="mute">No exercises match that search.</p>';
    var h = d.libRows.map(function (row) {
      var on = row.id === d.libraryId ? ' on' : '';
      return '<button type="button" class="lib-hit' + on + '" data-a="pick" data-id="' + esc(row.id) + '" data-name="' + esc(row.name) + '"><span class="name">' + esc(row.name) + '</span>' +
        (libMeta(row) ? '<span class="mute">' + esc(libMeta(row)) + '</span>' : '') + '</button>';
    }).join('');
    if (d.libMore && !d.libBusy) h += '<button type="button" data-a="libmore">More</button>';
    return h;
  }
  function paintLib() {
    var box = document.getElementById('lib-results');
    if (box && draft) box.innerHTML = resultsHtml(draft);
  }
  function scheduleLibSearch(append, immediate) {
    clearTimeout(scheduleLibSearch.t);
    var token = ++libToken;
    scheduleLibSearch.t = setTimeout(function () { runLibSearch(token, !!append); }, (append || immediate) ? 0 : 280);
  }
  // Leaving or returning to the library must drop a search that is waiting or in flight, then start a fresh one.
  function onLibrarySourceChange() {
    if (!draft) return;
    draft.libError = false;
    draft.libBusy = false;
    draft.libMore = false;
    if (draft.source !== 'library') {
      clearTimeout(scheduleLibSearch.t);
      libToken++;
      draft.libStatus = '';
      return;
    }
    var q = String(draft.libQuery || '').trim();
    var filtered = draft.libBody || draft.libEquip || draft.libTarget;
    if (q.length >= 2 || filtered) {
      draft.libRows = [];
      draft.libStatus = 'Searching\u2026';
    } else {
      draft.libRows = [];
      draft.libStatus = '';
    }
    scheduleLibSearch(false, true);
  }
  function runLibSearch(token, append) {
    var d = draft;
    if (token !== libToken || !d || d.source !== 'library') return;
    var q = String(d.libQuery || '').trim();
    var filters = { bodyPart: d.libBody || '', equipment: d.libEquip || '', target: d.libTarget || '' };
    if (q.length < 2 && !filters.bodyPart && !filters.equipment && !filters.target) {
      d.libRows = []; d.libMore = false; d.libStatus = ''; d.libError = false; d.libBusy = false; paintLib(); return;
    }
    var search = window.WBAuth && WBAuth.searchExercises;
    if (!search) { d.libStatus = 'The exercise library is not ready yet.'; d.libError = true; d.libBusy = false; paintLib(); return; }
    d.libBusy = true;
    if (!append) { d.libStatus = 'Searching\u2026'; d.libError = false; }
    paintLib();
    var offset = append ? (d.libRows || []).length : 0;
    search(q, filters, 21, offset).then(function (rows) {
      if (token !== libToken || !draft || draft.source !== 'library') return;
      rows = Array.isArray(rows) ? rows : [];
      var more = rows.length > 20;
      if (more) rows = rows.slice(0, 20);
      draft.libMore = more;
      draft.libRows = append ? (draft.libRows || []).concat(rows) : rows;
      draft.libStatus = ''; draft.libError = false; draft.libBusy = false;
      paintLib();
    }).catch(function (err) {
      if (token !== libToken || !draft) return;
      draft.libStatus = (err && err.message) || 'Could not search the exercise library.';
      draft.libError = true; draft.libBusy = false;
      if (!append) draft.libRows = [];
      paintLib();
    });
  }
  function ensureLibFilters() {
    if (libFiltersLoaded || !window.WBAuth || !WBAuth.exerciseFilters) return;
    libFiltersLoaded = true;
    WBAuth.exerciseFilters().then(function (f) {
      f = f || {};
      libFilters = {
        bodyParts: Array.isArray(f.bodyParts) ? f.bodyParts : [],
        equipment: Array.isArray(f.equipment) ? f.equipment : [],
        targets: Array.isArray(f.targets) ? f.targets : []
      };
      ['lib-body', 'lib-equip', 'lib-target'].forEach(function (id, i) {
        var el = document.getElementById(id);
        if (!el) return;
        var opts = [libFilters.bodyParts, libFilters.equipment, libFilters.targets][i];
        var cur = el.value, label = el.getAttribute('aria-label') || '';
        var html = '<option value="">' + esc(label) + '</option>';
        opts.forEach(function (o) { html += '<option value="' + esc(o) + '"' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; });
        el.innerHTML = html;
      });
    }).catch(function () { libFiltersLoaded = false; });
  }
  function editorMediaHtml(d) {
    if (d.source === 'library') {
      if (!d.libraryId) return '<div class="media"><span>Choose an exercise to see its demo.</span></div>';
      var url = M.exerciseGifUrl(d.libraryId, d.view, gifBase());
      var pic = url ? '<img class="ex-gif" alt="" data-gif="1" src="' + esc(url) + '">' : '<span>Demo will show here once it\u2019s connected.</span>';
      return '<div class="media has-pic">' + pic + seg('view', [['180', '180'], ['360', '360']], d.view === '360' ? '360' : '180') + '</div>';
    }
    var pic = '<span>Optional image</span>';
    if (!d.clearImage && d.pendingUrl) pic = '<img class="ex-gif" alt="" src="' + esc(d.pendingUrl) + '">';
    else if (!d.clearImage && d.imageKey) pic = '<span class="media-note" data-local-img="' + esc(d.imageKey) + '">No image on this device</span>';
    var hasPhoto = !d.clearImage && (d.pendingUrl || d.imageKey);
    return '<div class="media has-pic">' + pic +
      '<label class="file-btn">' + (hasPhoto ? 'Replace image' : 'Add an image') + '<input id="ex-photo" type="file" accept="image/*"></label>' +
      (hasPhoto ? '<button type="button" data-a="clearphoto">Remove image</button>' : '') +
      '<span class="mute">Stays on this device only. Clearing site data removes it.</span></div>';
  }
  // Library text fills Notes only when they are blank, or still the previous
  // unedited auto-fill. Anything the trainer typed stays. Manual entry never calls this.
  function applyLibraryDescription(d, row) {
    if (!row || typeof row.description !== 'string') return;
    var notes = d.notes == null ? '' : String(d.notes);
    if (notes.trim() !== '' && notes !== d.autoDescription) return;
    d.notes = row.description;
    d.autoDescription = row.description;
  }
  function libRowById(d, id) {
    var rows = d.libRows || [], i;
    for (i = 0; i < rows.length; i++) if (rows[i] && String(rows[i].id) === id) return rows[i];
    return null;
  }
  function planMedia(d) {
    var saved = M.cleanMedia(d.savedMedia);
    var oldKey = saved && saved.kind === 'custom' ? saved.imageKey : '';
    if (d.source === 'library') {
      if (!d.libraryId) return { error: 'Choose an exercise from the library, or enter one manually instead.', media: null };
      var picked = M.cleanMedia({ kind: 'library', libraryId: d.libraryId, view: d.view });
      if (!picked) return { error: 'Choose an exercise from the library, or enter one manually instead.', media: null };
      return { media: picked, dropKey: oldKey };
    }
    if (d.clearImage) return { media: null, dropKey: oldKey };
    if (d.pendingBlob) {
      var key = d.imageKey || M.uid('img');
      d.imageKey = key;
      return { media: { kind: 'custom', imageKey: key }, blob: d.pendingBlob, key: key, dropKey: oldKey && oldKey !== key ? oldKey : '' };
    }
    if (d.imageKey && M.cleanMedia({ kind: 'custom', imageKey: d.imageKey })) return { media: { kind: 'custom', imageKey: d.imageKey }, dropKey: '' };
    return { media: null, dropKey: oldKey };
  }
  function renderEditor(w, exId) {
    var isNew = exId === 'new', ex = isNew ? null : w.items.filter(function (x) { return x.id === exId; })[0];
    if (!isNew && !ex) return go('#/w/' + w.id);
    if (!draft) draft = makeDraft(ex || M.newExercise());
    var d = draft, c = d.cfg[d.mode];
    var ssBlock = d.groupId ? M.blocks(w).filter(function (b) { return b.groupId === d.groupId; })[0] : null;
    var ssNonFinal = !!(ssBlock && ssBlock.items[ssBlock.items.length - 1].id !== d.id);
    titleEl.textContent = isNew ? 'New exercise' : 'Edit exercise'; backBtn.hidden = false;
    var h = '<div class="card">' + (ssBlock ? '<div class="warn" role="status">Only the final rest period will function in each set of a superset</div>' : '') +
      seg('source', [['custom', 'Enter manually'], ['library', 'Exercise library']], d.source || 'custom') +
      (d.source === 'library'
        ? '<input id="lib-q" aria-label="Search exercises" placeholder="Search exercises" autocomplete="off" value="' + esc(d.libQuery || '') + '">' +
          '<div class="lib-filters">' +
            filterSelect('lib-body', 'Any body part', d.libBody, libFilters.bodyParts) +
            filterSelect('lib-equip', 'Any equipment', d.libEquip, libFilters.equipment) +
            filterSelect('lib-target', 'Any target', d.libTarget, libFilters.targets) +
          '</div><div id="lib-results">' + resultsHtml(d) + '</div>'
        : '') +
      '<label>Exercise name</label><input data-b="name" value="' + esc(d.name) + '" placeholder="e.g. Goblet squat" autocomplete="off">' +
      (d.source === 'library' && d.libraryId ? '<p class="mute">Library demo is attached.</p>' : '') +
      '<label>Mode</label>' + seg('mode', [['reps', 'Reps'], ['intervals', 'Intervals'], ['timer', 'Timer'], ['stopwatch', 'Stopwatch']], d.mode) +
      (d.mode === 'stopwatch' ? '<label>Attempts</label>' + numIn('sets', d.sets, 'e.g. 3') : d.mode === 'intervals' ? '<label># of intervals</label>' + numIn('sets', d.sets, 'e.g. 8') : '<label>Sets</label>' + numIn('sets', d.sets, 'e.g. 3')) +
      '<label>Weight</label>' + seg('unit', [['lb', 'lb'], ['kg', 'kg'], ['bodyweight', 'Bodyweight']], d.unit) +
      (d.unit !== 'bodyweight' ? '<div style="margin-top:8px">' + numIn('wval', d.wval, 'Weight in ' + d.unit + ' (optional)', 'any') + '</div>' : '') +
      '';
    function repsUI(allowStatic) {
      var o = [['number', 'Number'], ['range', 'Range']]; if (allowStatic) o.push(['static', 'Static hold']);
      var x = '<label>Reps type' + (allowStatic ? ' <span class="mute" style="font-weight:400">(optional — tap again to clear)</span>' : '') + '</label>' + seg('repsType', o, c.repsType);
      if (c.repsType === 'number') x += '<label>Reps</label>' + numIn('cfg.count', c.count, 'e.g. 10');
      if (c.repsType === 'range') x += '<label>Rep range (min – max)</label><div class="row"><div class="grow">' + numIn('cfg.min', c.min, 'min') + '</div><span>–</span><div class="grow">' + numIn('cfg.max', c.max, 'max') + '</div></div>';
      if (c.repsType === 'static') x += '<p class="mute">Static hold — time only, no rep count.</p>';
      return x;
    }
    if (d.mode === 'reps') {
      h += repsUI(false);
      h += '<label>Rest time between sets (optional)' + (ssNonFinal ? ' <span class="mute">(disabled — not final in superset)</span>' : '') + '</label>' + timeIn('cfg', c, 'rm', 'rs', ssNonFinal);
    } else if (d.mode === 'intervals') {
      h += '<label>Interval time</label>' + timeIn('cfg', c, 'wm', 'ws') + repsUI(true);
    } else if (d.mode === 'timer') {
      h += '<label>Work time</label>' + timeIn('cfg', c, 'wm', 'ws') + '<label>Rest time' + (ssNonFinal ? ' <span class="mute">(disabled — not final in superset)</span>' : '') + '</label>' + timeIn('cfg', c, 'rm', 'rs', ssNonFinal) + repsUI(true);
    } else {
      h += '<p class="mute">Counts up from 0:00 during the workout. No settings needed.</p>' +
        '<label class="row" style="font-weight:400"><input type="checkbox" class="sel" data-b="cfg.lapsEnabled"' + (c.lapsEnabled ? ' checked' : '') + '> Record laps (agility / splits)</label>' +
        (c.lapsEnabled ? '<label>Lap quantity</label>' + numIn('cfg.lapCount', c.lapCount, 'e.g. 4') + '<div id="lap-events">' + lapEventsHtml(c) + '</div>' : '');
    }
    h += '<label>Notes</label><textarea data-b="notes" placeholder="Cues, tempo, equipment…">' + esc(d.notes) + '</textarea>' +
      editorMediaHtml(d) + '<div id="errs"></div>' +
      '<div class="actions" style="margin-top:16px"><button class="pri grow" data-a="save">Save exercise</button><button data-a="cancel">Cancel</button></div></div>';
    app.innerHTML = copyNote(w) + h;
    if (window.WBMedia) WBMedia.bind(app);
    if (d.source === 'library') ensureLibFilters();
    app.onchange = null;
    app.oninput = app.onchange = function (e) {
      var t = e.target;
      if (t.id === 'ex-photo') {
        if (e.type !== 'change') return;
        var file = t.files && t.files[0];
        if (!file) return;
        if (!/^image\//.test(file.type || '')) { toast('Choose an image'); return; }
        if (file.size > PHOTO_LIMIT) { toast('Choose an image under 5 MB'); return; }
        releasePendingImage();
        d.pendingBlob = file; d.pendingUrl = URL.createObjectURL(file); d.clearImage = false;
        if (!d.imageKey) d.imageKey = M.uid('img');
        renderEditor(w, exId);
        return;
      }
      if (t.id === 'lib-q' || t.id === 'lib-body' || t.id === 'lib-equip' || t.id === 'lib-target') {
        var nextQuery = (document.getElementById('lib-q') || {}).value || '';
        if (t.id === 'lib-q' && nextQuery !== (d.libQuery || '')) d.libCollapsed = false;
        d.libQuery = nextQuery;
        d.libBody = (document.getElementById('lib-body') || {}).value || '';
        d.libEquip = (document.getElementById('lib-equip') || {}).value || '';
        d.libTarget = (document.getElementById('lib-target') || {}).value || '';
        scheduleLibSearch(false);
        return;
      }
      if (t.dataset && t.dataset.lev != null) {
        var row = ensureEventDraft(d.cfg.stopwatch)[+t.dataset.lev];
        if (row) row.on = !!t.checked;
        var evBox = document.getElementById('lap-events');
        if (evBox) evBox.innerHTML = lapEventsHtml(d.cfg.stopwatch);
        return;
      }
      if (t.dataset && t.dataset.lename != null) {
        var named = ensureEventDraft(d.cfg.stopwatch)[+t.dataset.lename];
        if (named) named.name = t.value;
        return;
      }
      var b = t.dataset.b; if (!b) return;
      var v = t.type === 'checkbox' ? t.checked : t.value;
      if (b.indexOf('cfg.') === 0) d.cfg[d.mode][b.slice(4)] = v; else d[b] = v;
      if (b === 'cfg.lapCount') {
        var box = document.getElementById('lap-events');
        // Skip a no-op refresh (the field's change event on blur) so it doesn't
        // replace a checkbox the user is clicking in the lap list.
        var next = lapEventsHtml(d.cfg.stopwatch);
        if (box && box.innerHTML !== next) box.innerHTML = next;
        return;
      }
      if (b === 'cfg.lapsEnabled') renderEditor(w, exId);
    };
    app.onclick = function (e) {
      var s = e.target.closest('[data-seg]');
      if (s) {
        var k = s.dataset.seg;
        if (k === 'source') {
          if (d.source !== s.dataset.v) { d.source = s.dataset.v; onLibrarySourceChange(); }
          return renderEditor(w, exId);
        }
        if (k === 'repsType') { var cc = d.cfg[d.mode]; cc.repsType = d.mode !== 'reps' && cc.repsType === s.dataset.v ? null : s.dataset.v; }
        else d[k] = s.dataset.v;
        return renderEditor(w, exId);
      }
      var b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'cancel') { releasePendingImage(); return go('#/w/' + w.id); }
      if (b.dataset.a === 'pick') {
        d.libraryId = b.dataset.id || '';
        d.name = b.dataset.name || d.name;
        d.source = 'library';
        if (d.view !== '360') d.view = '180';
        applyLibraryDescription(d, libRowById(d, d.libraryId));
        d.libCollapsed = true;
        return renderEditor(w, exId);
      }
      if (b.dataset.a === 'libmore') { scheduleLibSearch(true); return; }
      if (b.dataset.a === 'clearphoto') {
        releasePendingImage();
        d.pendingBlob = null; d.clearImage = true;
        return renderEditor(w, exId);
      }
      if (b.dataset.a === 'save') {
        if (d.saving) return;
        var plan = planMedia(d);
        d.media = plan.media;
        var res = buildFromDraft(d);
        if (plan.error) res.errors.unshift(plan.error);
        if (res.errors.length) { document.getElementById('errs').innerHTML = '<div class="errs">' + res.errors.map(esc).join('<br>') + '</div>'; document.getElementById('errs').scrollIntoView({ block: 'center' }); return; }
        d.saving = true;
        var write = plan.blob && window.WBMedia ? WBMedia.put(plan.key, plan.blob) : Promise.resolve();
        write.then(function () {
          if (plan.dropKey && !customKeyInUse(plan.dropKey, d.id) && window.WBMedia) return WBMedia.remove(plan.dropKey);
        }).then(function () {
          releasePendingImage();
          M.upsertExercise(w, res.ex); persist(); toast('Saved'); go('#/w/' + w.id);
        }).catch(function () {
          d.saving = false;
          toast('Could not keep that image on this device');
        });
      }
    };
  }
  function buildFromDraft(d) {
    var errs = [], c = d.cfg[d.mode], raw = [d.sets, d.wval];
    var intOf = function (v) { var n = M.num(v); return n === null ? NaN : n; };
    var ex = { id: d.id, name: d.name, sets: intOf(d.sets), weight: { unit: d.unit, value: d.unit === 'bodyweight' ? null : M.num(d.wval) },
      mode: d.mode, notes: d.notes, groupId: d.groupId, media: d.media, modeConfig: {} };
    if (d.mode === 'reps') { ex.modeConfig = { repsType: c.repsType, count: intOf(c.count), min: intOf(c.min), max: intOf(c.max), restSec: M.toSec(c.rm, c.rs) }; raw.push(c.rm, c.rs); if (c.repsType === 'number') raw.push(c.count); if (c.repsType === 'range') raw.push(c.min, c.max); }
    if (d.mode === 'intervals') { ex.modeConfig = { workSec: M.toSec(c.wm, c.ws) }; raw.push(c.wm, c.ws); }
    if (d.mode === 'timer') { ex.modeConfig = { workSec: M.toSec(c.wm, c.ws), restSec: M.toSec(c.rm, c.rs) }; raw.push(c.wm, c.ws, c.rm, c.rs); }
    if (d.mode === 'intervals' || d.mode === 'timer') { Object.assign(ex.modeConfig, { repsType: c.repsType, count: intOf(c.count), min: intOf(c.min), max: intOf(c.max) }); if (c.repsType === 'number') raw.push(c.count); if (c.repsType === 'range') raw.push(c.min, c.max); }
    if (d.mode === 'stopwatch') {
      ex.modeConfig = { lapsEnabled: !!c.lapsEnabled };
      if (c.lapsEnabled) {
        ex.modeConfig.lapCount = intOf(c.lapCount);
        raw.push(c.lapCount);
        var evs = [];
        (c.eventDraft || []).forEach(function (row, i) {
          if (row && row.on && i < ex.modeConfig.lapCount) evs.push({ lap: i + 1, name: String(row.name || '').trim() });
        });
        if (evs.length) ex.modeConfig.events = evs;
      }
    }
    if (raw.some(function (v) { var n = M.num(v); return n !== null && n < 0; })) errs.push('Numbers cannot be negative.');
    if (d.mode !== 'stopwatch' && [c.ws, c.rs].some(function (v) { return M.num(v) > 59; })) errs.push('Seconds must be 0–59.');
    errs = errs.concat(M.validateExercise(ex).filter(function (m) { return errs.indexOf(m) < 0; }));
    return { ex: ex, errors: errs };
  }
  window.WB_buildFromDraft = buildFromDraft; window.WB_makeDraft = makeDraft; // exposed for testing
  captureInvite();
  route();
})();
