/* Workout Builder UI (Stage 2). Hash routes: #/  |  #/w/<id>  |  #/w/<id>/ex/<exId or new>  |  #/view/<id>  |  #/tracking  |  #/tracking/client/<id>  |  #/tracking/dashboard  |  #/tracking/dashboard/client/<id>  |  #/history  |  #/history/<key>  |  #/history/session/<id>  |  #/history/client/<id>/<key>  |  #/history/client/<id>/session/<id>  |  #/hub  |  #/hub/new  |  #/hub/<id>  |  #/circuits  |  #/circuits/new  |  #/circuits/<id>  |  #/circuits/<id>/run
   A signed-out visit with no hash shows the public landing page. */
(function () {
  'use strict';
  var M = window.WB, app = document.getElementById('app'), titleEl = document.getElementById('title'), backBtn = document.getElementById('back');
  var data = M.load(localStorage), selected = {}, draft = null;

  function persist() { archiveCurrent(); M.save(localStorage, data); scheduleCopySave(); scheduleSharePush(); if (!applyingLibrary) scheduleAccountSync(); scheduleGuestSave(); }
  function persistLocal() { archiveCurrent(); M.save(localStorage, data); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getW(id) {
    var found = data.workouts.filter(function (w) { return w && String(w.id) === String(id); })[0];
    if (found) return found;
    return guests.filter(function (w) { return w && String(w.id) === String(id); })[0];
  }
  function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  var RUN_NEEDS_NUMBERS = 'Fill in every number before running this workout.';
  var EMPTY_FIELDS = 'Fill in the highlighted fields.';
  // A stored exercise can be run only when every required number is actually filled in.
  function missingRequiredNumber(ex) {
    if (!ex) return true;
    var c = ex.modeConfig || {};
    if (!Number.isInteger(ex.sets) || ex.sets < 1) return true;
    if (ex.mode === 'reps' || ex.mode === 'intervals' || ex.mode === 'timer') {
      if (c.repsType === 'number' && !(Number.isInteger(c.count) && c.count >= 1)) return true;
      if (c.repsType === 'range' && (!(Number.isInteger(c.min) && c.min >= 1) || !(Number.isInteger(c.max) && c.max >= 1))) return true;
    }
    if (ex.mode === 'intervals' && !(c.workSec > 0)) return true;
    if (ex.mode === 'timer' && (!(c.workSec > 0) || !(typeof c.restSec === 'number' && c.restSec >= 0))) return true;
    if (ex.mode === 'stopwatch' && c.lapsEnabled !== false && !(Number.isInteger(c.lapCount) && c.lapCount >= 1)) return true;
    return false;
  }
  function workoutRunnable(w) {
    return !!(w && Array.isArray(w.items) && w.items.length && w.items.every(function (it) { return !missingRequiredNumber(it); }));
  }
  function reqOk(el) {
    var raw = String(el.value == null ? '' : el.value).trim();
    if (!/^\d+$/.test(raw)) return false;
    var n = Number(raw);
    var b = el.getAttribute('data-b') || '';
    if (b === 'cfg.ws' || b === 'cfg.rs') return n <= 59;
    if (b === 'cfg.wm' || b === 'cfg.rm') return true;
    return n >= 1;
  }
  // Tap or focus clears a pre-filled number. Leaving it blank keeps it blank.
  function clearPrefilled(el) {
    if (!el || el.disabled || el.readOnly || !el.hasAttribute('data-clear') || el._wbClear) return;
    var original = el.value;
    if (original === '') return;
    var typed = false, mine = false;
    function stop() {
      if (el._wbClear !== stop) return;
      el._wbClear = null;
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('input', onInput);
      el.removeEventListener('blur', stop);
    }
    function onKey() { typed = true; }
    function onInput() { if (!mine) typed = true; }
    el.addEventListener('keydown', onKey);
    el.addEventListener('input', onInput);
    el.addEventListener('blur', stop);
    el._wbClear = stop;
    var started = Date.now();
    function wipe() {
      if (el._wbClear !== stop) return;
      if (typed || !el.isConnected) { stop(); return; }
      if (el.value === original) {
        mine = true;
        el.value = '';
        try { el.setSelectionRange(0, 0); } catch (err) {}
        el.dispatchEvent(new Event('input', { bubbles: true }));
        mine = false;
      }
      if (Date.now() - started > 280) { stop(); return; }
      setTimeout(wipe, 40);
    }
    wipe();
  }
  document.addEventListener('pointerdown', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('input[data-clear]') : null;
    if (!el || el === document.activeElement) return;
    clearPrefilled(el);
  }, true);
  document.addEventListener('focusin', function (e) { clearPrefilled(e.target); });
  function go(h) { location.hash = h; }
  function hashBody() { return location.hash.replace(/^#\/?/, '').split('?')[0]; }
  function hashPage() { return hashBody().split('/')[0]; }
  backBtn.onclick = function () {
    var page = hashPage();
    if ((page === 'programs' || page === 'preview') && window.WBPreview && WBPreview.back()) return;
    if (backBtn.hidden) return;
    if (page === 'signin' || page === 'join' || page === 'forgot' || page === 'reset') return;
    if (page === 'programs' || page === 'preview') return go('#/');
    if (page === 'tracking') {
      var backTail = hashBody().split('/');
      if (backTail[1] === 'dashboard' && backTail[2]) return go('#/tracking/dashboard');
      // A client's History peels back to the trainer's own History, the same
      // place the browser returns after the menu pick.
      if (backTail[1] === 'client' && backTail[2]) return go('#/tracking');
      return go('#/');
    }
    if (page === 'history') {
      if (hashBody().split('/')[1]) return go(historyListHash());
      return go('#/');
    }
    var p = location.hash.split('/');
    if (p[1] === 'play' || p[1] === 'view') return WBPlayer.requestEnd();
    if (page === 'messages' && hashBody().split('/')[1]) return go('#/messages');
    if (page === 'hub') {
      var hubBits = hashBody().split('/');
      if (hubBits[2] === 'edit' && hubBits[1]) return go('#/hub/' + hubBits[1]);
      if (hubBits[1] === 'find' && hubBits[2]) return go('#/hub/find');
      if (hubBits[1]) return go('#/hub');
      return go('#/');
    }
    if (page === 'circuits') {
      if (window.WBCircuitSession && WBCircuitSession.back()) return;
      if (window.WBCircuits && WBCircuits.back()) return;
      return go('#/');
    }
    if (page === 'send') return go('#/');
    if (page === 'received') return go(hashBody().split('/')[1] ? '#/received' : '#/');
    if (page === 'client') return go('#/account');
    if (page === 'admin') return go('#/account');
    if (page === 'w') {
      var segs = hashBody().split('/');
      if (segs.length > 2) return go('#/w/' + segs[1]);
      var opened = getW(segs[1]);
      if (opened && opened.remoteOwnerId) return go('#/client/' + opened.remoteOwnerId);
      var back = receivedBack(opened);
      if (back) return go(back);
    }
    go(p.length > 3 ? '#/w/' + p[2] : '#/');
  };

  function onAuthPage() { var p = hashPage(); return p === 'signin' || p === 'join' || p === 'reset'; }
  var INVITE_KEY = 'wb.invite', TRAINER_KEY = 'wb.trainer', pendingInviteNotice = null;
  function pendingCode() { try { return sessionStorage.getItem(INVITE_KEY) || ''; } catch (e) { return ''; } }
  // inviteArrival is the code taken from this visit's URL. It stays until the
  // stored code is cleared, so sign-in routing still works after the param is gone.
  var inviteArrival = '', releasedInvites = {};
  function rememberCode(code) {
    try { if (code) sessionStorage.setItem(INVITE_KEY, code); else sessionStorage.removeItem(INVITE_KEY); } catch (e) {}
    if (!code) inviteArrival = '';
  }
  function linkInviteCode() {
    var code = '';
    try {
      code = new URLSearchParams(location.search).get('invite') || '';
      if (!code) code = new URLSearchParams(location.hash.split('?')[1] || '').get('invite') || '';
    } catch (e) {}
    return code ? WBInvites.normalizeCode(code) : '';
  }
  // Trainer links keep ?invite= in the search string across hash changes.
  // Copy the code once, then drop it from the URL. A later route() must not
  // write it back after a successful redeem cleared sessionStorage.
  function captureInvite() {
    var code = linkInviteCode();
    if (!code || releasedInvites[code]) {
      if (code) stripInviteFromUrl();
      return;
    }
    rememberCode(code);
    inviteArrival = code;
    stripInviteFromUrl();
  }
  function releaseInvite(code) {
    var used = '';
    try { used = WBInvites.normalizeCode(code || '') || pendingCode(); } catch (e) { used = pendingCode(); }
    if (inviteArrival) releasedInvites[inviteArrival] = true;
    if (used) releasedInvites[used] = true;
    rememberCode('');
    stripInviteFromUrl();
  }
  function stripInviteFromUrl() {
    try {
      var u = new URL(location.href);
      var changed = false;
      if (u.searchParams.has('invite')) {
        u.searchParams.delete('invite');
        changed = true;
      }
      var rawHash = u.hash || '';
      var q = rawHash.indexOf('?');
      if (q !== -1) {
        var hashParams = new URLSearchParams(rawHash.slice(q + 1));
        if (hashParams.has('invite')) {
          hashParams.delete('invite');
          var rest = hashParams.toString();
          u.hash = rawHash.slice(0, q) + (rest ? '?' + rest : '');
          changed = true;
        }
      }
      if (!changed) return;
      var search = u.searchParams.toString();
      var path = u.pathname || '/';
      if (path === '//' || path === '') path = '/';
      history.replaceState(null, '', path + (search ? '?' + search : '') + (u.hash || ''));
    } catch (e) {}
  }
  function signedOutHome() { return (linkInviteCode() || inviteArrival) ? '#/join' : ''; }
  // Signed-out visitors, including right after sign-out, land on the marketing page.
  function goSignedOutHome() {
    if (linkInviteCode() || inviteArrival) return go('#/join');
    if (location.hash === '' || location.hash === '#') {
      showLanding();
      syncChrome();
      return;
    }
    location.hash = '';
  }
  function takeInviteNotice() { var n = pendingInviteNotice; pendingInviteNotice = null; return n; }
  function inviteWaiting(err) {
    var msg = String(err && err.message || '').replace(/^\s+|\s+$/g, '');
    return msg === 'Your account is waiting for approval.';
  }
  function inviteMessage(err) {
    return String(err && err.message || '').replace(/^\s+|\s+$/g, '');
  }
  function inviteFailureKind(err) {
    return window.WBInvites.inviteFailureKind(err);
  }
  function noteRedeemedInvite(code, res) {
    releaseInvite(code);
    pendingInviteNotice = { text: (res && res.message) || 'Invite applied.', isError: false };
    if (!(res && res.membership && window.WBMembership && WBMembership.tier(res.membership))) return;
    var next = {};
    var prior = cachedProfile;
    if (prior) Object.keys(prior).forEach(function (key) { next[key] = prior[key]; });
    next.membership = res.membership;
    // A redeem result has no approval flag. Keep a flag already loaded.
    // Never write undefined over it. With no loaded flag, the account is not approved.
    if (prior && Object.prototype.hasOwnProperty.call(prior, 'access_approved')) next.access_approved = prior.access_approved;
    else next.access_approved = false;
    cachedProfile = next;
  }
  var inviteRedeemFlight = null, inviteSettled = '', inviteTriedRoute = -1, inviteTriedCode = '';
  function inviteCodeFromSession(session) {
    var user = session && session.user;
    var meta = user && (user.user_metadata || user.raw_user_meta_data);
    if (!meta || !window.WBInvites) return '';
    var code = WBInvites.normalizeCode(meta.invite_code || '');
    return WBInvites.codeIsWellFormed(code) ? code : '';
  }
  function forgetServerInvite() {
    if (!WBAuth.forgetInviteCode) return Promise.resolve();
    return Promise.resolve().then(function () { return WBAuth.forgetInviteCode(); }).then(function () {}, function () {});
  }
  // One auto-redeem path. The code may be in this tab or in the auth user
  // from sign-up. A waiting-for-approval error keeps it for the next sign-in.
  function redeemStoredInvite(session) {
    var stored = pendingCode();
    var code = stored || inviteCodeFromSession(session);
    if (!code || !WBAuth.redeemInvite) return Promise.resolve();
    if (inviteSettled === code) {
      if (!stored) return forgetServerInvite();
      return Promise.resolve();
    }
    // One automatic try per route change, so a 500 cannot spin in place.
    if (inviteTriedRoute === routeToken && inviteTriedCode === code) return Promise.resolve();
    if (inviteRedeemFlight) return inviteRedeemFlight;
    inviteTriedRoute = routeToken;
    inviteTriedCode = code;
    var flight;
    flight = Promise.resolve().then(function () {
      return WBAuth.redeemInvite(code);
    }).then(function (res) {
      inviteSettled = code;
      if (!stored || pendingCode() === code) noteRedeemedInvite(code, res);
      return forgetServerInvite();
    }, function (err) {
      var kind = inviteFailureKind(err);
      if (kind !== 'terminal') {
        if (!inviteWaiting(err)) pendingInviteNotice = { text: inviteMessage(err) || 'Could not use that invite.', isError: true };
        return;
      }
      inviteSettled = code;
      if (!stored || pendingCode() === code) releaseInvite(code);
      pendingInviteNotice = { text: inviteMessage(err) || 'Could not use that invite.', isError: true };
      return forgetServerInvite();
    }).then(function () {
      if (inviteRedeemFlight === flight) inviteRedeemFlight = null;
    });
    inviteRedeemFlight = flight;
    return flight;
  }
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
  var levelNoteOn = false;
  function levelTier(profile) {
    if (!profile || !window.WBMembership) return null;
    var active = WBMembership.tier(profile.membership);
    if (active) return active;
    return WBMembership.tier(profile.intended_plan);
  }
  function levelCan(profile, action) {
    if (!window.WBPrograms) return false;
    return WBPrograms.buttons(WBPrograms.roleOf(profile)).indexOf(action) >= 0;
  }
  function ownWorkoutCount() {
    var n = 0;
    (data.workouts || []).forEach(function (w) { if (w && !w.sourceTrainerId) n++; });
    return n;
  }
  function atWorkoutCap(profile) {
    var tier = levelTier(profile);
    if (!tier || tier.workoutCap == null) return false;
    return ownWorkoutCount() >= tier.workoutCap;
  }
  function loadGateProfile() {
    function read() {
      var pending = WBAuth.profile ? WBAuth.profile() : Promise.resolve(null);
      return Promise.resolve().then(function () { return pending; });
    }
    function fromProfile(profile) {
      if (profile) cachedProfile = profile;
      return { profile: profile || cachedProfile, known: true };
    }
    // A failed read keeps a level already loaded. With none, the lock stays closed.
    function fromFailure() {
      return { profile: cachedProfile, known: true };
    }
    return read().then(fromProfile, function () {
      return read().then(fromProfile, fromFailure);
    });
  }
  function levelNoteHtml(profile) {
    var tier = levelTier(profile);
    var name = tier ? tier.name : 'Your plan';
    var lines = tier && tier.available ? tier.available : [];
    var h = '<div class="card" id="level-note" role="dialog" aria-label="Your plan">';
    h += '<div class="name">' + esc(name) + '</div>';
    h += '<p class="mute">Your plan can:</p>';
    lines.forEach(function (line) { h += '<p class="mute">' + esc(line) + '</p>'; });
    h += '<div class="actions"><button class="pri" type="button" id="level-upgrade">Upgrade</button>';
    h += '<button type="button" id="level-dismiss">Not now</button></div></div>';
    return h;
  }
  function renderLevelNote(profile) {
    levelNoteOn = false;
    titleEl.textContent = 'Your plan';
    backBtn.hidden = false;
    app.innerHTML = levelNoteHtml(profile);
    app.onclick = function (e) {
      if (e.target.closest('#level-upgrade')) return go('#/subscriptions');
      if (e.target.closest('#level-dismiss')) return go('#/');
    };
    app.oninput = null;
    app.onchange = null;
  }
  var routeToken = 0;
  var cachedProfile = null, applyingCopies = false, copyStamp = {}, copySaveGen = {}, removedCopies = [], pullToken = 0, profileLookup = 0;
  var profileGateOn = false, accessWaitOn = false, profileSheetRequired = false, profilePhotoBlob = null, profileObjectUrl = '', profileKeyBound = false;
  var shareState = window.WBSharing ? WBSharing.initialState() : null;
  var shareUser = '', shareLoadGen = 0, shareSaveGen = 0, linkShareChoice = true;
  var shareLookup = null, shareSessionFlight = false, shareRetryTimer = null, shareRetryWait = 1000;
  var pushFlight = null, pushPending = false, pushTimer = null, pushWait = 1000;
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
    if (w && w.remoteLocked) return true;
    if (w && w.remoteEditable) return false;
    if (!w || !w.sourceTrainerId || !window.WBSends) return false;
    if (!cachedProfile) return true;
    return !WBSends.canEditCopy(cachedProfile, w);
  }
  function copyNote(w) {
    if (!w || !w.sourceTrainerId) return '';
    return '<p class="mute" id="copy-note">Copy from your trainer. Edits stay on this copy and do not change their workout.</p>';
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
      return [w.id, w.name, w.updatedAt || 0, w.sourceTrainerId || '', w.items ? w.items.length : 0, w.sourceTrainerVerified ? 1 : 0].join('~');
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
    paintReceivedDot();
  }
  var RECEIVED_SEEN = 'wb.receivedSeen';
  function receivedSeenKey() {
    var id = cachedProfile && cachedProfile.id;
    return RECEIVED_SEEN + '.' + (id || 'local');
  }
  function readReceivedSeen() {
    try {
      var raw = JSON.parse(localStorage.getItem(receivedSeenKey()) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (e) { return {}; }
  }
  function markReceivedSeen(ids) {
    var seen = readReceivedSeen();
    var changed = false;
    (ids || []).forEach(function (id) {
      if (id == null) return;
      var key = String(id);
      if (seen[key]) return;
      seen[key] = 1;
      changed = true;
    });
    if (changed) {
      try { localStorage.setItem(receivedSeenKey(), JSON.stringify(seen)); } catch (e2) {}
    }
    paintReceivedDot();
  }
  function unseenReceivedCount() {
    if (window.WBPrograms && WBPrograms.isTrainer(WBPrograms.roleOf(cachedProfile))) return 0;
    var seen = readReceivedSeen();
    var n = 0;
    (data.workouts || []).forEach(function (w) {
      if (w && w.sourceTrainerId && !seen[String(w.id)]) n += 1;
    });
    return n;
  }
  function paintReceivedDot() {
    var link = document.getElementById('workouts-nav');
    if (!link) return;
    var n = unseenReceivedCount();
    var badge = link.querySelector('.request-count');
    if (!n) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'request-count';
      link.appendChild(badge);
    }
    badge.hidden = false;
    badge.textContent = String(n);
    badge.setAttribute('aria-label', n === 1 ? '1 new workout' : (n + ' new workouts'));
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
  var guests = [], guestStamp = {}, guestGen = {}, applyingLibrary = false, clientScreen = null;
  var libraryFlight = null, libraryAgain = false, libraryPhase = '', libraryDetail = '', libraryOff = false, libraryUserId = '';
  var librarySwitched = false;
  var libraryResumeAt = 0;
  var libraryAck = {}, pendingDrops = {}, clientQueue = [];
  function libraryBox(key) {
    try {
      var raw = localStorage.getItem(key);
      var box = raw ? JSON.parse(raw) : {};
      return box && typeof box === 'object' ? box : {};
    } catch (e) { return {}; }
  }
  function writeLibraryBox(key, box) {
    try { localStorage.setItem(key, JSON.stringify(box)); } catch (e) {}
  }
  function userMap(key, userId) {
    var box = libraryBox(key);
    var row = box[userId];
    return row && typeof row === 'object' ? row : {};
  }
  function writeUserMap(key, userId, row) {
    if (!userId) return;
    var box = libraryBox(key);
    box[userId] = row || {};
    writeLibraryBox(key, box);
  }
  function accountUserId(session) {
    var id = session && session.user && session.user.id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''))) return '';
    return String(id);
  }
  function noteDrop(id, at) {
    if (!id || !window.WBLibrary) return;
    var mark = WBLibrary.userDrop(at);
    if (!mark) return;
    pendingDrops[String(id)] = mark;
    var key = libraryUserId || '_pending';
    var drops = userMap(WBLibrary.DROP_KEY, key);
    if (!WBLibrary.isUserDrop(drops[String(id)]) || WBLibrary.dropTime(drops[String(id)]) < mark.at) drops[String(id)] = mark;
    writeUserMap(WBLibrary.DROP_KEY, key, drops);
    forgetArchived(id);
  }
  function absorbUserDrops(box) {
    Object.keys(box || {}).forEach(function (id) {
      if (WBLibrary.isUserDrop(box[id])) noteDrop(id, WBLibrary.dropTime(box[id]));
    });
  }
  var ARCHIVE_KEY = 'wb.workoutArchive.v1';
  var ARCHIVE_FOLD_KEY = 'wb.workoutArchiveFold.v1';
  function valuesOf(box) {
    return Object.keys(box || {}).map(function (id) { return box[id]; });
  }
  function archiveScope() {
    return libraryUserId || libraryOwner() || '_device';
  }
  function readArchive(userId) {
    var row = userMap(ARCHIVE_KEY, userId || '_device');
    if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
    return row;
  }
  function archiveCurrent() {
    if (!window.WBLibrary) return;
    var key = archiveScope();
    var archive = WBLibrary.rememberWorkouts(readArchive(key), data.workouts);
    writeUserMap(ARCHIVE_KEY, key, WBLibrary.pruneArchive(archive, data.workouts));
  }
  function forgetArchived(id) {
    if (!id) return;
    [archiveScope(), libraryUserId, '_device'].forEach(function (key) {
      if (!key) return;
      var archive = readArchive(key);
      if (!archive[String(id)]) return;
      delete archive[String(id)];
      writeUserMap(ARCHIVE_KEY, key, archive);
    });
  }
  function foldSavedCopies(archive, current, remote) {
    if (!libraryUserId) return archive;
    var folded = libraryBox(ARCHIVE_FOLD_KEY);
    if (folded[libraryUserId]) return archive;
    var cached = libraryBox(LIBRARY_CACHE_KEY)[libraryUserId];
    var found = cached && Array.isArray(cached.workouts) ? cached.workouts : [];
    return WBLibrary.rememberWorkouts(archive, WBLibrary.unseenWorkouts(found, current, remote));
  }
  function markArchiveFolded() {
    if (!libraryUserId) return;
    var folded = libraryBox(ARCHIVE_FOLD_KEY);
    if (folded[libraryUserId]) return;
    folded[libraryUserId] = Date.now();
    writeLibraryBox(ARCHIVE_FOLD_KEY, folded);
  }
  function resetLibraryMemory() {
    guests = [];
    guestStamp = {};
    guestGen = {};
    libraryAck = {};
    pendingDrops = {};
    clientQueue = [];
    libraryUserId = '';
    libraryPhase = '';
    libraryDetail = '';
    libraryAgain = false;
    clientScreen = null;
  }
  function libraryMissing(err) {
    return !!(err && (err.missing || /account workout SQL|not available yet/i.test(String(err.message || ''))));
  }
  function libraryStatusHtml() {
    if (!window.WBLibrary) return '';
    var model = WBLibrary.statusModel(libraryPhase, libraryDetail);
    if (!model.text) return '';
    return '<p class="mute" id="library-status">' + esc(model.text) +
      (model.plans ? ' <a href="#/subscriptions">See plans</a>' : '') + '</p>';
  }
  function setLibraryStatus(phase, detail) {
    libraryPhase = phase || '';
    libraryDetail = detail || '';
  }
  function paintLibraryStatus() {
    if (hashPage() !== '') return;
    var model = window.WBLibrary ? WBLibrary.statusModel(libraryPhase, libraryDetail) : { text: '', plans: false };
    var el = document.getElementById('library-status');
    if (!model.text) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      var btn = app.querySelector('[data-a=new]');
      if (!btn) return;
      btn.insertAdjacentHTML('afterend', '<p class="mute" id="library-status"></p>');
      el = document.getElementById('library-status');
    }
    if (el) el.innerHTML = esc(model.text) + (model.plans ? ' <a href="#/subscriptions">See plans</a>' : '');
  }
  function applyLibraryRows(rows) {
    if (!window.WBLibrary) return;
    absorbUserDrops(pendingDrops);
    var drops = userMap(WBLibrary.DROP_KEY, libraryUserId);
    var stored = M.load(localStorage);
    // Snapshot first. Later steps update the open workout objects in place,
    // so a snapshot taken afterwards would already match and skip the save.
    var before = '';
    try { before = JSON.stringify(data.workouts); } catch (e) { before = ''; }
    var united = WBLibrary.reconcileDevice(data.workouts, stored.workouts, drops, rows);
    var archive = readArchive(libraryUserId);
    if (libraryUserId && !librarySwitched) archive = WBLibrary.rememberWorkouts(archive, valuesOf(readArchive('_device')));
    archive = WBLibrary.rememberWorkouts(archive, united);
    archive = foldSavedCopies(archive, united, rows);
    var merged = WBLibrary.mergeAccount(united, rows, drops);
    var restored = WBLibrary.restoreArchived(merged.workouts, archive, merged.tombstones, rows);
    var after = '';
    try { after = JSON.stringify(restored); } catch (e) { after = 'x'; }
    data.workouts = restored;
    writeUserMap(WBLibrary.DROP_KEY, libraryUserId, merged.tombstones);
    writeUserMap(ARCHIVE_KEY, libraryUserId || '_device', WBLibrary.pruneArchive(WBLibrary.rememberWorkouts(archive, restored), restored));
    markArchiveFolded();
    if (libraryUserId && !librarySwitched) writeUserMap(ARCHIVE_KEY, '_device', {});
    Object.keys(merged.ack || {}).forEach(function (id) { libraryAck[id] = merged.ack[id]; });
    if (before !== after) {
      applyingLibrary = true;
      try { persistLocal(); }
      catch (e) {}
      finally { applyingLibrary = false; }
    }
  }
  var LIBRARY_OWNER_KEY = 'wb.libraryOwner.v1';
  var LIBRARY_CACHE_KEY = 'wb.libraryCache.v1';
  var LIBRARY_SEED_KEY = 'wb.accountSeed.v1';
  var LIBRARY_REJECT_KEY = 'wb.accountReject.v1';
  function libraryOwner() {
    try { return localStorage.getItem(LIBRARY_OWNER_KEY) || ''; } catch (e) { return ''; }
  }
  function setLibraryOwner(id) {
    try { if (id) localStorage.setItem(LIBRARY_OWNER_KEY, id); } catch (e) {}
  }
  function readSeed(userId) {
    var box = libraryBox(LIBRARY_SEED_KEY);
    if (!Object.prototype.hasOwnProperty.call(box, userId)) return null;
    return Array.isArray(box[userId]) ? box[userId] : [];
  }
  function ensureSeed(userId) {
    var existing = readSeed(userId);
    if (existing) return existing;
    var ids = WBLibrary.seedIds(null, data.workouts);
    writeUserMap(LIBRARY_SEED_KEY, userId, ids);
    return ids;
  }
  function parkLibrary(ownerId) {
    if (!ownerId) return;
    var box = libraryBox(LIBRARY_CACHE_KEY);
    box[ownerId] = {
      workouts: data.workouts || [],
      sessions: data.sessions || [],
      programs: data.programs || []
    };
    writeLibraryBox(LIBRARY_CACHE_KEY, box);
    var prevDrops = userMap(WBLibrary.DROP_KEY, ownerId);
    function copyUserDrop(id, value) {
      if (!WBLibrary.isUserDrop(value)) return;
      var stamp = WBLibrary.dropTime(value);
      if (!WBLibrary.isUserDrop(prevDrops[id]) || stamp > WBLibrary.dropTime(prevDrops[id])) {
        prevDrops[id] = WBLibrary.userDrop(stamp);
      }
    }
    Object.keys(userMap(WBLibrary.DROP_KEY, '_pending')).forEach(function (id) {
      copyUserDrop(id, userMap(WBLibrary.DROP_KEY, '_pending')[id]);
    });
    Object.keys(pendingDrops).forEach(function (id) { copyUserDrop(id, pendingDrops[id]); });
    writeUserMap(WBLibrary.DROP_KEY, ownerId, prevDrops);
    writeUserMap(WBLibrary.DROP_KEY, '_pending', {});
    var parked = WBLibrary.rememberWorkouts(readArchive(ownerId), data.workouts);
    writeUserMap(ARCHIVE_KEY, ownerId, WBLibrary.pruneArchive(parked, data.workouts));
    var looseQueue = userMap(WBLibrary.QUEUE_KEY, '_pending');
    if (Array.isArray(looseQueue) && looseQueue.length) {
      var prevQueue = userMap(WBLibrary.QUEUE_KEY, ownerId);
      var queued = Array.isArray(prevQueue) ? prevQueue.slice() : [];
      looseQueue.forEach(function (item) { queued = WBLibrary.queueUpsert(queued, item); });
      writeUserMap(WBLibrary.QUEUE_KEY, ownerId, queued);
    }
    writeUserMap(WBLibrary.QUEUE_KEY, '_pending', []);
  }
  function adoptAccount(userId) {
    var owner = libraryOwner();
    librarySwitched = !!(owner && owner !== userId);
    if (librarySwitched) {
      parkLibrary(owner);
      pendingDrops = {};
      clientQueue = [];
      libraryAck = {};
      guests = [];
      guestStamp = {};
      guestGen = {};
      copyStamp = {};
      removedCopies = [];
      var cached = libraryBox(LIBRARY_CACHE_KEY)[userId];
      var choice = WBLibrary.libraryForAccount(owner, userId, data.workouts, cached);
      data.workouts = choice.workouts;
      data.sessions = cached && Array.isArray(cached.sessions) ? cached.sessions : [];
      data.programs = cached && Array.isArray(cached.programs) ? cached.programs : [];
      setLibraryOwner(userId);
      libraryUserId = userId;
      applyingLibrary = true;
      try { persistLocal(); }
      catch (e) {}
      finally { applyingLibrary = false; }
    }
    setLibraryOwner(userId);
    libraryUserId = userId;
  }
  function blankOutcome() {
    return { offline: false, auth: false, notice: '', missing: false, permanent: false };
  }
  function noteFailure(outcome, err) {
    if (!outcome || !window.WBLibrary) return;
    var kind = WBLibrary.syncFailure(err);
    if (kind === 'missing' || libraryMissing(err)) { outcome.missing = true; return; }
    if (kind === 'offline') { outcome.offline = true; return; }
    if (kind === 'auth') { outcome.auth = true; return; }
    outcome.notice = WBLibrary.preferNotice(outcome.notice, WBLibrary.plainSyncMessage(err));
    if (kind === 'permanent') outcome.permanent = true;
  }
  function mergeOutcome(into, extra) {
    if (!into || !extra) return into;
    if (extra.missing) into.missing = true;
    if (extra.auth) into.auth = true;
    if (extra.offline) into.offline = true;
    if (extra.permanent) into.permanent = true;
    into.notice = WBLibrary.preferNotice(into.notice, extra.notice);
    return into;
  }
  function applyOutcome(outcome) {
    if (!outcome) return;
    if (outcome.missing) { libraryOff = true; setLibraryStatus('', ''); return; }
    if (outcome.notice && /up to 6 workouts/i.test(outcome.notice)) setLibraryStatus('error', outcome.notice);
    else if (outcome.auth) setLibraryStatus('auth', '');
    else if (outcome.notice) setLibraryStatus('error', outcome.notice);
    else if (outcome.offline) setLibraryStatus('offline', '');
    else setLibraryStatus('saved', '');
  }
  function finishLibraryView(beforeSig) {
    if (hashPage() !== '') return;
    if (listSig(data.workouts) !== beforeSig) renderList();
    else paintLibraryStatus();
  }
  function readRejects() {
    var row = userMap(LIBRARY_REJECT_KEY, libraryUserId);
    if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
    return row;
  }
  function writeRejects(map) {
    writeUserMap(LIBRARY_REJECT_KEY, libraryUserId, map || {});
  }
  function changeStamp(change) {
    return WBLibrary.bodyStamp({
      name: change && change.name || '',
      items: change && change.items || [],
      deleted: !!(change && change.deleted),
      revisedAt: change && change.revisedAt || 0
    });
  }
  function heldRejection(key, stamp) {
    var entry = readRejects()[key];
    if (!WBLibrary.rejectionHolds(entry, stamp, Date.now())) return '';
    return entry.message || 'Could not sync workouts.';
  }
  function parkRejection(key, stamp, message) {
    var map = readRejects();
    map[key] = { stamp: stamp, at: Date.now(), message: message || '' };
    writeRejects(map);
  }
  function clearRejection(key) {
    var map = readRejects();
    if (!map[key]) return;
    delete map[key];
    writeRejects(map);
  }
  function rememberHeld(outcome, message) {
    outcome.notice = WBLibrary.preferNotice(outcome.notice, message);
    outcome.permanent = true;
  }
  function keepFailure(outcome, key, stamp, err) {
    noteFailure(outcome, err);
    if (WBLibrary.syncFailure(err) !== 'permanent') return;
    parkRejection(key, stamp, WBLibrary.plainSyncMessage(err));
  }
  // One workout at a time. A refusal or a throw is recorded and the next workout still runs.
  function eachStep(list, step) {
    var outcome = blankOutcome();
    var i = 0;
    function next() {
      if (outcome.missing || outcome.auth) return Promise.resolve(outcome);
      if (i >= list.length) return Promise.resolve(outcome);
      var item = list[i++];
      return Promise.resolve().then(function () { return step(item, outcome); }).then(next, function (err) {
        noteFailure(outcome, err);
        if (outcome.missing) return outcome;
        return next();
      });
    }
    return next();
  }
  function importPending() {
    var claimed = userMap(WBLibrary.CLAIM_KEY, libraryUserId);
    var drops = userMap(WBLibrary.DROP_KEY, libraryUserId);
    var seed = ensureSeed(libraryUserId);
    var pending = WBLibrary.importsForSeed(data.workouts, claimed, drops, seed);
    return eachStep(pending, function (w, outcome) {
      var change = WBLibrary.changeFrom(w, false);
      var key = String(w.id);
      var stamp = changeStamp(change);
      var held = heldRejection(key, stamp);
      if (held) { rememberHeld(outcome, held); return; }
      return Promise.resolve().then(function () {
        return WBAuth.accountImport(change);
      }).then(function (row) {
        if (!row || !row.localId) {
          var soft = new Error('Could not save that workout.');
          soft.permanent = true;
          keepFailure(outcome, key, stamp, soft);
          return;
        }
        clearRejection(key);
        claimed = WBLibrary.rememberClaim(claimed, row.localId);
        writeUserMap(WBLibrary.CLAIM_KEY, libraryUserId, claimed);
        if (row.revisedAt != null) libraryAck[String(row.localId)] = row.revisedAt;
      }, function (err) {
        if (libraryMissing(err)) throw err;
        keepFailure(outcome, key, stamp, err);
      });
    });
  }
  function pushAccountChanges() {
    var drops = userMap(WBLibrary.DROP_KEY, libraryUserId);
    var changes = WBLibrary.pushChanges(data.workouts, drops, libraryAck);
    return eachStep(changes, function (change, outcome) {
      var key = String(change.localId);
      var stamp = changeStamp(change);
      var held = heldRejection(key, stamp);
      if (held) { rememberHeld(outcome, held); return; }
      return Promise.resolve().then(function () {
        return WBAuth.accountPush(change);
      }).then(function (row) {
        clearRejection(key);
        if (row && row.localId) libraryAck[String(row.localId)] = row.revisedAt;
        if (change.deleted && row && !row.deleted && WBLibrary.ms(row.revisedAt) > change.revisedAt) {
          applyLibraryRows([row]);
        }
      }, function (err) {
        if (libraryMissing(err)) throw err;
        keepFailure(outcome, key, stamp, err);
      });
    });
  }
  function queueKey(item) {
    return 'q:' + (item && item.ownerId || '') + ':' + (item && item.kind || '') + ':' + (item && item.localId || '');
  }
  function queueStamp(item) {
    return WBLibrary.bodyStamp({
      name: item && item.name || '',
      items: item && item.items || [],
      deleted: !!(item && item.deleted),
      change: item && item.change || null,
      gen: item && item.gen || 0
    });
  }
  function flushClientQueue() {
    var queue = clientQueue.slice();
    return eachStep(queue, function (item, outcome) {
      var key = queueKey(item);
      var stamp = queueStamp(item);
      var held = heldRejection(key, stamp);
      if (held) { rememberHeld(outcome, held); return; }
      var call = item.kind === 'sent'
        ? (item.deleted ? WBAuth.deleteClientCopy(item.localId) : WBAuth.saveClientCopy(item.localId, item.name, item.items))
        : WBAuth.saveClientWorkout(item.ownerId, item.change);
      if (!call) return;
      return Promise.resolve(call).then(function () {
        clearRejection(key);
        clientQueue = WBLibrary.queueDrop(clientQueue, item);
        writeUserMap(WBLibrary.QUEUE_KEY, libraryUserId, clientQueue);
      }, function (err) {
        if (libraryMissing(err)) throw err;
        keepFailure(outcome, key, stamp, err);
      });
    });
  }
  function pullAccount() {
    function read(data) { return WBLibrary.rowsFromPull(data); }
    return Promise.resolve().then(function () {
      return WBAuth.accountPull();
    }).then(read, function (err) {
      if (!WBAuth.freshSession || !window.WBLibrary || WBLibrary.syncFailure(err) !== 'auth') throw err;
      return WBAuth.freshSession().then(function () {
        return WBAuth.accountPull();
      }).then(read);
    });
  }
  function runAccountSync() {
    if (!window.WBLibrary || !WBAuth.accountPull || !WBAuth.accountImport || !WBAuth.accountPush) return Promise.resolve();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (libraryUserId || libraryOwner()) setLibraryStatus('offline', '');
      paintLibraryStatus();
      return Promise.resolve();
    }
    var readSession = WBAuth.freshSession || WBAuth.session;
    var pending;
    try { pending = readSession(); } catch (e) { return Promise.resolve(); }
    var beforeSig = listSig(data.workouts);
    return Promise.resolve(pending).then(function (session) {
      var userId = accountUserId(session);
      if (!userId) return;
      var switching = !!(libraryOwner() && libraryOwner() !== userId);
      adoptAccount(userId);
      if (!switching) {
        absorbUserDrops(userMap(WBLibrary.DROP_KEY, '_pending'));
        absorbUserDrops(pendingDrops);
        writeUserMap(WBLibrary.DROP_KEY, '_pending', {});
        [userMap(WBLibrary.QUEUE_KEY, '_pending'), userMap(WBLibrary.QUEUE_KEY, libraryUserId)].forEach(function (list) {
          if (!Array.isArray(list)) return;
          list.forEach(function (item) { clientQueue = WBLibrary.queueUpsert(clientQueue, item); });
        });
        writeUserMap(WBLibrary.QUEUE_KEY, libraryUserId, clientQueue);
        writeUserMap(WBLibrary.QUEUE_KEY, '_pending', []);
      } else {
        var storedQueue = userMap(WBLibrary.QUEUE_KEY, libraryUserId);
        clientQueue = Array.isArray(storedQueue) ? storedQueue : [];
      }
      // The one-time copy is only the library already on this device.
      // Workouts that arrive from the account are not copied back as if this phone built them.
      if (!readSeed(libraryUserId)) writeUserMap(LIBRARY_SEED_KEY, libraryUserId, WBLibrary.seedIds(null, data.workouts));
      return pullAccount().then(function (rows) {
        try { applyLibraryRows(rows); }
        catch (err) { return { pullError: err }; }
        return { rows: rows };
      }, function (err) {
        return { pullError: err };
      }).then(function (pulled) {
        var outcome = blankOutcome();
        if (pulled && pulled.pullError) noteFailure(outcome, pulled.pullError);
        if (outcome.missing || outcome.auth || outcome.offline) return outcome;
        return importPending().then(function (imported) {
          mergeOutcome(outcome, imported);
          if (outcome.missing || outcome.auth) return outcome;
          return pushAccountChanges().then(function (pushed) {
            mergeOutcome(outcome, pushed);
            if (outcome.missing || outcome.auth) return outcome;
            return flushClientQueue().then(function (flushed) {
              mergeOutcome(outcome, flushed);
              return outcome;
            });
          });
        });
      });
    }).then(function (outcome) {
      if (!outcome) return;
      applyOutcome(outcome);
      // A refused save must not hide workouts the account just sent.
      finishLibraryView(beforeSig);
    }).catch(function (err) {
      if (libraryMissing(err)) { libraryOff = true; setLibraryStatus('', ''); paintLibraryStatus(); return; }
      var outcome = blankOutcome();
      noteFailure(outcome, err);
      applyOutcome(outcome);
      finishLibraryView(beforeSig);
    });
  }
  function scheduleAccountSync() {
    if (libraryOff || applyingLibrary || !window.WBLibrary || !WBAuth.accountPull) return;
    if (libraryFlight) { libraryAgain = true; return; }
    libraryAgain = false;
    libraryFlight = runAccountSync().then(finishSync, finishSync);
    function finishSync() {
      libraryFlight = null;
      if (libraryAgain && !libraryOff) { libraryAgain = false; scheduleAccountSync(); }
    }
  }
  function enqueueClient(item) {
    if (!window.WBLibrary || !item) return;
    clientQueue = WBLibrary.queueUpsert(clientQueue, item);
    writeUserMap(WBLibrary.QUEUE_KEY, libraryUserId || '_pending', clientQueue);
    scheduleAccountSync();
  }
  function scheduleGuestSave() {
    if (!window.WBLibrary) return;
    guests.forEach(function (w) {
      if (!w || w.remoteLocked || !w.remoteOwnerId) return;
      var stamp = (w.name || '') + '|' + (w.updatedAt || 0);
      try { stamp += JSON.stringify(w.items || []); } catch (e) { return; }
      if (guestStamp[w.id] === stamp) return;
      guestStamp[w.id] = stamp;
      guestGen[w.id] = (guestGen[w.id] || 0) + 1;
      var gen = guestGen[w.id];
      if (w.sentCopy) {
        enqueueClient({ ownerId: w.remoteOwnerId, kind: 'sent', localId: String(w.id), name: w.name, items: w.items, deleted: false, gen: gen });
      } else {
        enqueueClient({
          ownerId: w.remoteOwnerId,
          kind: 'account',
          localId: String(w.id),
          change: WBLibrary.changeFrom(w, false),
          gen: gen
        });
      }
    });
  }
  function rememberGuest(w) {
    if (!w || !w.id) return;
    guests = guests.filter(function (g) { return !g || String(g.id) !== String(w.id); });
    guests.push(w);
  }
  function renderLocked(w) {
    titleEl.textContent = w.name;
    backBtn.hidden = false;
    if (w.remoteOwnerId && window.WBLibrary) {
      app.innerHTML = WBLibrary.viewOnlyHtml(w);
    } else {
      app.innerHTML = window.WBSends ? WBSends.lockedHtml(w) : '<p class="mute" id="copy-note">You can run this copy.</p>';
    }
    app.onclick = function (e) {
      if (!e.target.closest('#copy-run')) return;
      if (!workoutRunnable(w)) { toast(RUN_NEEDS_NUMBERS); return; }
      go('#/play/' + w.id);
    };
    app.oninput = null;
    app.onchange = null;
  }
  var pendingSignNotice = null, authBusy = false, planBusy = false;
  // recoveryPhase: '' | 'checking' | 'form' | 'invalid' | 'done'
  var recoveryPhase = '', recoverySettled = false, recoveryReady = false;
  var RECOVERY_LOCK = 'wb.recovery';
  var RESET_SENT = 'If that email has an account, a reset link is on its way. Check your inbox and spam.';
  var RESET_INVALID = 'This reset link is invalid or has expired.';
  var RESET_UNREAD = 'Could not check your reset link. Try again.';
  var recoveryMessage = '';
  // The URL tokens are removed once the link is accepted, but the recovery
  // session stays in the browser. Remember that here so a reload still asks
  // for a new password instead of opening the app.
  function recoveryLocked() {
    try { return localStorage.getItem(RECOVERY_LOCK) === '1'; } catch (e) { return false; }
  }
  function lockRecovery() {
    try { localStorage.setItem(RECOVERY_LOCK, '1'); } catch (e) {}
  }
  function unlockRecovery() {
    try { localStorage.removeItem(RECOVERY_LOCK); } catch (e) {}
  }
  function openAccount() {
    var from = hashPage();
    WBAuth.session().then(function (session) {
      if (hashPage() !== from) return;
      if (!session) return goSignedOutHome();
      WBAuth.profile().then(function (profile) {
        if (hashPage() !== from) return;
        go(WBMembership.hasDesignated(profile) ? '#/account' : '#/subscriptions');
      }).catch(function () { if (hashPage() === from) go('#/subscriptions'); });
    }).catch(function () { if (hashPage() === from) go('#/signin'); });
  }
  function afterSignIn() {
    signedInNow = true;
    if (!onAuthPage()) return;
    var pending;
    try { pending = WBAuth.session(); } catch (e) { return go('#/subscriptions'); }
    if (!pending || !pending.then) return go('#/subscriptions');
    // Redeeming happens once inside the signed-in route, including before approval.
    pending.then(function (session) {
      if (!onAuthPage()) return;
      if (!session) return goSignedOutHome();
      go('#/');
    }).catch(function () { if (onAuthPage()) go('#/subscriptions'); });
  }
  function showSignInNotice(text, isError) {
    var here = hashPage();
    if (here !== 'signin' && here !== 'join' && here !== 'subscriptions') return;
    pendingSignNotice = { text: text, isError: !!isError };
    if (here === 'signin') renderSign('in');
    else go('#/signin');
  }
  // Cloudflare does not support SRI for this script. Explicit rendering needs ?render=explicit.
  var TURNSTILE_API = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var CAPTCHA_EXPIRED = 'That check expired. Please try again.';
  var CAPTCHA_FAILED = 'The check did not go through. Please try again.';
  var captchaToken = '', captchaWidgetId = null, captchaSerial = 0, captchaHold = false, captchaResetting = false, turnstileLoader = null;
  function turnstileSiteKey() {
    var key = window.WBAuth && WBAuth.TURNSTILE_SITE_KEY;
    return typeof key === 'string' ? key.trim() : '';
  }
  function captchaOn() { return !!turnstileSiteKey(); }
  function captchaBlocksSubmit() { return captchaOn() && !captchaToken; }
  function showCaptchaNote(text) {
    var note = document.getElementById('captcha-note');
    if (!note) return;
    if (!text) { note.hidden = true; note.textContent = ''; return; }
    note.hidden = false;
    note.textContent = text;
  }
  function syncAuthSubmit() {
    var btn = app.querySelector('[data-auth="up"], [data-auth="in"], [data-auth="send-reset"]');
    if (!btn) return;
    btn.disabled = !!(authBusy || captchaBlocksSubmit());
  }
  // The screen may have changed while the request was running. Drop the busy
  // flag and refresh the button that is on screen now. Do not touch that
  // screen's captcha token or hold flag.
  function finishAuthAttempt(startedOn) {
    authBusy = false;
    if (hashPage() === startedOn) return true;
    syncAuthSubmit();
    return false;
  }
  function discardCaptchaWidget() {
    captchaSerial += 1;
    captchaToken = '';
    captchaHold = false;
    var id = captchaWidgetId;
    captchaWidgetId = null;
    if (id != null && window.turnstile && window.turnstile.remove) {
      try { window.turnstile.remove(id); } catch (e) {}
    }
  }
  function resetCaptchaAfterAttempt() {
    if (!captchaOn()) return;
    captchaToken = '';
    if (!document.getElementById('turnstile-box') || captchaWidgetId == null || !window.turnstile || !window.turnstile.reset) {
      syncAuthSubmit();
      return;
    }
    if (captchaResetting) return;
    captchaResetting = true;
    try { window.turnstile.reset(captchaWidgetId); } catch (e) {}
    captchaResetting = false;
    syncAuthSubmit();
  }
  function captchaHtml() {
    if (!captchaOn()) return '';
    return '<div id="captcha-note" class="errs" hidden></div><div id="turnstile-box" class="turnstile-box"></div>';
  }
  function loadTurnstileScript() {
    if (!captchaOn()) return Promise.resolve(false);
    if (window.turnstile && window.turnstile.render) return Promise.resolve(true);
    if (turnstileLoader) return turnstileLoader;
    turnstileLoader = new Promise(function (resolve) {
      var existing = document.querySelector('script[data-wb-turnstile]');
      function finish(ok) {
        if (!ok) turnstileLoader = null;
        resolve(!!ok);
      }
      if (existing) {
        existing.addEventListener('load', function () { finish(window.turnstile && window.turnstile.render); });
        existing.addEventListener('error', function () { finish(false); });
        return;
      }
      var s = document.createElement('script');
      s.src = TURNSTILE_API;
      s.async = false;
      s.setAttribute('data-wb-turnstile', '1');
      s.onload = function () { finish(window.turnstile && window.turnstile.render); };
      s.onerror = function () {
        if (s.parentNode) s.parentNode.removeChild(s);
        finish(false);
      };
      document.head.appendChild(s);
    });
    return turnstileLoader;
  }
  function mountCaptcha() {
    if (!captchaOn()) return;
    var serial = captchaSerial;
    var box = document.getElementById('turnstile-box');
    if (!box) return;
    loadTurnstileScript().then(function (ok) {
      if (serial !== captchaSerial) return;
      if (!document.getElementById('turnstile-box')) return;
      if (!ok || !window.turnstile || !window.turnstile.render) {
        showCaptchaNote(CAPTCHA_FAILED);
        syncAuthSubmit();
        return;
      }
      function draw() {
        if (serial !== captchaSerial) return;
        var live = document.getElementById('turnstile-box');
        if (!live || !window.turnstile) return;
        var width = live.getBoundingClientRect().width || 0;
        if (width < 40) width = (window.innerWidth || 0) - 24;
        try {
          captchaWidgetId = window.turnstile.render(live, {
            sitekey: turnstileSiteKey(),
            theme: 'light',
            // Managed widget. Flexible fills the form on a phone; compact fits a narrower one.
            size: width >= 300 ? 'flexible' : 'compact',
            appearance: 'always',
            callback: function (token) {
              if (serial !== captchaSerial || captchaHold) return;
              captchaToken = token || '';
              if (captchaToken) showCaptchaNote('');
              syncAuthSubmit();
            },
            'expired-callback': function () {
              if (serial !== captchaSerial || captchaHold) return;
              captchaToken = '';
              showCaptchaNote(CAPTCHA_EXPIRED);
              syncAuthSubmit();
              if (!captchaResetting && window.turnstile && captchaWidgetId != null) {
                captchaResetting = true;
                try { window.turnstile.reset(captchaWidgetId); } catch (e) {}
                captchaResetting = false;
              }
            },
            'error-callback': function () {
              if (serial !== captchaSerial || captchaHold) return;
              captchaToken = '';
              showCaptchaNote(CAPTCHA_FAILED);
              syncAuthSubmit();
            },
            'timeout-callback': function () {
              if (serial !== captchaSerial || captchaHold) return;
              captchaToken = '';
              showCaptchaNote(CAPTCHA_EXPIRED);
              syncAuthSubmit();
            }
          });
        } catch (e) {
          showCaptchaNote(CAPTCHA_FAILED);
        }
        syncAuthSubmit();
      }
      // Render from the script onload. turnstile.ready() rejects when the tag is async.
      draw();
    }).catch(function () {
      if (serial !== captchaSerial) return;
      showCaptchaNote(CAPTCHA_FAILED);
      syncAuthSubmit();
    });
  }
  function authErrorText(err) {
    var msg = (err && err.message) || 'Could not reach sign-in';
    if (/captcha/i.test(msg)) return CAPTCHA_FAILED;
    return msg;
  }
  // A local typo has not used the captcha token. Show the error and leave the
  // email, passwords, and widget in place. Rebuilding the form would throw
  // the unused token away and make the person start the check again.
  function keepAuthForm(message) {
    var gate = app.querySelector('.gate');
    if (!gate) return false;
    var box = document.getElementById('auth-error');
    if (!box || !gate.contains(box)) box = null;
    if (!box) {
      var banners = gate.querySelectorAll('.errs');
      for (var i = 0; i < banners.length; i++) {
        if (banners[i].id === 'captcha-note') continue;
        box = banners[i];
        break;
      }
    }
    if (!box) {
      box = document.createElement('div');
      gate.insertBefore(box, gate.firstChild);
    }
    box.id = 'auth-error';
    box.className = 'errs';
    box.hidden = false;
    box.textContent = message || '';
    var extras = gate.querySelectorAll('.errs');
    for (var j = 0; j < extras.length; j++) {
      if (extras[j] !== box && extras[j].id !== 'captcha-note' && extras[j].parentNode) extras[j].parentNode.removeChild(extras[j]);
    }
    return true;
  }
  function renderSign(mode, message, isError) {
    var create = mode === 'up';
    discardCaptchaWidget();
    if (create) pendingSignNotice = null;
    else if (message != null) pendingSignNotice = { text: message, isError: !!isError };
    if (!create && pendingSignNotice) { message = pendingSignNotice.text; isError = pendingSignNotice.isError; }
    titleEl.textContent = create ? 'Create account' : 'Sign in';
    backBtn.hidden = true;
    var h = '<div class="gate">';
    if (message) h += '<div id="auth-error" class="' + (isError ? 'errs' : 'card') + '">' + esc(message) + '</div>';
    h += '<h2>' + (create ? 'Create your account' : 'Sign in') + '</h2>';
    h += '<p class="lede">Built for trainers and the people they coach.</p>';
    h += '<label for="acct-email">Email</label><input id="acct-email" type="email" autocomplete="username">';
    h += '<label for="acct-pass">Password</label><input id="acct-pass" type="password" autocomplete="' + (create ? 'new-password' : 'current-password') + '">';
    if (create) h += '<label for="confirm-pass">Confirm password</label><input id="confirm-pass" type="password" autocomplete="new-password">';
    if (create) h += '<label for="invite-code">Invite code</label><input id="invite-code" autocomplete="off" value="' + esc(WBInvites.formatCode(pendingCode())) + '">';
    h += captchaHtml();
    h += '<div class="actions"><button class="pri" data-auth="' + (create ? 'up' : 'in') + '" style="width:100%"' + (authBusy || captchaBlocksSubmit() ? ' disabled' : '') + '>' + (create ? 'Create account' : 'Sign in') + '</button></div>';
    if (!create) h += '<button class="linkish" data-auth="forgot">Forgot password?</button>';
    h += create
      ? '<button class="linkish" data-auth="switch" data-mode="in">Already have an account? Sign in</button>'
      : '<button class="linkish" data-auth="switch" data-mode="up">Create an account</button>';
    h += '</div>';
    app.innerHTML = h;
    app.onclick = function (e) {
      var b = e.target.closest('[data-auth]'); if (!b) return;
      if (b.dataset.auth === 'forgot') return go('#/forgot');
      if (b.dataset.auth === 'switch') {
        var dest = b.dataset.mode === 'up' ? '#/join' : '#/signin';
        if (location.hash === dest) return route();
        return go(dest);
      }
      if (authBusy) return;
      var emailEl = document.getElementById('acct-email'), passEl = document.getElementById('acct-pass'), codeEl = document.getElementById('invite-code');
      var email = emailEl ? emailEl.value.trim() : '', password = passEl ? passEl.value : '';
      var enteredCode = '';
      // Sign-in has no code box. Leave a captured code in place for the fallback redeem.
      if (create && codeEl) {
        enteredCode = WBInvites.normalizeCode(codeEl.value);
        rememberCode(enteredCode);
      }
      // New passwords must be at least 10 characters. Signing in still allows
      // a shorter password that was already saved, so those accounts are not locked out.
      if (!email || password.length < (create ? 10 : 6)) {
        var shortMsg = create
          ? 'Enter your email and a password of at least 10 characters.'
          : 'Enter your email and a password of at least 6 characters.';
        if (!create) pendingSignNotice = { text: shortMsg, isError: true };
        if (keepAuthForm(shortMsg)) return;
        return renderSign(create ? 'up' : 'in', shortMsg, true);
      }
      if (create) {
        var confirmEl = document.getElementById('confirm-pass');
        var confirm = confirmEl ? confirmEl.value : '';
        if (password !== confirm) {
          if (keepAuthForm("Passwords don't match.")) return;
          return renderSign('up', "Passwords don't match.", true);
        }
      }
      if (captchaBlocksSubmit()) {
        showCaptchaNote(CAPTCHA_FAILED);
        syncAuthSubmit();
        return;
      }
      authBusy = true; b.disabled = true;
      var startedOn = hashPage();
      var op = b.dataset.auth === 'up'
        ? WBAuth.signUp(email, password, captchaOn() ? captchaToken : '', enteredCode)
        : (captchaOn() ? WBAuth.signIn(email, password, captchaToken) : WBAuth.signIn(email, password));
      op.then(function (result) {
        if (!finishAuthAttempt(startedOn)) return;
        captchaHold = true;
        resetCaptchaAfterAttempt();
        if (b.dataset.auth === 'up' && result.needsConfirmation) return showSignInNotice('Check your email to confirm the account, then sign in.');
        afterSignIn();
      }).catch(function (err) {
        if (!finishAuthAttempt(startedOn)) return;
        resetCaptchaAfterAttempt();
        renderSign(startedOn === 'join' ? 'up' : 'in', authErrorText(err), true);
      });
    };
    mountCaptcha();
  }
  function resetSendError(err) {
    var msg = (err && err.message) || '';
    if (/captcha/i.test(msg)) return CAPTCHA_FAILED;
    if (/could not load sign-in|sign-in library|failed to fetch|networkerror|load failed/i.test(msg)) {
      return 'Could not send the reset link. Check your connection and try again.';
    }
    if (/valid email|unable to validate email|invalid email/i.test(msg)) return 'Enter a valid email.';
    return '';
  }
  function renderForgot(message, isError, email) {
    discardCaptchaWidget();
    titleEl.textContent = 'Forgot password';
    backBtn.hidden = true;
    var sent = message && !isError;
    var h = '<div class="gate">';
    if (message && isError) h += '<div id="auth-error" class="errs">' + esc(message) + '</div>';
    h += sent
      ? '<h2>Check your email</h2><p class="lede">' + esc(message) + '</p>'
      : '<h2>Forgot password</h2><p class="lede">We\'ll email you a link to choose a new password.</p>';
    if (!sent) {
      h += '<label for="reset-email">Email</label><input id="reset-email" type="email" autocomplete="username" value="' + esc(email || '') + '">';
      h += captchaHtml();
      h += '<div class="actions"><button class="pri" data-auth="send-reset" style="width:100%"' + (authBusy || captchaBlocksSubmit() ? ' disabled' : '') + '>Send reset link</button></div>';
    }
    h += '<button class="linkish" data-auth="back-signin">Back to sign in</button></div>';
    app.innerHTML = h;
    app.oninput = null;
    app.onchange = null;
    app.onclick = function (e) {
      var b = e.target.closest('[data-auth]'); if (!b) return;
      if (b.dataset.auth === 'back-signin') return go('#/signin');
      if (b.dataset.auth !== 'send-reset' || authBusy) return;
      var emailEl = document.getElementById('reset-email');
      var entered = emailEl ? emailEl.value.trim() : '';
      if (!entered || entered.indexOf('@') < 1) {
        if (keepAuthForm('Enter your email.')) return;
        return renderForgot('Enter your email.', true, entered);
      }
      if (captchaBlocksSubmit()) {
        showCaptchaNote(CAPTCHA_FAILED);
        syncAuthSubmit();
        return;
      }
      authBusy = true; b.disabled = true;
      var started = hashPage();
      var reset = captchaOn() ? WBAuth.requestPasswordReset(entered, captchaToken) : WBAuth.requestPasswordReset(entered);
      reset.then(function () {
        if (!finishAuthAttempt(started)) return;
        captchaHold = true;
        resetCaptchaAfterAttempt();
        renderForgot(RESET_SENT, false);
      }).catch(function (err) {
        if (!finishAuthAttempt(started)) return;
        resetCaptchaAfterAttempt();
        var shown = resetSendError(err);
        if (!shown) return renderForgot(RESET_SENT, false);
        renderForgot(shown, true, entered);
      });
    };
    if (!sent) mountCaptcha();
  }
  function renderReset(message, isError, keepPass, keepConfirm) {
    titleEl.textContent = recoveryPhase === 'done' ? 'Password updated' : (recoveryPhase === 'checking' ? 'Checking your link' : 'Set a new password');
    backBtn.hidden = true;
    var h = '<div class="gate">';
    if (recoveryPhase === 'done') {
      h += '<h2>Password updated</h2><p class="lede">You\'re signed in.</p>';
    } else if (recoveryPhase === 'invalid') {
      h += '<h2>Set a new password</h2>';
      h += '<div class="errs">' + esc(message || RESET_INVALID) + '</div>';
      h += '<p class="lede">Request a new link, then open it in this browser.</p>';
      h += '<div class="actions"><button class="pri" data-auth="forgot" style="width:100%">Send a new reset link</button></div>';
      h += '<button class="linkish" data-auth="back-signin">Back to sign in</button>';
    } else if (recoveryPhase === 'retry') {
      h += '<h2>Set a new password</h2>';
      h += '<div class="errs">' + esc(message || recoveryMessage || RESET_UNREAD) + '</div>';
      h += '<div class="actions"><button class="pri" data-auth="retry-reset" style="width:100%">Try again</button></div>';
      h += '<button class="linkish" data-auth="back-signin">Back to sign in</button>';
    } else if (recoveryPhase === 'form') {
      h += '<h2>Set a new password</h2><p class="lede">Choose a new password for your account.</p>';
      if (message) h += '<div class="' + (isError ? 'errs' : 'card') + '">' + esc(message) + '</div>';
      h += '<label for="new-pass">New password</label><input id="new-pass" type="password" autocomplete="new-password" value="' + esc(keepPass || '') + '">';
      h += '<label for="confirm-pass">Confirm password</label><input id="confirm-pass" type="password" autocomplete="new-password" value="' + esc(keepConfirm || '') + '">';
      h += '<div class="actions"><button class="pri" data-auth="update-pass" style="width:100%"' + (authBusy || !recoveryReady ? ' disabled' : '') + '>Update password</button></div>';
      h += '<button class="linkish" data-auth="back-signin">Back to sign in</button>';
    } else {
      h += '<h2>Checking your link…</h2><p class="lede">This will only take a moment.</p>';
    }
    h += '</div>';
    app.innerHTML = h;
    app.oninput = null;
    app.onchange = null;
    app.onclick = function (e) {
      var b = e.target.closest('[data-auth]'); if (!b) return;
      if (b.dataset.auth === 'forgot') {
        unlockRecovery();
        recoverySettled = true;
        recoveryPhase = '';
        recoveryReady = false;
        return go('#/forgot');
      }
      if (b.dataset.auth === 'retry-reset') {
        recoveryPhase = '';
        recoveryMessage = '';
        if (WBAuth.recoveryArrival && WBAuth.recoveryArrival()) return beginRecovery(++routeToken);
        return resumeRecovery(++routeToken);
      }
      if (b.dataset.auth === 'back-signin') return abandonReset();
      if (b.dataset.auth !== 'update-pass' || authBusy || !recoveryReady) return;
      var passEl = document.getElementById('new-pass'), confirmEl = document.getElementById('confirm-pass');
      var password = passEl ? passEl.value : '', confirm = confirmEl ? confirmEl.value : '';
      if (password.length < 10) return renderReset('Enter a password of at least 10 characters.', true, password, confirm);
      if (password !== confirm) return renderReset('Those passwords do not match.', true, password, confirm);
      authBusy = true; b.disabled = true;
      var started = hashPage();
      WBAuth.updatePassword(password).then(function () {
        authBusy = false;
        if (hashPage() !== started && hashPage() !== 'reset') return;
        unlockRecovery();
        recoverySettled = true;
        recoveryReady = false;
        recoveryPhase = 'done';
        renderReset();
        afterSignIn();
      }).catch(function (err) {
        authBusy = false;
        if (hashPage() !== started && hashPage() !== 'reset') return;
        var msg = (err && err.message) || '';
        if (/expired|invalid|session/i.test(msg)) {
          unlockRecovery();
          recoveryPhase = 'invalid';
          recoverySettled = true;
          recoveryReady = false;
          return renderReset(RESET_INVALID, true);
        }
        renderReset(msg || 'Could not update the password.', true, password, confirm);
      });
    };
  }
  function abandonReset() {
    var mustSignOut = recoveryLocked() || (recoveryPhase === 'form' && recoveryReady);
    function goSign() {
      signedInNow = false;
      unlockRecovery();
      recoverySettled = true;
      recoveryPhase = '';
      recoveryReady = false;
      recoveryMessage = '';
      go('#/signin');
    }
    if (!mustSignOut || !WBAuth.signOut) return goSign();
    // Sign out before dropping the lock. A failed read can leave the recovery
    // session in place, and clearing the lock first would open the app.
    recoveryPhase = 'checking';
    recoverySettled = false;
    renderReset();
    Promise.resolve().then(function () { return WBAuth.signOut(); }).then(function () {
      forgetRequestBadges();
      goSign();
    }, function () {
      holdRecovery('Could not sign out. Stay here until the new password is set.');
    });
  }
  function holdRecovery(message) {
    recoveryMessage = message || RESET_UNREAD;
    recoveryPhase = 'retry';
    recoverySettled = false;
    recoveryReady = false;
    renderReset(recoveryMessage, true);
  }
  function replaceAuthHash(hash) {
    try {
      var u = new URL(location.href);
      ['code', 'access_token', 'refresh_token', 'token_hash', 'type', 'error', 'error_code', 'error_description', 'expires_in', 'expires_at', 'token_type', 'provider_token', 'provider_refresh_token'].forEach(function (k) {
        u.searchParams.delete(k);
      });
      var search = u.searchParams.toString();
      var next = u.pathname + (search ? '?' + search : '') + hash;
      history.replaceState(null, '', next);
    } catch (e) {
      if (location.hash !== hash) location.hash = hash;
    }
  }
  function accessApproved(profile, session) {
    var email = session && session.user && session.user.email;
    if (!email && profile) email = profile.email;
    if (window.WBProfile && WBProfile.isAdminEmail(email)) return true;
    // No profile yet: the gate still sends them to Subscriptions.
    if (!profile) return true;
    if (profile.access_approved === false) return false;
    if (profile.access_approved === true) return true;
    // A redeem cache is only a plan. A missing flag there is not approval.
    // A loaded profile with an explicit null still means the access column
    // is not on this database, so people are not locked out before that SQL.
    if (profile.access_approved == null && !profile.id && !profile.email && !Object.prototype.hasOwnProperty.call(profile, 'intended_plan')) return false;
    return true;
  }
  function renderAccessWait() {
    accessWaitOn = true;
    titleEl.textContent = 'Waiting for access';
    backBtn.hidden = true;
    showHeaderSignIn(false);
    app.innerHTML = '<div class="gate" id="access-wait"><h2>Waiting for access</h2><p class="lede">Your account is waiting for approval.</p><button type="button" class="pri" id="access-signout" style="width:100%">Sign out</button></div>';
    syncChrome();
    app.onclick = function (e) {
      if (e.target && e.target.closest && e.target.closest('#access-signout')) signOutFromAccount();
    };
    app.oninput = null;
    app.onchange = null;
  }
  function clientNeedsName(profile) {
    if (!window.WBProfile || !WBProfile.needsName(profile)) return false;
    if (!WBMembership.hasDesignated(profile)) return false;
    if (window.WBInvites && WBInvites.trainerRole(profile)) return false;
    return true;
  }
  function openSignedIn(token, requested, page) {
    var sessionP = WBAuth.session ? WBAuth.session() : Promise.resolve(null);
    Promise.resolve().then(function () { return sessionP; }).then(function (session) {
      return redeemStoredInvite(session).then(function () { return session; });
    }, function () {
      return redeemStoredInvite(null).then(function () { return null; });
    }).then(function (session) {
      return loadGateProfile().then(function (gate) {
        if (token !== routeToken || location.hash !== requested) return;
        // Approval still blocks the app. Linking already ran above.
        if (!accessApproved(gate.profile, session)) return renderAccessWait();
        accessWaitOn = false;
        var profile = cachedProfile || gate.profile;
        if (page === 'admin') return renderAdmin();
        if (gate.known && !WBMembership.hasDesignated(profile)) return go('#/subscriptions');
        if (clientNeedsName(profile)) {
          profileGateOn = false;
          closeProfileSheet(true);
          if (page !== 'account') return go('#/account');
          return renderSimpleAccount();
        }
        if (window.WBProfile && WBProfile.needsName(profile)) return showProfileGate(profile);
        profileGateOn = false;
        closeProfileSheet(true);
        syncHeaderSignOut();
        levelNoteOn = false;
        if (programsRequested()) return openPrograms();
        if (page === 'tracking') return renderTracking(token);
        if (page === 'history') return renderHistory(token);
        if (page === 'account') return renderSimpleAccount();
        if (page === 'messages') return openMessages(token);
        if (page === 'hub') return openHub(token);
        if (page === 'client') {
          if (!window.WBPrograms || !WBPrograms.isTrainer(WBPrograms.roleOf(profile))) return renderLevelNote(profile);
          return openClient(token);
        }
        if (page === 'circuits') {
          if (!window.WBPrograms || !WBPrograms.isTrainer(WBPrograms.roleOf(profile))) return renderLevelNote(profile);
          return openCircuits(token);
        }
        if (page === 'send') {
          if (!levelCan(profile, 'send')) return renderLevelNote(profile);
          return openSends(token);
        }
        if (page === 'received') {
          if (!hashBody().split('/')[1]) return go('#/');
          return openSends(token);
        }
        if (page === 'w' && !levelCan(profile, 'open')) {
          var opened = getW(hashBody().split('/')[1]);
          if (!(opened && opened.sourceTrainerId)) return renderLevelNote(profile);
        }
        showBuilder();
      });
    });
  }
  function beginRecovery(token) {
    var kind = WBAuth.recoveryArrival ? WBAuth.recoveryArrival() : '';
    if (kind === 'error') {
      unlockRecovery();
      recoveryPhase = 'invalid';
      recoverySettled = true;
      replaceAuthHash('#/reset');
      return renderReset();
    }
    if (kind === 'recovery') lockRecovery();
    recoveryPhase = 'checking';
    renderReset();
    var pending;
    try { pending = WBAuth.consumeAuthCallback ? WBAuth.consumeAuthCallback() : Promise.resolve({ kind: 'invalid' }); }
    catch (e) { pending = Promise.reject(e); }
    Promise.resolve(pending).then(function (result) {
      // The auth client may strip the code or hash while this is in flight.
      // A newer route() call (routeToken) means the person already left.
      if (token !== routeToken) return;
      if (result && result.kind === 'signed-in') {
        unlockRecovery();
        recoverySettled = true;
        recoveryPhase = '';
        recoveryReady = false;
        return openSignedIn(token, location.hash, hashPage());
      }
      if (result && result.kind === 'recovery') {
        lockRecovery();
        recoveryPhase = 'form';
        recoveryReady = true;
        replaceAuthHash('#/reset');
        return renderReset();
      }
      unlockRecovery();
      recoveryPhase = 'invalid';
      recoverySettled = true;
      recoveryReady = false;
      replaceAuthHash('#/reset');
      renderReset(result && result.message);
    }, function () {
      if (token !== routeToken) return;
      // The client may already have stored the recovery session. A failed
      // exchange is not proof that session is gone, so keep the lock.
      if (recoveryLocked()) return holdRecovery();
      recoveryPhase = 'invalid';
      recoverySettled = true;
      recoveryReady = false;
      replaceAuthHash('#/reset');
      renderReset();
    });
  }
  // A reload has no token left in the URL. The lock says this browser still
  // owes a new password; the saved session is what makes Update password work.
  function resumeRecovery(token) {
    recoveryPhase = 'checking';
    renderReset();
    var pending;
    try { pending = WBAuth.session ? WBAuth.session() : Promise.resolve(null); }
    catch (e) { pending = Promise.reject(e); }
    Promise.resolve(pending).then(function (session) {
      if (token !== routeToken) return;
      if (session) {
        recoveryPhase = 'form';
        recoveryReady = true;
        if (hashPage() !== 'reset') replaceAuthHash('#/reset');
        return renderReset();
      }
      unlockRecovery();
      recoveryPhase = 'invalid';
      recoverySettled = true;
      recoveryReady = false;
      if (hashPage() !== 'reset') replaceAuthHash('#/reset');
      renderReset();
    }, function () {
      if (token !== routeToken) return;
      holdRecovery();
    });
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
      var trainerName = personLabel({ name: conn.trainerName, display_name: conn.trainerName, plan: 'Trainer' }) || 'Trainer';
      h += '<div class="name">Your trainer</div><p class="mute">' + (window.WBProfile ? WBProfile.nameHtml(trainerName, !!conn.verified) : esc(trainerName)) + '</p>';
      h += '<button class="danger" data-invite="end-self" style="width:100%">End connection</button>';
    }
    h += '<label for="invite-code">Invite code</label><input id="invite-code" autocomplete="off" value="' + esc(WBInvites.formatCode(pendingCode())) + '">';
    if (!linked && window.WBInvites && window.WBSharing && WBInvites.isEnthusiast(profile)) h += WBSharing.linkOption(linkShareChoice);
    h += '<button class="pri" data-invite="redeem" style="width:100%;margin-top:10px">Redeem invite</button></div>';
    return h;
  }
  function noteProfile(profile) {
    var id = profile && profile.id;
    if (shareUser && id && shareUser !== id && window.WBSharing) {
      shareState = WBSharing.initialState();
      resetShareLookup();
    }
    if (id) shareUser = id;
    if (profile) cachedProfile = profile;
  }
  function stopShareRetry() {
    if (shareRetryTimer) { clearTimeout(shareRetryTimer); shareRetryTimer = null; }
  }
  function resetShareLookup() {
    shareLoadGen++;
    shareLookup = null;
    shareSessionFlight = false;
    shareRetryWait = 1000;
    stopShareRetry();
  }
  function shareAnswered() {
    if (!shareState) return false;
    if (shareState.busy || shareState.phase === 'unavailable') return true;
    return typeof shareState.confirmed === 'boolean' && shareState.phase === 'ready';
  }
  function armShareRetry() {
    if (shareRetryTimer || shareLookup || shareSessionFlight || shareAnswered()) return;
    var wait = shareRetryWait;
    shareRetryWait = Math.min(shareRetryWait * 2, 15000);
    shareRetryTimer = setTimeout(function () {
      shareRetryTimer = null;
      ensureShare();
    }, wait);
  }
  function afterShareLookup(ok) {
    if (!shareState || !window.WBSharing) return;
    if (shareState.busy) return;
    if (shareState.phase === 'unavailable') { stopShareRetry(); return; }
    if (ok === true && typeof shareState.confirmed === 'boolean' && shareState.phase === 'ready') {
      shareRetryWait = 1000;
      stopShareRetry();
      if (WBSharing.shouldPush(shareState)) scheduleSharePush();
      else { pushPending = false; stopPushRetry(); }
      return;
    }
    if (typeof shareState.confirmed !== 'boolean' || shareState.phase !== 'ready') armShareRetry();
  }
  function ensureShare() {
    if (!window.WBSharing || !shareState || !WBAuth.shareSetting || !WBAuth.session) return;
    if (shareAnswered() || shareLookup || shareSessionFlight) return;
    stopShareRetry();
    shareSessionFlight = true;
    var pending;
    try { pending = WBAuth.session(); } catch (e) { shareSessionFlight = false; armShareRetry(); return; }
    Promise.resolve(pending).then(function (session) {
      shareSessionFlight = false;
      if (!session || shareAnswered() || shareLookup) return;
      loadShare();
    }, function () {
      shareSessionFlight = false;
      if (!shareAnswered()) armShareRetry();
    });
  }
  function paintShare() {
    var slot = document.getElementById('share-slot');
    if (!slot || !window.WBSharing) return;
    slot.innerHTML = WBSharing.accountCard(shareState);
  }
  function loadShare() {
    if (!window.WBSharing) return Promise.resolve();
    if (shareState && shareState.busy) { paintShare(); return shareLookup || Promise.resolve(); }
    if (shareLookup) return shareLookup;
    if (!WBAuth.shareSetting) {
      shareState = WBSharing.reduce(shareState, { type: 'load-unavailable' });
      paintShare();
      stopShareRetry();
      return Promise.resolve();
    }
    stopShareRetry();
    var gen = ++shareLoadGen;
    var seenSave = shareSaveGen;
    shareState = WBSharing.reduce(shareState, { type: 'load-start' });
    paintShare();
    var pending;
    try { pending = WBAuth.shareSetting(); } catch (e) { pending = Promise.reject(e); }
    var run = Promise.resolve(pending).then(function (row) {
      if (shareLookup === run) shareLookup = null;
      if (gen !== shareLoadGen || seenSave !== shareSaveGen || (shareState && shareState.busy)) return;
      var parsed = WBSharing.parseSetting(row);
      shareState = WBSharing.reduce(shareState, {
        type: 'load-ok',
        on: parsed.ok ? parsed.on : null,
        enthusiast: parsed.ok && typeof parsed.enthusiast === 'boolean' ? parsed.enthusiast : undefined
      });
      paintShare();
      afterShareLookup(parsed.ok === true);
    }, function (err) {
      if (shareLookup === run) shareLookup = null;
      if (gen !== shareLoadGen || seenSave !== shareSaveGen || (shareState && shareState.busy)) return;
      shareState = WBSharing.reduce(shareState, WBSharing.isUnavailable(err)
        ? { type: 'load-unavailable', message: err && err.message }
        : { type: 'load-error', message: (err && err.message) || 'Could not load sharing.' });
      paintShare();
      afterShareLookup(false);
    });
    shareLookup = run;
    return run;
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
      try {
        apply();
      } catch (e) {
        shareState = WBSharing.reduce(shareState, { type: 'save-fail', message: (e && e.message) || 'Could not save that choice.' });
        toast('Could not save that choice.');
      }
      if (shareState && shareState.busy) {
        shareState = WBSharing.reduce(shareState, { type: 'save-fail', message: 'Could not save that choice.' });
      }
      paintShare();
      if (shareState && window.WBSharing && WBSharing.shouldPush(shareState)) scheduleSharePush();
      else { pushPending = false; stopPushRetry(); }
    }
    var pending;
    try { pending = WBAuth.setShare(next); } catch (e) { pending = Promise.reject(e); }
    Promise.resolve(pending).then(function (row) {
      finishSave(function () {
        var parsed = WBSharing.parseSetting(row);
        shareState = WBSharing.reduce(shareState, {
          type: 'save-ok',
          on: parsed.ok ? parsed.on : null,
          enthusiast: parsed.ok && typeof parsed.enthusiast === 'boolean' ? parsed.enthusiast : undefined
        });
        if (!parsed.ok) toast('Could not confirm that choice.');
      });
    }, function (err) {
      finishSave(function () {
        if (WBSharing.isUnavailable(err)) {
          shareState = WBSharing.reduce(shareState, { type: 'save-unavailable', message: err && err.message });
        } else {
          shareState = WBSharing.reduce(shareState, { type: 'save-fail', message: (err && err.message) || 'Could not save that choice.' });
          toast((err && err.message) || 'Could not save that choice.');
        }
      });
    });
  }
  function stopPushRetry() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  }
  function retrySharePush() {
    if (pushTimer || pushFlight || !pushPending) return;
    var wait = pushWait;
    pushWait = Math.min(pushWait * 2, 15000);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      if (!pushPending || !window.WBSharing || !WBSharing.shouldPush(shareState)) return;
      scheduleSharePush();
    }, wait);
  }
  function scheduleSharePush(force) {
    if (!window.WBSharing || !WBAuth.pushOwn) return;
    if (shareState && shareState.busy) { pushPending = true; return; }
    var open = shareState && shareState.confirmed === true && shareState.phase === 'ready' && shareState.enthusiast !== false;
    if (force === true && open) {
      /* caller already confirmed this push */
    } else if (!WBSharing.shouldPush(shareState)) {
      if (shareState && !shareAnswered()) { pushPending = true; ensureShare(); return; }
      pushPending = false;
      stopPushRetry();
      return;
    }
    if (pushFlight) { pushPending = true; return; }
    stopPushRetry();
    var log = WBSharing.readLog(localStorage);
    var body = WBSharing.payload(data, log);
    if (!body) { pushPending = true; return; }
    pushPending = false;
    var run = Promise.resolve().then(function () { return WBAuth.pushOwn(body.workouts, body.sessions); });
    pushFlight = run.then(function () {
      pushFlight = null;
      pushWait = 1000;
      if (shareState && shareState.busy) return;
      if (pushPending && WBSharing.shouldPush(shareState)) scheduleSharePush();
    }, function () {
      pushFlight = null;
      if (shareState && shareState.busy) { pushPending = true; return; }
      if (!window.WBSharing || !WBSharing.shouldPush(shareState)) { pushPending = false; return; }
      pushPending = true;
      retrySharePush();
    });
  }
  function capturePlayedSession() {
    try {
      var player = window.__wbPlayer;
      if (!player || !window.WBSharing) return;
      if (player.track === false) { player.done = null; return; }
      if (!player.done) return;
      var done = player.done;
      rememberProgramSession(done);
      var own = WBSharing.classifySession(done, player.w);
      if (own !== true) {
        player.done = null;
        return;
      }
      var stored = WBSharing.rememberSession(localStorage, done, player.w);
      if (!stored && WBSharing.readLog(localStorage) == null) return;
      player.done = null;
      if (stored) {
        ensureShare();
        if (WBSharing.shouldPush(shareState)) scheduleSharePush();
      }
    } catch (e) {}
  }
  function rememberProgramSession(done) {
    if (!done || !done.programId || !Array.isArray(done.results) || !done.results.length) return;
    if (!data.sessions) data.sessions = [];
    if (data.sessions.some(function (row) { return row && row.id === done.id; })) return;
    data.sessions.push({
      id: done.id,
      workoutId: done.workoutId,
      workoutName: done.workoutName,
      startedAt: done.startedAt,
      endedAt: done.endedAt,
      results: done.results,
      ownWork: done.ownWork,
      programId: done.programId
    });
    persistLocal();
  }
  function initialsOf(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
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
      h += '<div class="card flat" data-open-invite="' + esc(inv.code) + '"><div class="invite-code">' + esc(WBInvites.formatCode(inv.code)) + '</div>';
      h += '<p class="mute">' + esc(WBInvites.timeLeft(inv.expiresAt, Date.now())) + '</p>';
      h += '<p class="mute invite-url">' + esc(link) + '</p><div class="actions">';
      h += '<button class="sm" data-invite="copy-code" data-code="' + esc(inv.code) + '">Copy code</button>';
      h += '<button class="sm" data-invite="copy-link" data-link="' + esc(link) + '">Copy link</button>';
      h += '<button class="sm danger" data-invite="cancel" data-code="' + esc(inv.code) + '">Cancel</button></div></div>';
    });
    h += '<div class="name" style="margin-top:12px">Clients</div>';
    if (!roster.clients.length) h += '<p class="mute">No clients yet.</p>';
    roster.clients.forEach(function (c, i) {
      var label = personLabel(c) || 'Client';
      var tone = 'c' + ((i % 7) + 1);
      h += '<div class="client-row"><span class="av ' + tone + '">' + esc(initialsOf(label)) + '</span>';
      h += '<div class="grow"><b>' + esc(label) + '</b><div class="mute">' + esc(c.plan) + '</div></div>';
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
        releaseInvite(code);
        if (res && res.shareStored === true && typeof share === 'boolean' && window.WBSharing) {
          shareState = WBSharing.reduce(shareState, { type: 'redeemed', on: share, enthusiast: true });
          if (WBSharing.shouldPush(shareState)) scheduleSharePush(true);
        }
        pendingInviteNotice = { text: (res && res.message) || 'Invite applied.', isError: false };
        redraw();
      }).catch(fail);
      return true;
    }
    return false;
  }
  function personLabel(row) {
    if (window.WBProfile) return WBProfile.label(row);
    if (!row) return '';
    var name = String(row.display_name || row.trainerName || row.name || '').replace(/^\s+|\s+$/g, '');
    if (name && name.indexOf('@') === -1) return name;
    return '';
  }
  function trainerFrom(w) {
    if (window.WBProfile) return WBProfile.fromTrainer(w);
    var name = w && String(w.sourceTrainerName || '').replace(/^\s+|\s+$/g, '');
    if (name && name.indexOf('@') === -1) return name;
    return '';
  }
  // The signed-in person may see their own address. Nobody else does.
  function signedInLabel(profile, session) {
    var named = personLabel({ display_name: profile && profile.display_name });
    if (named) return named;
    var email = session && session.user && String(session.user.email || '').replace(/^\s+|\s+$/g, '');
    return email || 'Signed in';
  }
  function syncHeaderSignOut() {
    var link = document.getElementById('account-signout');
    if (!link) return;
    var bare = document.documentElement.classList.contains('wb-bare');
    link.hidden = bare || !(hashPage() === 'account' || profileGateOn);
  }
  // Signed-out pages have no header Sign in. The landing page carries that link.
  function showHeaderSignIn() {
    var link = document.getElementById('header-signin');
    if (!link) return;
    link.hidden = true;
  }
  function paintAccountMe(profile) {
    var el = document.getElementById('account-me');
    if (!el || el.hidden) return;
    var name = personLabel({ display_name: profile && profile.display_name });
    var initials = '';
    if (name) {
      var parts = name.split(/\s+/).filter(Boolean);
      if (parts.length === 1) initials = parts[0].slice(0, 2).toUpperCase();
      else initials = (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    if (initials) el.textContent = initials;
    else el.innerHTML = window.WBProfile ? WBProfile.personIcon() : '';
  }
  function syncChrome() {
    var page = hashPage();
    var landingOn = document.documentElement.classList.contains('wb-landing');
    var bare = landingOn || accessWaitOn || page === 'signin' || page === 'join' || page === 'forgot' || page === 'reset';
    document.documentElement.classList.toggle('wb-bare', bare);
    var parts = hashBody().split('/');
    var live = page === 'circuits' && parts[2] === 'run';
    var player = page === 'play' || page === 'view' || document.body.classList.contains('playing');
    var gate = page === 'subscriptions' && (
      !!document.getElementById('level-lock') ||
      !(window.WBMembership && WBMembership.hasDesignated(cachedProfile))
    );
    var links = document.getElementById('nav-links');
    var me = document.getElementById('account-me');
    var showMe = !bare && !player && !live && !gate && !profileGateOn && !!signedInNow;
    var showLinks = showMe;
    if (links) {
      links.hidden = !showLinks;
      Array.prototype.forEach.call(links.querySelectorAll('a'), function (a) {
        var on = false;
        if (showLinks) {
          if (a.id === 'programs-open') on = page === 'programs' || page === 'preview';
          else if (a.id === 'tracking-open') on = page === 'tracking' || page === 'history';
          else if (a.id === 'messages-nav') on = page === 'messages';
          else if (a.id === 'hub-nav') on = page === 'hub';
          else if (a.id === 'workouts-nav') on = page === '' || page === 'w' || page === 'send' || page === 'received' || page === 'circuits';
        }
        a.classList.toggle('on', !!on);
      });
    }
    if (me) {
      me.hidden = !showMe;
      me.classList.toggle('on', page === 'account');
      paintAccountMe(cachedProfile);
    }
    syncHeaderSignOut();
    paintReceivedDot();
    refreshRequestBadges();
  }
  function signOutFromAccount() {
    var from = hashPage();
    WBAuth.signOut().then(function () {
      forgetRequestBadges();
      cachedProfile = null;
      copyStamp = {};
      removedCopies = [];
      shareUser = '';
      resetShareLookup();
      pushPending = false;
      stopPushRetry();
      resetLibraryMemory();
      profileGateOn = false;
      closeProfileSheet(true);
      if (window.WBSharing) shareState = WBSharing.initialState();
      syncHeaderSignOut();
      signedInNow = false;
      if (hashPage() !== from) return;
      goSignedOutHome();
    }).catch(function (err) {
      if (hashPage() !== from) return;
      app.insertAdjacentHTML('afterbegin', '<div class="errs">' + esc((err && err.message) || 'Could not sign out') + '</div>');
    });
  }
  var accountSignOut = document.getElementById('account-signout');
  if (accountSignOut) accountSignOut.onclick = function (e) {
    e.preventDefault();
    signOutFromAccount();
  };
  var accountMe = document.getElementById('account-me');
  if (accountMe) accountMe.onclick = function () { openAccount(); };
  function paintAccountAvatar(profile) {
    var el = document.getElementById('profile-open');
    if (!el) return;
    var direct = profile && profile.avatarUrl;
    if (direct) {
      el.innerHTML = '<img alt="" src="' + esc(direct) + '">';
      return;
    }
    var path = profile && profile.avatar_path;
    if (!path || !WBAuth.avatarUrl) return;
    WBAuth.avatarUrl(path).then(function (url) {
      if (!url || !el.isConnected) return;
      el.innerHTML = '<img alt="" src="' + esc(url) + '">';
    }).catch(function () {});
  }
  function onProfileKey(e) {
    if (e.key !== 'Escape' || profileSheetRequired) return;
    if (!document.getElementById('profile-sheet')) return;
    closeProfileSheet(true);
  }
  var profileBarTitle = '';
  function closeProfileSheet(force) {
    var el = document.getElementById('profile-sheet');
    if (!el) return;
    if (!force && el.getAttribute('data-required') === '1') return;
    if (titleEl && titleEl.textContent === 'Profile' && profileBarTitle) titleEl.textContent = profileBarTitle;
    var parked = document.querySelector('#app-bar #profile-cancel');
    if (parked) parked.remove();
    if (window.WBPlaces && WBPlaces.destroyProfilePin) WBPlaces.destroyProfilePin();
    el.remove();
    profileSheetRequired = false;
    profilePhotoBlob = null;
    syncChrome();
    if (profileObjectUrl) {
      try { URL.revokeObjectURL(profileObjectUrl); } catch (err) {}
      profileObjectUrl = '';
    }
  }
  function showProfileGate(profile) {
    profileGateOn = true;
    titleEl.textContent = 'Account';
    backBtn.hidden = true;
    syncChrome();
    var open = document.getElementById('profile-sheet');
    if (open && open.getAttribute('data-required') === '1') return;
    openProfileSheet(profile, { required: true });
  }
  function openProfileSheet(profile, opts) {
    opts = opts || {};
    if (!window.WBProfile) return;
    profile = profile || cachedProfile || {};
    profileSheetRequired = !!opts.required;
    if (profileSheetRequired) profileGateOn = true;
    if (titleEl && titleEl.textContent !== 'Profile') profileBarTitle = titleEl.textContent;
    if (titleEl) titleEl.textContent = 'Profile';
    profilePhotoBlob = null;
    if (profileObjectUrl) {
      try { URL.revokeObjectURL(profileObjectUrl); } catch (err) {}
      profileObjectUrl = '';
    }
    if (window.WBPlaces && WBPlaces.destroyProfilePin) WBPlaces.destroyProfilePin();
    var existing = document.getElementById('profile-sheet');
    if (existing) existing.remove();
    var master = profile.membership === 'master_trainer';
    var nameVerified = window.WBProfile && WBProfile.isVerified(profile.verified_until, WBProfile.todayISO());
    document.body.insertAdjacentHTML('beforeend', WBProfile.sheetHtml({
      required: !!opts.required,
      unavailable: profile.profileReady !== true,
      master: master,
      verified: nameVerified,
      verified_until: profile.verified_until || '',
      display_name: profile.display_name || '',
      membership: profile.membership || '',
      intended_plan: profile.intended_plan || profile.intendedPlan || '',
      online_only: !!profile.online_only,
      bio: profile.bio || '',
      photoUrl: profile.avatarUrl || '',
      canList: !!WBProfile.canListInSearch(profile),
      listed: !!profile.listed,
      service_type: profile.service_type || ''
    }));
    if (!profileKeyBound) {
      profileKeyBound = true;
      document.addEventListener('keydown', onProfileKey);
    }
    var nameEl = document.getElementById('profile-name');
    var bioEl = document.getElementById('profile-bio');
    var countEl = document.getElementById('profile-count');
    var errEl = document.getElementById('profile-error');
    var fileEl = document.getElementById('profile-file');
    var sheet = document.getElementById('profile-sheet');
    function showErr(msg) {
      if (!errEl) return;
      if (!msg) { errEl.hidden = true; errEl.textContent = ''; return; }
      errEl.hidden = false;
      errEl.textContent = msg;
    }
    function mark(empty) {
      [['profile-name', 'name'], ['profile-service', 'service']].forEach(function (pair) {
        var field = document.getElementById(pair[0]);
        if (!field) return;
        if (empty && empty[pair[1]]) {
          field.classList.add('is-empty');
          field.setAttribute('aria-invalid', 'true');
        } else {
          field.classList.remove('is-empty');
          field.removeAttribute('aria-invalid');
        }
      });
    }
    function readFields() {
      var listedEl = document.getElementById('profile-listed');
      var serviceEl = document.getElementById('profile-service');
      return WBProfile.validate({
        display_name: nameEl ? nameEl.value : '',
        bio: bioEl ? bioEl.value : '',
        membership: profile.membership,
        intended_plan: profile.intended_plan,
        listed: !!(listedEl && listedEl.getAttribute('aria-checked') === 'true'),
        service_type: serviceEl ? serviceEl.value : ''
      });
    }
    function syncListingSections() {
      var listedEl = document.getElementById('profile-listed');
      var serviceEl = document.getElementById('profile-service');
      var serviceBlock = document.getElementById('profile-service-block');
      var pin = document.getElementById('profile-pin');
      var listed = !!(listedEl && listedEl.getAttribute('aria-checked') === 'true');
      var service = serviceEl ? serviceEl.value : '';
      if (serviceBlock) serviceBlock.hidden = !listed;
      if (!pin) return;
      if (pin.getAttribute('data-pin-kind') === 'client') {
        pin.hidden = false;
        return;
      }
      var showPlace = listed && service !== 'online';
      var wasHidden = !!pin.hidden;
      pin.hidden = !showPlace;
      if (showPlace && wasHidden && window.WBPlaces && WBPlaces.invalidateProfilePin) {
        WBPlaces.invalidateProfilePin();
      }
    }
    function watch(el, key) {
      if (!el) return;
      el.addEventListener('input', function () {
        if (!readFields().empty[key]) {
          el.classList.remove('is-empty');
          el.removeAttribute('aria-invalid');
        }
      });
    }
    watch(nameEl, 'name');
    if (bioEl && countEl) bioEl.addEventListener('input', function () {
      countEl.textContent = bioEl.value.length + '/' + WBProfile.BIO_MAX;
    });
    var serviceEl = document.getElementById('profile-service');
    if (serviceEl) serviceEl.addEventListener('change', function () {
      syncListingSections();
      var result = readFields();
      mark(result.empty);
      if (result.ok) showErr('');
    });
    if (fileEl) fileEl.addEventListener('change', function () {
      var file = fileEl.files && fileEl.files[0];
      if (!file) return;
      WBProfile.preparePhoto(file).then(function (blob) {
        if (!document.getElementById('profile-sheet')) return;
        profilePhotoBlob = blob;
        if (profileObjectUrl) {
          try { URL.revokeObjectURL(profileObjectUrl); } catch (err) {}
        }
        profileObjectUrl = URL.createObjectURL(blob);
        var photoEl = document.getElementById('profile-photo');
        if (photoEl) photoEl.innerHTML = '<img alt="" src="' + esc(profileObjectUrl) + '">';
        showErr('');
      }, function (err) {
        profilePhotoBlob = null;
        showErr((err && err.message) || 'Choose a photo.');
      });
    });
    if (sheet) sheet.addEventListener('click', function (e) {
      var toggle = e.target && e.target.closest && e.target.closest('#profile-listed');
      if (toggle) {
        var on = toggle.getAttribute('aria-checked') !== 'true';
        toggle.setAttribute('aria-checked', on ? 'true' : 'false');
        toggle.classList.toggle('on', on);
        syncListingSections();
        var toggled = readFields();
        mark(toggled.empty);
        if (toggled.ok) showErr('');
        return;
      }
      if (e.target && e.target.id === 'profile-sheet' && !profileSheetRequired) closeProfileSheet(true);
      if (e.target && e.target.closest && (e.target.closest('#profile-cancel') || e.target.closest('#profile-cancel-top'))) closeProfileSheet(true);
      if (e.target && e.target.closest && e.target.closest('#profile-save')) saveProfileFromSheet(profile, readFields, mark, showErr);
      if (e.target && e.target.closest && e.target.closest('#verify-open')) openVerifyForm();
      if (e.target && e.target.closest && e.target.closest('#verify-submit')) submitVerification(profile);
    });
    if (master && !nameVerified) loadVerification(profile);
    if (!profile.avatarUrl && profile.avatar_path && WBAuth.avatarUrl) {
      WBAuth.avatarUrl(profile.avatar_path).then(function (url) {
        var photoEl = document.getElementById('profile-photo');
        if (url && photoEl && photoEl.isConnected && !profilePhotoBlob) photoEl.innerHTML = '<img alt="" src="' + esc(url) + '">';
      }).catch(function () {});
    }
    var cancelBtn = document.getElementById('profile-cancel');
    var signOut = document.getElementById('account-signout');
    if (cancelBtn && signOut && signOut.parentNode) {
      signOut.parentNode.insertBefore(cancelBtn, signOut);
      cancelBtn.addEventListener('click', function () { closeProfileSheet(true); });
    }
    if (nameEl && opts.required && !String(nameEl.value || '').replace(/^\s+|\s+$/g, '')) {
      nameEl.classList.add('is-empty');
      nameEl.setAttribute('aria-invalid', 'true');
    }
    if (nameEl && opts.required) {
      try { nameEl.focus(); } catch (err) {}
    }
    if (document.getElementById('profile-pin') && window.WBPlaces && WBPlaces.bindProfilePin) WBPlaces.bindProfilePin();
    syncListingSections();
    syncHeaderSignOut();
  }
  function paintVerification(profile, extra) {
    var slot = document.getElementById('verify-slot');
    if (!slot || !window.WBProfile) return;
    var view = WBProfile.verificationView({
      membership: profile.membership,
      verifiedUntil: profile.verified_until,
      requests: profile.verificationRequests || [],
      today: WBProfile.todayISO()
    });
    if (extra && extra.unavailable) view = { show: true, verified: false, mode: 'open', note: view.note, link: false, unavailable: extra.unavailable };
    slot.innerHTML = WBProfile.verifyAreaHtml(view);
  }
  function openVerifyForm() {
    var form = document.getElementById('verify-form');
    var link = document.getElementById('verify-open');
    if (link) link.hidden = true;
    if (!form) return;
    form.hidden = false;
    var first = document.getElementById('verify-body');
    if (first) { try { first.focus(); } catch (err) {} }
  }
  function markVerify(empty) {
    [['verify-body', 'body'], ['verify-number', 'number'], ['verify-expires', 'expires']].forEach(function (pair) {
      var field = document.getElementById(pair[0]);
      if (!field) return;
      if (empty && empty[pair[1]]) {
        field.classList.add('is-empty');
        field.setAttribute('aria-invalid', 'true');
      } else {
        field.classList.remove('is-empty');
        field.removeAttribute('aria-invalid');
      }
    });
  }
  function showVerifyErr(msg) {
    var errEl = document.getElementById('verify-error');
    if (!errEl) return;
    if (!msg) { errEl.hidden = true; errEl.textContent = ''; return; }
    errEl.hidden = false;
    errEl.textContent = msg;
  }
  function loadVerification(profile) {
    if (!WBAuth.myVerifications) {
      paintVerification(profile, { unavailable: 'Verification is not available yet. Apply the verification SQL in the Supabase SQL editor.' });
      return;
    }
    var token = routeToken;
    WBAuth.myVerifications().then(function (rows) {
      if (token !== routeToken || !document.getElementById('verify-slot')) return;
      profile.verificationRequests = Array.isArray(rows) ? rows : [];
      if (cachedProfile && cachedProfile.id === profile.id) cachedProfile.verificationRequests = profile.verificationRequests;
      paintVerification(profile);
    }, function (err) {
      if (token !== routeToken || !document.getElementById('verify-slot')) return;
      var unavailable = err && /not available yet/i.test(err.message || '');
      if (unavailable) {
        paintVerification(profile, { unavailable: err.message });
        return;
      }
      paintVerification(profile);
    });
  }
  function submitVerification(profile) {
    if (!window.WBProfile) return;
    var bodyEl = document.getElementById('verify-body');
    var numberEl = document.getElementById('verify-number');
    var expEl = document.getElementById('verify-expires');
    var result = WBProfile.validateVerification({
      cert_body: bodyEl ? bodyEl.value : '',
      cert_number: numberEl ? numberEl.value : '',
      expires_on: expEl ? expEl.value : ''
    }, WBProfile.todayISO());
    markVerify(result.empty);
    if (!result.ok) {
      showVerifyErr(result.message);
      return;
    }
    if (!WBAuth.submitVerification) {
      showVerifyErr('Verification is not available yet. Apply the verification SQL in the Supabase SQL editor.');
      return;
    }
    var btn = document.getElementById('verify-submit');
    if (btn) btn.disabled = true;
    WBAuth.submitVerification(result.fields).then(function (row) {
      profile.verificationRequests = [row || { status: 'pending' }].concat(profile.verificationRequests || []);
      if (cachedProfile && cachedProfile.id === profile.id) cachedProfile.verificationRequests = profile.verificationRequests;
      paintVerification(profile);
    }, function (err) {
      if (btn) btn.disabled = false;
      showVerifyErr((err && err.message) || 'Could not save verification.');
    });
  }
  function saveProfileFromSheet(profile, readFields, mark, showErr) {
    var result = readFields();
    mark(result.empty);
    if (!result.ok) {
      showErr(result.message || (window.WBProfile ? WBProfile.EMPTY : 'Fill in the highlighted fields.'));
      return;
    }
    if (!profile.profileReady || !WBAuth.saveProfile) {
      showErr('Profile details are not available yet. Apply the profile SQL in the Supabase SQL editor.');
      return;
    }
    if (profilePhotoBlob && !WBAuth.uploadAvatar) {
      showErr('Photos are not available yet. Apply the profile SQL in the Supabase SQL editor.');
      return;
    }
    var btn = document.getElementById('profile-save');
    if (btn) btn.disabled = true;
    var fields = result.fields;
    var pending = profilePhotoBlob
      ? WBAuth.uploadAvatar(profilePhotoBlob).then(function (path) { fields.avatar_path = path; })
      : Promise.resolve();
    pending.then(function () { return WBAuth.saveProfile(fields); }).then(function (saved) {
      if (!saved || typeof saved !== 'object') saved = Object.assign({}, fields, { profileReady: true });
      cachedProfile = Object.assign({}, profile, saved);
      var wasRequired = profileSheetRequired;
      profileGateOn = false;
      closeProfileSheet(true);
      syncHeaderSignOut();
      if (wasRequired) return route();
      if (hashPage() === 'account') return renderSimpleAccount();
    }, function (err) {
      if (btn) btn.disabled = false;
      showErr((err && err.message) || 'Could not save your profile.');
    });
  }
  // One path per feature photo. Drop a file at the path and the frame fills in.
  // A missing file keeps the neutral 16:9 frame.
  var LANDING_SHOTS = [
    'assets/landing/team-drills.jpg',
    'assets/landing/team-gym.jpg',
    'assets/landing/feature-3.jpg',
    'assets/landing/feature-4.jpg',
    'assets/landing/feature-5.jpg',
    'assets/landing/feature-6.jpg',
    'assets/landing/feature-7.jpg'
  ];
  var landingEl = document.getElementById('landing');
  function landingPlansHtml() {
    var h = '<div class="sales">';
    h += '<h2>Choose how you want to train</h2>';
    h += '<p class="lede">Every plan is defined by what you can do, now and as the next features arrive.</p>';
    h += '<p class="beta-note">Beta pricing for the first 100 members.</p>';
    h += '<div class="plan-grid">';
    WBMembership.TIERS.forEach(function (t) {
      h += '<article class="card plan' + (t.recommended ? ' recommended' : '') + '">';
      h += '<div class="row"><h3 class="grow">' + esc(t.name) + '</h3>';
      if (t.recommended) h += '<span class="pill solid">Recommended</span>';
      if (t.beta) h += '<span class="pill amber">Beta</span>';
      h += '</div>';
      h += '<div class="price">';
      if (t.oldPriceLabel) h += '<span class="was">' + esc(t.oldPriceLabel) + '</span>';
      h += '<span class="now">' + esc(t.priceLabel) + '</span>';
      if (t.priceCents) h += '<span class="per">/ month</span>';
      h += '</div>';
      h += '<p class="value">' + esc(t.value) + '</p>';
      if (t.includes) h += '<p class="includes">' + esc(t.includes) + '</p>';
      h += '<ul>';
      t.available.forEach(function (line) { h += '<li>' + esc(line) + '</li>'; });
      h += '</ul>';
      if (t.highlight) h += '<div class="hub"><span class="hub-badge">Trainer Hub</span><p>' + esc(t.highlight) + '</p></div>';
      if (t.comingSoon.length) {
        h += '<p class="soon">Coming soon</p><ul>';
        t.comingSoon.forEach(function (line) { h += '<li>' + esc(line) + '</li>'; });
        h += '</ul>';
      }
      h += '</article>';
    });
    h += '</div></div>';
    return h;
  }
  function fillLandingPlans() {
    if (!landingEl || !window.WBMembership) return;
    var host = landingEl.querySelector('#landing-plans');
    if (!host || host.childElementCount) return;
    host.innerHTML = landingPlansHtml();
  }
  function bindLandingShots() {
    if (!landingEl) return;
    var imgs = landingEl.querySelectorAll('.landing-feature img');
    Array.prototype.forEach.call(imgs, function (img, i) {
      var path = LANDING_SHOTS[i];
      if (path && img.getAttribute('src') !== path) img.setAttribute('src', path);
      if (img.getAttribute('data-bound')) return;
      img.setAttribute('data-bound', '1');
      function miss() { img.classList.add('is-missing'); }
      img.addEventListener('error', miss);
      if (img.complete && img.naturalWidth === 0 && img.currentSrc) miss();
    });
  }
  // Remember a confirmed sign-in so the next route does not paint the marketing
  // page while getSession() is still reading the new token.
  var signedInNow = false;
  // The marketing node stays in the document. Classes hide and show it so
  // Back to the bare URL does not wait on a session check to paint it.
  function storedSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i) || '';
        if (key.indexOf('-auth-token') === -1 || key.indexOf('code-verifier') !== -1) continue;
        if ((localStorage.getItem(key) || '').indexOf('access_token') !== -1) return true;
      }
    } catch (e) {}
    return false;
  }
  function hideLanding() {
    document.documentElement.classList.add('wb-app');
    document.documentElement.classList.remove('wb-landing');
    syncChrome();
  }
  function showLanding() {
    if (!landingEl) return;
    document.documentElement.classList.remove('wb-app');
    document.documentElement.classList.add('wb-landing');
    fillLandingPlans();
    bindLandingShots();
    backBtn.hidden = true;
    syncChrome();
  }
  function renderSubscriptions(message, isError) {
    titleEl.textContent = 'Subscriptions';
    backBtn.hidden = true;
    showHeaderSignIn(false);
    app.innerHTML = '<p class="mute">Loading…</p>';
    WBAuth.session().then(function (session) {
      if (hashPage() !== 'subscriptions') return;
          if (!session) return goSignedOutHome();
      WBAuth.profile().then(function (profile) {
        if (hashPage() !== 'subscriptions') return;
        if (profile) cachedProfile = profile;
        if (!accessApproved(profile, session)) return renderAccessWait();
        var shown = profile || cachedProfile;
        if (clientNeedsName(shown)) return go('#/account');
        if (window.WBProfile && WBMembership.hasDesignated(shown) && WBProfile.needsName(shown)) {
          showProfileGate(shown);
          return;
        }
        var locked = !WBMembership.hasDesignated(shown);
        backBtn.hidden = locked;
        var connP = WBAuth.myConnection ? WBAuth.myConnection() : Promise.resolve(null);
        connP.then(function (conn) {
          if (hashPage() !== 'subscriptions') return;
          syncTrainerWorkouts(conn, session.user && session.user.id);
          noteProfile(shown);
          drawSubscriptions(session, shown, message, isError, conn, locked);
        }).catch(function () {
          if (hashPage() === 'subscriptions') drawSubscriptions(session, shown, message, isError, null, locked);
        });
      }).catch(function () {
        if (hashPage() !== 'subscriptions') return;
        backBtn.hidden = true;
        drawSubscriptions(session, null, message || 'Signed in, but membership storage is not ready yet. Apply the profiles SQL in the Supabase SQL editor.', true, null, true);
      });
    }).catch(function (e) {
      if (hashPage() !== 'subscriptions') return;
      showSignInNotice((e && e.message) || 'Could not reach sign-in', true);
    });
  }
  function drawSubscriptions(session, profile, message, isError, conn, locked) {
    var note = takeInviteNotice();
    var h = '<div class="sales">';
    if (note) h += '<div class="' + (note.isError ? 'errs' : 'card') + '">' + esc(note.text) + '</div>';
    if (message) h += '<div class="' + (isError ? 'errs' : 'card') + '">' + esc(message) + '</div>';
    if (locked) h += '<p class="mute" id="level-lock">Choose a level to continue.</p>';
    h += '<h2>Choose how you want to train</h2>';
    h += '<p class="lede">Every plan is defined by what you can do, now and as the next features arrive.</p>';
    h += '<p class="beta-note">Beta pricing for the first 100 members.</p>';
    if (session) h += redeemCard(conn, profile);
    WBMembership.TIERS.forEach(function (t) {
      h += '<article class="card plan' + (t.recommended ? ' recommended' : '') + '">';
      h += '<div class="row"><h3 class="grow">' + esc(t.name) + '</h3>';
      if (t.recommended) h += '<span class="pill solid">Recommended</span>';
      if (t.beta) h += '<span class="pill amber">Beta</span>';
      h += '</div>';
      h += '<div class="price">';
      if (t.oldPriceLabel) h += '<span class="was">' + esc(t.oldPriceLabel) + '</span>';
      h += '<span class="now">' + esc(t.priceLabel) + '</span>';
      if (t.priceCents) h += '<span class="per">/ month</span>';
      h += '</div>';
      h += '<p class="value">' + esc(t.value) + '</p>';
      if (t.includes) h += '<p class="includes">' + esc(t.includes) + '</p>';
      h += '<ul>';
      t.available.forEach(function (line) { h += '<li>' + esc(line) + '</li>'; });
      h += '</ul>';
      if (t.highlight) h += '<div class="hub"><span class="hub-badge">Trainer Hub</span><p>' + esc(t.highlight) + '</p></div>';
      if (t.comingSoon.length) {
        h += '<p class="soon">Coming soon</p>';
        h += '<ul>';
        t.comingSoon.forEach(function (line) { h += '<li>' + esc(line) + '</li>'; });
        h += '</ul>';
      }
      if (t.inviteOnly) {
        if (t.cta) h += '<p class="invite">' + esc(t.cta) + '</p>';
      } else h += '<button class="pri" data-plan="' + t.id + '" style="width:100%;margin-top:16px">' + esc(t.cta) + '</button>';
      h += '</article>';
    });
    h += '<p class="foot">Choosing a plan saves your selection.</p>';
    if (locked) h += '<button class="linkish" type="button" id="level-signout">Sign out</button>';
    h += '</div>';
    app.innerHTML = h;
    refreshRequestBadges();
    if (!session) backBtn.hidden = true;
    showHeaderSignIn(false);
    syncChrome();
    app.onchange = function (e) {
      if (e.target && e.target.id === 'share-link') linkShareChoice = !!e.target.checked;
    };
    app.onclick = function (e) {
      var nav = e.target.closest('[data-go]');
      if (e.target.closest('#level-signout')) {
        return WBAuth.signOut().then(function () {
          forgetRequestBadges();
          cachedProfile = null;
          signedInNow = false;
          resetLibraryMemory();
          goSignedOutHome();
        });
      }
      if (!session && (nav || e.target.closest('[data-plan]') || e.target.closest('[data-invite="redeem"]'))) return go('#/signin');
      if (nav && nav.dataset.go === 'messages') return go('#/messages');
      if (nav && nav.dataset.go === 'hub') return go('#/hub');
      if (nav && nav.dataset.go === 'received') return go('#/received');
      if (handleInvite(e, function () { renderSubscriptions(); })) return;
      if (e.target && e.target.id === 'share-link') linkShareChoice = !!e.target.checked;
      var b = e.target.closest('[data-plan]'); if (!b) return;
      if (planBusy || !WBMembership.canSelectIntended(b.dataset.plan)) return;
      planBusy = true; b.disabled = true;
      WBAuth.saveIntended(b.dataset.plan).then(function (saved) {
        planBusy = false;
        if (saved && typeof saved === 'object') cachedProfile = saved;
        if (hashPage() !== 'subscriptions') return;
        go('#/');
      }).catch(function () {
        planBusy = false;
        if (hashPage() !== 'subscriptions') return;
        drawSubscriptions(session, profile, 'Could not save that plan. Please try again.', true, conn, !!locked);
      });
    };
  }
  function renderSimpleAccount() {
    titleEl.textContent = 'Account'; backBtn.hidden = true;
    app.innerHTML = '<p class="mute">Loading account…</p>';
    WBAuth.session().then(function (session) {
      if (hashPage() !== 'account') return;
      if (!session) return goSignedOutHome();
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
    var h = '<div class="account-page">';
    if (note) h += '<div class="' + (note.isError ? 'errs' : 'card') + '">' + esc(note.text) + '</div>';
    var who = signedInLabel(profile, session);
    var verifiedName = window.WBProfile && WBProfile.isVerified(profile && profile.verified_until, WBProfile.todayISO());
    var whoHtml = window.WBProfile ? WBProfile.nameHtml(who, verifiedName) : esc(who);
    h += '<div class="card" id="account-card"><div class="account-id">' +
      '<button type="button" class="avatar av-lg" id="profile-open" aria-label="Profile">' + esc(initialsOf(who)) + '</button>' +
      '<div class="grow"><div class="name" id="account-label">' + whoHtml + '</div>' +
      '<p class="mute">' + esc(plan ? plan.name : 'Membership') + ' · <button type="button" id="profile-edit">Edit profile</button></p></div></div></div>';
    if (window.WBProfile && session && WBProfile.isAdminEmail(session.user && session.user.email)) {
      h += '<button type="button" class="link-row" id="admin-open" data-go="admin"><span class="grow"><span class="name">Admin</span><div class="mute">Access, verifications, Hub reports</div></span><span class="admin-count" id="admin-count" hidden></span><span class="chev" aria-hidden="true">›</span></button>';
    }
    if (window.WBProfile && WBProfile.needsName(profile)) {
      h += '<p class="lede" id="account-name-note">' + esc(WBProfile.PROMPT) + '</p>';
    }
    var trainerAccount = window.WBInvites && WBInvites.trainerRole(profile);
    if (!trainerAccount || (conn && conn.trainerId)) h += redeemCard(conn, profile);
    var shareHere = !!(window.WBInvites && window.WBSharing && WBInvites.isEnthusiast(profile) && conn && conn.trainerId);
    if (shareHere) h += '<div id="share-slot"></div>';
    h += trainerSection(roster);
    h += '</div>';
    app.innerHTML = h;
    paintAccountAvatar(profile);
    refreshRequestBadges();
    syncChrome();
    if (window.WBProfile && session && WBProfile.isAdminEmail(session.user && session.user.email)) loadPendingCount();
    if (shareHere) loadShare();
    app.onclick = function (e) {
      var nav = e.target.closest('[data-go]');
      if (nav && nav.dataset.go === 'messages') return go('#/messages');
      if (nav && nav.dataset.go === 'hub') return go('#/hub');
      if (nav && nav.dataset.go === 'send') return go('#/send');
      if (nav && nav.dataset.go === 'received') return go('#/received');
      if (nav && nav.dataset.go === 'admin') return go('#/admin');
      var viewBtn = e.target.closest('[data-client-view]');
      if (viewBtn) return go('#/client/' + viewBtn.getAttribute('data-client-view'));
      if (e.target.closest('#profile-open') || e.target.closest('#profile-edit')) return openProfileSheet(profile, { required: false });
      if (e.target.closest('#share-account')) { toggleShare(); return; }
      if (handleInvite(e, function () { renderSimpleAccount(); })) return;
    };
  }
  function paintRequestBadges(n) {
    var count = Math.max(0, Number(n) || 0);
    ['messages-nav'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      var badge = btn.querySelector('.request-count');
      if (!count) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'request-count';
        btn.appendChild(badge);
      }
      badge.hidden = false;
      badge.textContent = String(count);
      badge.setAttribute('aria-label', count === 1 ? '1 request' : (count + ' requests'));
    });
  }
  var badgeGen = 0;
  function forgetRequestBadges() {
    badgeGen++;
    paintRequestBadges(0);
  }
  function refreshRequestBadges() {
    var gen = ++badgeGen;
    if (!window.WBProfile || !WBProfile.canListInSearch || !WBProfile.canListInSearch(cachedProfile)) return;
    if (!window.WBAuth || !WBAuth.trainerRequestCount) return;
    Promise.resolve().then(function () { return WBAuth.trainerRequestCount(); }).then(function (n) {
      if (gen !== badgeGen) return;
      paintRequestBadges(n);
    }, function () {});
  }
  function paintPendingCount(n) {
    var badge = document.getElementById('admin-count');
    if (!badge) return;
    var count = Math.max(0, Number(n) || 0);
    if (!count) {
      badge.hidden = true;
      badge.textContent = '';
      badge.removeAttribute('aria-label');
      return;
    }
    badge.hidden = false;
    badge.textContent = String(count);
    badge.setAttribute('aria-label', count === 1 ? '1 pending' : (count + ' pending'));
  }
  function pendingTotal(queue, accounts) {
    var n = Array.isArray(queue) ? queue.length : 0;
    (Array.isArray(accounts) ? accounts : []).forEach(function (row) {
      if (row && row.approved === false) n += 1;
    });
    return n;
  }
  function loadPendingCount() {
    var token = routeToken;
    var queueP = WBAuth.verificationQueue ? Promise.resolve().then(function () { return WBAuth.verificationQueue(); }) : Promise.resolve([]);
    var accessP = WBAuth.accessAccounts ? Promise.resolve().then(function () { return WBAuth.accessAccounts(); }) : Promise.resolve([]);
    Promise.all([
      queueP.then(function (rows) { return rows; }, function () { return []; }),
      accessP.then(function (rows) { return rows; }, function () { return []; })
    ]).then(function (pair) {
      if (token !== routeToken || hashPage() !== 'account') return;
      var base = pendingTotal(pair[0], pair[1]);
      paintPendingCount(base);
      if (!WBAuth.hubReports) return;
      Promise.resolve().then(function () { return WBAuth.hubReports(); }).then(function (rows) {
        if (token !== routeToken || hashPage() !== 'account') return;
        var extra = Array.isArray(rows) ? rows.length : 0;
        if (extra) paintPendingCount(base + extra);
      }, function () {});
    });
  }
  function byNewest(rows) {
    return (Array.isArray(rows) ? rows.slice() : []).sort(function (a, b) {
      return String((b && b.created_at) || '').localeCompare(String((a && a.created_at) || ''));
    });
  }
  function renderAdmin() {
    titleEl.textContent = 'Admin';
    backBtn.hidden = false;
    app.innerHTML = '<p class="mute">Loading…</p>';
    app.onclick = null;
    var requested = location.hash;
    WBAuth.session().then(function (session) {
      if (hashPage() !== 'admin' || location.hash !== requested) return;
      if (!session) return goSignedOutHome();
      var email = session.user && session.user.email;
      if (!window.WBProfile || !WBProfile.isAdminEmail(email)) {
        app.innerHTML = '<div class="card" id="verify-admin-denied"><div class="name">Only the admin can open this page</div></div>';
        return;
      }
      var queueP = WBAuth.verificationQueue
        ? Promise.resolve().then(function () { return WBAuth.verificationQueue(); })
        : Promise.resolve(null);
      var accessP = WBAuth.accessAccounts
        ? Promise.resolve().then(function () { return WBAuth.accessAccounts(); })
        : Promise.resolve(null);
      Promise.all([
        queueP.then(function (rows) { return rows; }, function (err) { return { __err: err }; }),
        accessP.then(function (rows) { return rows; }, function (err) { return { __err: err }; })
      ]).then(function (pair) {
        if (hashPage() !== 'admin' || location.hash !== requested) return;
        drawAdmin(pair[0], pair[1]);
        if (!WBAuth.hubReports) return paintHubReports(null);
        Promise.resolve().then(function () { return WBAuth.hubReports(); }).then(function (rows) {
          if (hashPage() !== 'admin' || location.hash !== requested) return;
          paintHubReports(rows);
        }, function (err) {
          if (hashPage() !== 'admin' || location.hash !== requested) return;
          paintHubReports({ __err: err });
        });
      });
    }).catch(function () {
      if (hashPage() === 'admin') go('#/signin');
    });
  }
  function accessCards(rows, waiting) {
    var list = byNewest(rows).filter(function (row) {
      return waiting ? row && row.approved === false : row && row.approved !== false;
    });
    if (!list.length) {
      return '<div class="empty" id="' + (waiting ? 'access-waiting-empty' : 'access-approved-empty') + '">' +
        (waiting ? 'No accounts are waiting.' : 'No approved accounts.') + '</div>';
    }
    var h = '';
    list.forEach(function (row) {
      var id = row.id;
      var name = row.display_name || 'No name yet';
      h += '<article class="card" data-account="' + esc(id) + '">';
      h += '<div class="name">' + esc(name) + '</div>';
      h += '<p class="mute">' + esc(row.email || '') + '</p>';
      h += '<div class="actions admin-halves">';
      if (waiting) h += '<button type="button" class="pri sm" data-access="approve" data-id="' + esc(id) + '">Approve</button>';
      h += '<button type="button" class="sm danger" data-access="remove" data-id="' + esc(id) + '">Remove access</button>';
      h += '</div></article>';
    });
    return h;
  }
  function verificationCards(rows) {
    var h = '<div id="verify-queue">';
    if (!rows.length) h += '<div class="empty" id="verify-empty">No pending requests.</div>';
    rows.forEach(function (row) {
      var id = row.id;
      var name = row.display_name || row.name || 'Trainer';
      h += '<article class="card" data-request="' + esc(id) + '">';
      h += '<div class="name">' + esc(name) + '</div>';
      h += '<p class="mute">' + esc(row.email || '') + '</p>';
      h += '<p class="verify-line">Certifying organization <b>' + esc(row.cert_body || '') + '</b> · Certification number <b>' + esc(row.cert_number || '') + '</b> · Expiration date <b>' + esc(window.WBProfile ? WBProfile.formatDay(row.expires_on) : (row.expires_on || '')) + '</b> · Submitted <b>' + esc(window.WBProfile ? WBProfile.formatDay(row.created_at) : '') + '</b></p>';
      h += '<div class="actions admin-halves"><button type="button" class="pri sm" data-verify="approve" data-id="' + esc(id) + '">Approve</button>';
      h += '<button type="button" class="sm" data-verify="decline" data-id="' + esc(id) + '">Decline</button></div>';
      h += '<div class="decline-box" id="decline-' + esc(id) + '" hidden>';
      h += '<label for="note-' + esc(id) + '">Note</label>';
      h += '<textarea id="note-' + esc(id) + '" maxlength="280" placeholder="Short note for the trainer"></textarea>';
      h += '<p class="errs" id="note-err-' + esc(id) + '" hidden>Enter a note.</p>';
      h += '<button type="button" class="danger" data-verify="confirm-decline" data-id="' + esc(id) + '" style="width:100%;margin-top:8px">Decline request</button>';
      h += '</div></article>';
    });
    h += '</div>';
    return h;
  }
  function drawAdmin(queue, accounts) {
    var queueRows = Array.isArray(queue) ? queue : [];
    var accountRows = Array.isArray(accounts) ? accounts : [];
    var h = '<div class="admin-page">';
    h += '<section id="access-section">';
    if (accounts && accounts.__err) {
      h += '<div class="errs" id="access-admin-error">' + esc((accounts.__err && accounts.__err.message) || 'Could not load accounts.') + '</div>';
    } else if (accounts == null) {
      h += '<div class="card" id="access-unavailable"><div class="name">Not available yet</div><p class="mute">Access approval is not available yet. Apply the access SQL in the Supabase SQL editor.</p></div>';
    } else {
      h += '<div class="sec">Access · Waiting for approval</div><div id="access-waiting">' + accessCards(accountRows, true) + '</div>';
      h += '<div class="sec">Access · Approved</div><div id="access-approved">' + accessCards(accountRows, false) + '</div>';
    }
    h += '</section>';
    h += '<section id="verifications-section"><div class="sec">Verifications</div>';
    if (!WBAuth.verificationQueue || queue == null) {
      h += '<div class="card" id="verify-wait"><div class="name">Not available yet</div><p class="mute">Verification is not available yet. Apply the verification SQL in the Supabase SQL editor.</p></div>';
    } else if (queue && queue.__err) {
      h += '<div class="errs" id="verify-admin-error">' + esc((queue.__err && queue.__err.message) || 'Could not load verification requests.') + '</div>';
    } else {
      h += verificationCards(queueRows);
    }
    h += '</section>';
    h += '<section id="hub-reports-section"><div class="admin-h"><div class="sec">Hub reports</div><span class="admin-count" id="hub-report-count" hidden></span></div>';
    h += '<div id="hub-reports-body"><p class="mute" id="hub-reports-loading">Loading…</p></div></section>';
    h += '</div>';
    app.innerHTML = h;
    app.onclick = function (e) {
      var accessBtn = e.target.closest('[data-access]');
      if (accessBtn && !accessBtn.disabled) {
        var accessId = accessBtn.getAttribute('data-id');
        var turnOn = accessBtn.getAttribute('data-access') === 'approve';
        return setAccountAccess(accessId, turnOn);
      }
      var btn = e.target.closest('[data-verify]');
      if (btn && !btn.disabled) {
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-verify');
        if (action === 'decline') {
          var box = document.getElementById('decline-' + id);
          if (box) box.hidden = false;
          var note = document.getElementById('note-' + id);
          if (note) { try { note.focus(); } catch (err) {} }
          return;
        }
        if (action === 'approve') return reviewVerification(id, 'approved', '');
        if (action === 'confirm-decline') {
          var text = document.getElementById('note-' + id);
          var result = window.WBProfile ? WBProfile.validateDecline(text ? text.value : '') : { ok: false, message: 'Enter a note.' };
          var errEl = document.getElementById('note-err-' + id);
          if (!result.ok) {
            if (errEl) { errEl.hidden = false; errEl.textContent = result.message || 'Enter a note.'; }
            if (text) { text.classList.add('is-empty'); text.setAttribute('aria-invalid', 'true'); }
            return;
          }
          if (text) { text.classList.remove('is-empty'); text.removeAttribute('aria-invalid'); }
          if (errEl) errEl.hidden = true;
          return reviewVerification(id, 'declined', result.note);
        }
      }
      var reportBtn = e.target.closest('[data-hub-report]');
      if (reportBtn && !reportBtn.disabled) return reviewHubReport(reportBtn);
    };
  }
  function paintHubCount(n) {
    var badge = document.getElementById('hub-report-count');
    if (!badge) return;
    var count = Math.max(0, Number(n) || 0);
    if (!count) {
      badge.hidden = true;
      badge.textContent = '';
      badge.removeAttribute('aria-label');
      return;
    }
    badge.hidden = false;
    badge.textContent = String(count);
    badge.setAttribute('aria-label', count === 1 ? '1 unreviewed report' : (count + ' unreviewed reports'));
  }
  function paintHubReports(reports) {
    var body = document.getElementById('hub-reports-body');
    if (!body) return;
    if (reports == null) {
      paintHubCount(0);
      body.innerHTML = '<div class="card" id="hub-reports-wait"><div class="name">Not available yet</div><p class="mute">Trainer Hub is not available yet. Apply the hub SQL in the Supabase SQL editor.</p></div>';
      return;
    }
    if (reports.__err) {
      paintHubCount(0);
      var unavailable = reports.__err && /not available yet/i.test(reports.__err.message || '');
      if (unavailable) {
        body.innerHTML = '<div class="card" id="hub-reports-wait"><div class="name">Not available yet</div><p class="mute">' + esc(reports.__err.message) + '</p></div>';
      } else {
        body.innerHTML = '<div class="errs" id="hub-reports-error">' + esc((reports.__err && reports.__err.message) || 'Could not load reports.') + '</div>';
      }
      return;
    }
    var rows = Array.isArray(reports) ? reports : [];
    paintHubCount(rows.length);
    body.innerHTML = window.WBHub ? WBHub.reportCardsHtml(rows) : '<div class="empty" id="hub-reports-empty">No reports waiting.</div>';
  }
  function reviewHubReport(button) {
    var action = button.getAttribute('data-hub-report');
    var id = button.getAttribute('data-id');
    if (action === 'view') {
      var postId = button.getAttribute('data-post');
      if (postId) go('#/hub/' + postId);
      return;
    }
    if (action === 'dismiss') {
      if (!WBAuth.hubDismissReport) return;
      button.disabled = true;
      WBAuth.hubDismissReport(id).then(function () {
        renderAdmin();
      }, function (err) {
        button.disabled = false;
        app.insertAdjacentHTML('afterbegin', '<div class="errs">' + esc((err && err.message) || 'Could not dismiss that report.') + '</div>');
      });
      return;
    }
    if (action === 'delete') {
      if (!WBAuth.hubDeleteReported) return;
      var kind = button.getAttribute('data-kind') === 'reply' ? 'reply' : 'post';
      if (!confirm(kind === 'reply' ? 'Delete this reply? This cannot be undone.' : 'Delete this post? This cannot be undone.')) return;
      button.disabled = true;
      WBAuth.hubDeleteReported({
        kind: kind,
        postId: button.getAttribute('data-post'),
        replyId: button.getAttribute('data-reply')
      }).then(function () {
        renderAdmin();
      }, function (err) {
        button.disabled = false;
        app.insertAdjacentHTML('afterbegin', '<div class="errs">' + esc((err && err.message) || 'Could not delete that.') + '</div>');
      });
    }
  }
  function setAccountAccess(id, approved) {
    if (!WBAuth.setAccess || !id) return;
    var buttons = app.querySelectorAll('[data-access]');
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
    WBAuth.setAccess(id, approved).then(function () {
      renderAdmin();
    }, function (err) {
      Array.prototype.forEach.call(buttons, function (b) { b.disabled = false; });
      app.insertAdjacentHTML('afterbegin', '<div class="errs">' + esc((err && err.message) || 'Could not update access.') + '</div>');
    });
  }
  function reviewVerification(id, status, note) {
    if (!WBAuth.reviewVerification) return;
    var buttons = app.querySelectorAll('[data-verify]');
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
    WBAuth.reviewVerification(id, status, note).then(function () {
      renderAdmin();
    }, function (err) {
      Array.prototype.forEach.call(buttons, function (b) { b.disabled = false; });
      var errEl = document.getElementById('note-err-' + id);
      if (status === 'declined' && errEl) {
        errEl.hidden = false;
        errEl.textContent = (err && err.message) || 'Could not decline that request.';
        return;
      }
      app.insertAdjacentHTML('afterbegin', '<div class="errs">' + esc((err && err.message) || 'Could not review that request.') + '</div>');
    });
  }
  function openWorkoutView(id) {
    var viewed = getW(id);
    titleEl.textContent = viewed ? viewed.name : 'Workouts';
    backBtn.hidden = false;
    // Calendar View: WBPreview.openView mounts the real player with track off.
    // Leaving it, including Back, returns to the workout list.
    if (!window.WBPreview || !viewed || !WBPreview.openView(app, viewed, function () { go('#/'); })) return go('#/');
  }
  function showBuilder() {
    ensureShare();
    scheduleAccountSync();
    var p = location.hash.replace(/^#\/?/, '').split('/');
    if (p[0] === 'view') return openWorkoutView(p[1]);
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
      if (!workoutRunnable(current)) {
        toast(RUN_NEEDS_NUMBERS);
        return go('#/w/' + current.id);
      }
      titleEl.textContent = current.name; backBtn.hidden = false;
      return WBPlayer.mount(app, current, data, persist, function () { go('#/w/' + current.id); }, {
        reschedule: {
          role: function () { return window.WBPrograms ? WBPrograms.roleOf(cachedProfile) : 'none'; },
          entries: function () { return data.programs || []; },
          go: go
        }
      });
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
      if (!session) return goSignedOutHome();
      var profileP = WBAuth.profile ? WBAuth.profile() : Promise.resolve(null);
      profileP.then(function (profile) { return profile; }, function () { return null; }).then(function (profile) {
        if (token !== routeToken || location.hash !== requested) return;
        cachedProfile = profile || cachedProfile;
        if (!window.WBSends) return;
        WBSends.mount({
          app: app, titleEl: titleEl, backBtn: backBtn, go: go, toast: toast,
          profile: function () { return cachedProfile; },
          workouts: function () { return data.workouts; },
          applyCopies: function (list) { applyCopies(list || []); },
          markSeen: function (ids) { markReceivedSeen(ids); }
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
      if (!session) return goSignedOutHome();
      if (!window.WBMessages) return;
      WBMessages.mount({
        app: app, titleEl: titleEl, backBtn: backBtn, go: go, toast: toast,
        onBadges: function () { refreshRequestBadges(); }
      });
    }).catch(function () {
      if (token !== routeToken || location.hash !== requested) return;
      go('#/signin');
    });
  }
  function openHub(token) {
    var requested = location.hash;
    backBtn.hidden = false;
    app.onclick = null; app.oninput = null; app.onchange = null;
    app.innerHTML = '<p class="mute">Loading…</p>';
    var pending;
    try { pending = WBAuth.session(); } catch (e) { return go('#/signin'); }
    if (!pending || !pending.then) return go('#/signin');
    pending.then(function (session) {
      if (token !== routeToken || location.hash !== requested) return;
      if (!session) return goSignedOutHome();
      if (!window.WBHub) {
        titleEl.textContent = 'Trainer Hub';
        app.innerHTML = '<div class="card" id="hub-wait"><div class="name">Not available yet</div><p class="mute">Trainer Hub is not available yet. Apply the hub SQL in the Supabase SQL editor.</p></div>';
        return;
      }
      WBHub.mount({ app: app, titleEl: titleEl, backBtn: backBtn, go: go, toast: toast });
    }).catch(function () {
      if (token !== routeToken || location.hash !== requested) return;
      go('#/signin');
    });
  }
  function circuitParts() {
    var body = '';
    try { body = String(location.hash || '').replace(/^#\/?/, '').split('?')[0]; } catch (e) { body = ''; }
    return body.split('/');
  }
  function openCircuits(token) {
    if (token !== routeToken) return;
    backBtn.hidden = false;
    app.onclick = null;
    app.oninput = null;
    app.onchange = null;
    var parts = circuitParts();
    if (parts[0] === 'circuits' && parts[2] === 'run' && parts[1] && parts[1] !== 'new') {
      if (!window.WBCircuitSession) {
        titleEl.textContent = 'Group Circuit Training';
        app.innerHTML = '<div class="card" id="circuit-wait"><div class="name">Not available yet</div><p class="mute">Group circuits are not available yet.</p></div>';
        return;
      }
      WBCircuitSession.mount({ app: app, titleEl: titleEl, backBtn: backBtn, go: go, toast: toast });
      return;
    }
    if (!window.WBCircuits) {
      titleEl.textContent = 'Group Circuit Training';
      app.innerHTML = '<div class="card" id="circuit-wait"><div class="name">Not available yet</div><p class="mute">Group circuits are not available yet.</p></div>';
      return;
    }
    WBCircuits.mount({ app: app, titleEl: titleEl, backBtn: backBtn, go: go, toast: toast });
  }
  function guestStampOf(w) {
    var stamp = (w.name || '') + '|' + (w.updatedAt || 0);
    try { stamp += JSON.stringify(w.items || []); } catch (e) {}
    return stamp;
  }
  function paintClientTools() {
    var old = document.getElementById('client-account');
    if (old) old.remove();
    if (!clientScreen || !window.WBLibrary) return;
    var html = WBLibrary.clientToolsHtml(clientScreen);
    if (html) app.insertAdjacentHTML('beforeend', html);
  }
  function openClientGuest(clientId, localId, kind, run) {
    if (!clientScreen || !window.WBLibrary) return;
    var guest = null;
    if (kind === 'sent') {
      var copy = (clientScreen.sent || []).filter(function (w) { return w && String(w.id) === String(localId); })[0];
      if (!copy) return;
      guest = WBLibrary.guestFromCopy(copy, clientId);
    } else {
      var row = (clientScreen.workouts || []).filter(function (w) { return w && String(w.localId) === String(localId); })[0];
      if (!row) return;
      guest = WBLibrary.guestFromAccount(row, clientId, clientScreen.permission);
    }
    rememberGuest(guest);
    guestStamp[guest.id] = guestStampOf(guest);
    go((run ? '#/play/' : '#/w/') + guest.id);
  }
  function newClientWorkout(clientId) {
    if (!clientScreen || clientScreen.permission !== 'edit' || !window.WBLibrary) return;
    var name = prompt('Workout name', 'New workout');
    if (name === null) return;
    var w = M.newWorkout(String(name || '').trim() || 'New workout');
    w.remoteOwnerId = String(clientId);
    w.remoteEditable = true;
    rememberGuest(w);
    guestStamp[w.id] = guestStampOf(w);
    guestGen[w.id] = 1;
    enqueueClient({
      ownerId: String(clientId),
      kind: 'account',
      localId: String(w.id),
      change: WBLibrary.changeFrom(w, false),
      gen: 1
    });
    go('#/w/' + w.id);
  }
  function deleteClientWorkout(clientId, localId, kind) {
    if (!clientScreen) return;
    var rowName = 'this workout';
    if (kind === 'sent') {
      var copy = (clientScreen.sent || []).filter(function (w) { return w && String(w.id) === String(localId); })[0];
      if (copy && copy.name) rowName = copy.name;
    } else {
      var row = (clientScreen.workouts || []).filter(function (w) { return w && String(w.localId) === String(localId); })[0];
      if (row && row.name) rowName = row.name;
    }
    if (!confirm('Delete “' + rowName + '”? This cannot be undone.')) return;
    var gen = Date.now();
    if (kind === 'sent') {
      enqueueClient({ ownerId: String(clientId), kind: 'sent', localId: String(localId), deleted: true, gen: gen });
      clientScreen.sent = (clientScreen.sent || []).filter(function (w) { return String(w.id) !== String(localId); });
    } else {
      enqueueClient({
        ownerId: String(clientId),
        kind: 'account',
        localId: String(localId),
        change: { localId: String(localId), name: rowName, items: [], revisedAt: gen, deleted: true },
        gen: gen
      });
      clientScreen.workouts = (clientScreen.workouts || []).filter(function (w) { return String(w.localId) !== String(localId); });
    }
    guests = guests.filter(function (g) { return !g || String(g.id) !== String(localId); });
    delete guestStamp[localId];
    paintClientTools();
  }
  function bindClientTools(clientId, token, requested) {
    app.onclick = function (e) {
      if (token !== routeToken || location.hash !== requested) return;
      var openBtn = e.target.closest('[data-client-open]');
      var runBtn = e.target.closest('[data-client-run]');
      var delBtn = e.target.closest('[data-client-del]');
      var newBtn = e.target.closest('[data-client-new]');
      if (openBtn) return openClientGuest(clientId, openBtn.getAttribute('data-client-open'), openBtn.getAttribute('data-client-kind'), false);
      if (runBtn) return openClientGuest(clientId, runBtn.getAttribute('data-client-run'), runBtn.getAttribute('data-client-kind'), true);
      if (delBtn) return deleteClientWorkout(clientId, delBtn.getAttribute('data-client-del'), delBtn.getAttribute('data-client-kind'));
      if (newBtn) return newClientWorkout(clientId);
    };
  }
  function attachClientTools(clientId, token, requested) {
    clientScreen = null;
    if (!window.WBLibrary || !WBAuth.clientAccountWorkouts || !WBAuth.session) return;
    var pending;
    try { pending = WBAuth.session(); } catch (e) { return; }
    Promise.resolve(pending).then(function (session) {
      if (token !== routeToken || location.hash !== requested) return;
      if (!accountUserId(session)) return;
      var sentCall = WBAuth.clientSentWorkouts ? WBAuth.clientSentWorkouts(clientId) : Promise.resolve([]);
      return Promise.all([
        Promise.resolve(WBAuth.clientAccountWorkouts(clientId)).then(function (v) { return v; }, function () { return null; }),
        Promise.resolve(sentCall).then(function (v) { return v; }, function () { return []; })
      ]);
    }).then(function (pair) {
      if (!pair || token !== routeToken || location.hash !== requested) return;
      var account = pair[0] && typeof pair[0] === 'object' ? pair[0] : {};
      var sent = Array.isArray(pair[1]) ? pair[1] : [];
      clientScreen = {
        permission: account.permission || 'hidden',
        workouts: Array.isArray(account.workouts) ? account.workouts : [],
        sent: sent
      };
      paintClientTools();
      if (document.getElementById('client-account')) bindClientTools(clientId, token, requested);
    }).catch(function () {});
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
      if (!session) return goSignedOutHome();
      if (!id || !WBAuth.clientStatus || !window.WBSharing) return showWait();
      return WBAuth.clientStatus(id).then(function (row) {
        if (token !== routeToken || location.hash !== requested) return;
        var status = WBSharing.parseStatus(row);
        if (!status.ok) return showError('Could not load this client.');
        titleEl.textContent = personLabel(status) || 'Client';
        if (!status.shared) {
          app.innerHTML = WBSharing.clientHtml(status, null, null);
          attachClientTools(id, token, requested);
          return;
        }
        return Promise.all([
          WBAuth.clientWorkouts(id),
          WBAuth.clientSessions(id)
        ]).then(function (pair) {
          if (token !== routeToken || location.hash !== requested) return;
          if (!Array.isArray(pair[0]) || !Array.isArray(pair[1])) return showError('Could not load workouts.');
          app.innerHTML = WBSharing.clientHtml(status, pair[0], pair[1]);
          attachClientTools(id, token, requested);
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
  function programsRequested() {
    if (hashPage() === 'programs' || hashPage() === 'preview') return true;
    try {
      if (new URLSearchParams(location.search).get('preview') === 'programs') return true;
      var q = location.hash.split('?')[1] || '';
      if (q && new URLSearchParams(q).get('preview') === 'programs') return true;
    } catch (e) {}
    return false;
  }
  function linkedWorkout(id, name, items) {
    if (!id || !Array.isArray(items) || !items.length) return null;
    var copy = items;
    try { copy = JSON.parse(JSON.stringify(items)); } catch (e) { copy = items.slice(); }
    return { id: String(id), name: name || 'Workout', items: copy };
  }
  function matchClientWorkout(row, workoutId) {
    if (!row) return null;
    var local = row.localId != null ? row.localId : (row.local_id != null ? row.local_id : row.id);
    if (String(local || '') !== String(workoutId || '')) return null;
    return linkedWorkout(local, row.name, row.items);
  }
  function firstClientWorkout(list, workoutId) {
    var found = null;
    (list || []).forEach(function (row) {
      if (!found) found = matchClientWorkout(row, workoutId);
    });
    return found;
  }
  // The linked client's workout, not a workout stored on this device.
  function loadLinkedWorkout(clientId, workoutId) {
    if (!clientId || !workoutId || !window.WBAuth) return Promise.resolve(null);
    function call(name) {
      var fn = WBAuth[name];
      if (typeof fn !== 'function') return Promise.resolve(null);
      return Promise.resolve().then(function () { return fn.call(WBAuth, clientId); }).then(function (value) {
        return value;
      }, function () { return null; });
    }
    return Promise.all([
      call('clientAccountWorkouts'),
      call('clientSentWorkouts'),
      call('clientWorkouts')
    ]).then(function (parts) {
      var account = parts[0];
      var accountRows = account && Array.isArray(account.workouts) ? account.workouts : (Array.isArray(account) ? account : []);
      var sent = Array.isArray(parts[1]) ? parts[1] : [];
      var own = Array.isArray(parts[2]) ? parts[2] : [];
      return firstClientWorkout(accountRows, workoutId) || firstClientWorkout(sent, workoutId) || firstClientWorkout(own, workoutId) || null;
    });
  }
  function trackedSessions() {
    var rows = Array.isArray(data.sessions) ? data.sessions.slice() : [];
    if (window.WBSharing) {
      var log = WBSharing.readLog(localStorage);
      if (Array.isArray(log)) rows = rows.concat(log);
    }
    return rows;
  }
  function openPrograms() {
    try {
      var u = new URL(location.href);
      var changed = false;
      if (u.searchParams.get('preview') === 'programs') {
        u.searchParams.delete('preview');
        changed = true;
      }
      var hashQuery = (u.hash || '').split('?')[1] || '';
      if (hashQuery && new URLSearchParams(hashQuery).get('preview') === 'programs') changed = true;
      if (hashPage() !== 'programs') changed = true;
      if (changed) {
        var search = u.searchParams.toString();
        var next = u.pathname + (search ? '?' + search : '') + '#/programs';
        history.replaceState(null, '', next);
      }
    } catch (e) {}
    app.onclick = null; app.oninput = null; app.onchange = null;
    if (!window.WBPreview) return;
    WBPreview.mount({
      app: app,
      titleEl: titleEl,
      backBtn: backBtn,
      data: data,
      persist: persistLocal,
      go: go,
      toast: toast,
      sessions: trackedSessions,
      loadProfile: function () { return ensureProfile(); },
      loadSession: function () { return WBAuth.session ? WBAuth.session() : Promise.resolve(null); },
      loadRoster: function () { return WBAuth.roster ? WBAuth.roster() : Promise.resolve(null); },
      loadShare: function () { return WBAuth.shareSetting ? WBAuth.shareSetting() : Promise.resolve(null); },
      loadClient: function (id) { return WBAuth.clientStatus ? WBAuth.clientStatus(id) : Promise.resolve(null); },
      loadEntries: function (ownerId) { return WBAuth.programEntries ? WBAuth.programEntries(ownerId) : Promise.reject(new Error('programs')); },
      loadEntriesFor: function (ownerIds) { return WBAuth.programEntriesFor ? WBAuth.programEntriesFor(ownerIds) : Promise.reject(new Error('programs')); },
      loadSessions: function (ownerIds) { return WBAuth.calendarSessions ? WBAuth.calendarSessions(ownerIds) : Promise.resolve([]); },
      loadClientWorkout: function (clientId, workoutId) { return loadLinkedWorkout(clientId, workoutId); },
      saveEntry: function (entry) { return WBAuth.saveProgramEntry ? WBAuth.saveProgramEntry(entry) : Promise.reject(new Error('programs')); },
      deleteEntry: function (entry) { return WBAuth.deleteProgramEntry ? WBAuth.deleteProgramEntry(entry.ownerId, entry.id) : Promise.reject(new Error('programs')); },
      loadCalendar: function (zone, token) { return WBAuth.calendarFeed ? WBAuth.calendarFeed(zone, token) : Promise.reject(Object.assign(new Error('local'), { local: true })); },
      resetCalendar: function (zone) { return WBAuth.resetCalendarFeed ? WBAuth.resetCalendarFeed(zone) : Promise.reject(Object.assign(new Error('local'), { local: true })); },
      onTracked: function () { capturePlayedSession(); }
    });
  }
  function route() {
    accessWaitOn = false;
    capturePlayedSession();
    var token = ++routeToken;
    window.WBPlayer && WBPlayer.unmount();
    window.WBMessages && WBMessages.stop();
    window.WBHub && WBHub.stop();
    window.WBSends && WBSends.stop();
    window.WBCircuitSession && WBCircuitSession.stop();
    window.WBCircuits && WBCircuits.stop();
    window.WBPreview && WBPreview.unmount();
    document.body.classList.remove('playing');
    var page = hashPage();
    captureInvite();
    showHeaderSignIn(false);
    // A bare visit keeps the marketing page up while the session check runs, so
    // signed-out visitors never see the empty Workouts header. A stored session
    // already hid it. Invite and recovery visits hide it here and open their own screen.
    var publicRoot = (location.hash === '' || location.hash === '#') && !(linkInviteCode() || inviteArrival);
    var recoveryNow = recoveryPhase === 'checking' || recoveryPhase === 'form' || recoveryPhase === 'retry' ||
      (!recoverySettled && !recoveryPhase && WBAuth.recoveryArrival && WBAuth.recoveryArrival()) ||
      (!recoverySettled && !recoveryPhase && recoveryLocked());
    if (publicRoot && !recoveryNow && !storedSession() && !signedInNow) showLanding();
    else hideLanding();
    // Recovery links are claimed before any guard replaces the hash or sends
    // a signed-out person to the normal sign-in page.
    if (recoveryPhase === 'checking') return renderReset();
    if (recoveryPhase === 'form' || recoveryPhase === 'retry') {
      if (page !== 'reset') replaceAuthHash('#/reset');
      return renderReset(recoveryPhase === 'retry' ? recoveryMessage : '', recoveryPhase === 'retry');
    }
    if (!recoverySettled && !recoveryPhase && WBAuth.recoveryArrival && WBAuth.recoveryArrival()) return beginRecovery(token);
    if (!recoverySettled && !recoveryPhase && recoveryLocked()) return resumeRecovery(token);
    // Sign-in, create-account, and forgot/reset password stay reachable with no session.
    // A signed-out visit that carries an invite code opens create-account with the code filled in.
    // Sign-in has no code box. A stored code is still redeemed after sign-in.
    // A bare visit with no invite keeps the public landing.
    // Any other signed-out visit, including #/subscriptions, opens the landing page.
    // Recovery links are claimed above. A failed session check still opens sign-in.
    if (page === 'signin' || page === 'join' || page === 'forgot' || page === 'reset') {
      profileGateOn = false;
      closeProfileSheet(true);
    } else closeProfileSheet(false);
    syncHeaderSignOut();
    showHeaderSignIn(false);
    // The arrival flag only forces the first landing onto create-account. Once that
    // page is open, a later hash without ?invite= can show Subscriptions.
    if (page === 'signin' && inviteArrival) return go('#/join');
    if (page === 'signin' || page === 'join') inviteArrival = '';
    if (page === 'signin') return renderSign('in');
    if (page === 'join') return renderSign('up');
    if (page === 'forgot') return renderForgot();
    if (page === 'reset') {
      recoveryPhase = 'invalid';
      recoverySettled = true;
      return renderReset();
    }
    var requested = location.hash;
    app.innerHTML = '';
    app.onclick = null; app.oninput = null; app.onchange = null;
    var pending;
    try { pending = WBAuth.session(); } catch (e) { hideLanding(); return go('#/signin'); }
    if (!pending || !pending.then) { hideLanding(); return go('#/signin'); }
    pending.then(function (session) {
      if (token !== routeToken || location.hash !== requested) return;
      if (!session) {
        signedInNow = false;
        if (publicRoot && !recoveryNow && (location.hash === '' || location.hash === '#')) return showLanding();
        hideLanding();
        return goSignedOutHome();
      }
      signedInNow = true;
      hideLanding();
      if (page === 'subscriptions') return renderSubscriptions();
      openSignedIn(token, requested, page);
    }).catch(function (err) {
      if (token !== routeToken || location.hash !== requested) return;
      hideLanding();
      if (page === 'subscriptions') return showSignInNotice((err && err.message) || 'Could not reach sign-in', true);
      go('#/signin');
    });
  }
  function releasePendingImage() {
    if (!draft || !draft.pendingUrl) return;
    try { URL.revokeObjectURL(draft.pendingUrl); } catch (e) {}
    draft.pendingUrl = '';
  }
  var workoutsNav = document.getElementById('workouts-nav');
  if (workoutsNav) workoutsNav.addEventListener('click', function () {
    var ids = [];
    (data.workouts || []).forEach(function (w) { if (w && w.sourceTrainerId) ids.push(w.id); });
    if (ids.length) markReceivedSeen(ids);
  });
  window.addEventListener('hashchange', function () {
    closeLibStill();
    releasePendingImage();
    draft = null;
    if (hashPage() !== 'signin') pendingSignNotice = null;
    // While a recovery link is still being read, ignore hash churn from the
    // auth client so the token is not thrown away for the sign-in page.
    if (recoveryPhase !== 'checking') route();
    window.scrollTo(0, 0);
  });
  window.addEventListener('popstate', function () { closeLibStill(); });

  // ---------- Exercise history ----------
  function historyImageKey(stableKey) {
    if (!stableKey) return '';
    var found = '';
    (data.workouts || []).forEach(function (w) {
      (w && w.items || []).forEach(function (it) {
        if (!it || String(it.id) !== String(stableKey)) return;
        var media = M.cleanMedia(it.media);
        if (media && media.kind === 'custom') found = media.imageKey;
      });
    });
    return found;
  }
  function bindHistoryImages() {
    Array.prototype.forEach.call(app.querySelectorAll('.hx-thumb img'), function (img) {
      function drop() {
        var thumb = img.closest ? img.closest('.hx-thumb') : null;
        if (thumb && thumb.parentNode) thumb.parentNode.removeChild(thumb);
      }
      img.addEventListener('error', drop);
      if (img.complete && img.naturalWidth === 0) drop();
    });
    if (!window.WBMedia) return;
    Array.prototype.forEach.call(app.querySelectorAll('[data-hx-img]'), function (el) {
      var key = el.getAttribute('data-hx-img');
      WBMedia.url(key).then(function (u) {
        if (!u || !el.isConnected) {
          if (el.parentNode) el.parentNode.removeChild(el);
          return;
        }
        var img = document.createElement('img');
        img.alt = '';
        img.src = u;
        el.appendChild(img);
      }).catch(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    });
  }
  function historyOpts() {
    return { stillBase: gifBase(), imageKey: historyImageKey };
  }
  // Keyboard moves between Tracking tabs. The id is restored after the page
  // rebuilds, including the second paint once history rows arrive.
  var trackingKeyFocus = '';
  var shareUnread = 0;
  var shareRows = [];
  var shareLoadError = false;
  var trainerRoster = { clients: [] };
  var editorClient = '';
  var trackingClient = '';
  var clientShareMap = {};
  var clientShareGen = 0;
  var trainerOrder = null;
  var trainerModel = null;
  var dashboardEditing = false;
  var editDraft = null;
  var historyListView = 'workout';
  var historySets = [];
  var historyUnavailable = false;
  function historyParts() {
    return hashBody().split('/');
  }
  // #/history/client/<id>/... keeps the picked person in the address so a
  // reload still reads that client. Own details stay #/history/session/<id>.
  function historyClientOffset() {
    var parts = historyParts();
    return hashPage() === 'history' && parts[1] === 'client' ? 2 : 0;
  }
  function historySessionId() {
    if (hashPage() !== 'history') return '';
    var parts = historyParts();
    var at = historyClientOffset() + 1;
    if (parts[at] !== 'session' || !parts[at + 1]) return '';
    var raw = parts.slice(at + 1).join('/');
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }
  function historyRouteKey() {
    if (hashPage() !== 'history') return '';
    if (historySessionId()) return '';
    var parts = historyParts();
    var at = historyClientOffset();
    if (at) return parts[at + 1] ? decodeHashPart(parts[at + 1]) : '';
    return parts[1] || '';
  }
  function historyFocusKey() {
    var sessionId = historySessionId();
    if (sessionId) return 'session:' + sessionId;
    return historyRouteKey();
  }
  function showingHistoryList() {
    if (hashPage() === 'history') return !historyFocusKey();
    return hashPage() === 'tracking' && hashBody().split('/')[1] !== 'dashboard';
  }
  function historyViewCurrent(token, key) {
    if (token !== routeToken) return false;
    if (key) return hashPage() === 'history' && historyFocusKey() === key;
    return showingHistoryList();
  }
  function trackingTabHtml(id, label, on, extra) {
    var track = id === 'tracking-tab-dashboard' ? 'dashboard' : 'history';
    return '<button type="button" id="' + id + '" role="tab" data-track="' + track + '"' +
      ' aria-selected="' + (on ? 'true' : 'false') + '" aria-controls="tracking-panel" tabindex="' + (on ? '0' : '-1') + '"' +
      (on ? ' class="on"' : '') + '>' + label + (extra || '') + '</button>';
  }
  function trackingTabsHtml(which) {
    var historyOn = which !== 'dashboard';
    // dashboard-count is the red number of shared dashboards not yet opened.
    return '<div class="seg" id="tracking-tabs" role="tablist" aria-label="Tracking">' +
      trackingTabHtml('tracking-tab-history', 'History', historyOn) +
      trackingTabHtml('tracking-tab-dashboard', 'Dashboard', !historyOn, '<span class="dashboard-count" id="dashboard-count" hidden></span>') +
      '</div>';
  }
  function trackingShell(which, body) {
    var tabId = which === 'dashboard' ? 'tracking-tab-dashboard' : 'tracking-tab-history';
    return trackingTabsHtml(which) +
      '<div id="tracking-panel" role="tabpanel" aria-labelledby="' + tabId + '">' + body + '</div>';
  }
  function paintDashboardCount(n) {
    var badge = document.getElementById('dashboard-count');
    if (!badge) return;
    var count = Math.max(0, Number(n) || 0);
    if (!count) {
      badge.hidden = true;
      badge.textContent = '';
      badge.removeAttribute('aria-label');
      return;
    }
    badge.hidden = false;
    badge.textContent = String(count);
    badge.setAttribute('aria-label', count === 1 ? '1 shared dashboard' : (count + ' shared dashboards'));
  }
  function bindTrackingTabs(settle) {
    var tabs = document.getElementById('tracking-tabs');
    if (!tabs) return;
    tabs.onkeydown = function (e) {
      var buttons = Array.prototype.slice.call(tabs.querySelectorAll('[role="tab"]'));
      var current = e.target && e.target.closest ? e.target.closest('[role="tab"]') : null;
      if (!current || buttons.indexOf(current) < 0) return;
      if (e.key === 'Enter' || e.key === ' ') {
        trackingKeyFocus = current.id;
        return;
      }
      var delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : null;
      var index = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : null;
      if (delta == null && index == null) return;
      e.preventDefault();
      var i = buttons.indexOf(current);
      var next = index == null ? buttons[(i + delta + buttons.length) % buttons.length] : buttons[index];
      trackingKeyFocus = next.id;
      next.click();
    };
    var selected = tabs.querySelector('[role="tab"][aria-selected="true"]');
    // A click or arrow can land after an older tab id was saved. Follow the
    // tab that is actually selected, including the paint while history loads.
    if (!selected || (trackingKeyFocus && trackingKeyFocus !== selected.id)) trackingKeyFocus = selected ? selected.id : '';
    if (!trackingKeyFocus) return;
    selected.focus();
    if (settle) trackingKeyFocus = '';
  }
  function onTrackingClick(e) {
    var tab = e.target.closest('[data-track]');
    if (!tab) return false;
    var which = tab.getAttribute('data-track') === 'dashboard' ? 'dashboard' : 'history';
    var dest = trackingHash(which, trainerAccount() ? activeTrackingClient() : '');
    if (location.hash === dest) trackingKeyFocus = '';
    else {
      trackingKeyFocus = tab.id;
      go(dest);
    }
    return true;
  }
  function paintTracking(which, body, settle) {
    titleEl.textContent = 'Tracking';
    app.innerHTML = trackingShell(which, body);
    bindTrackingTabs(!!settle);
    paintDashboardCount(countsShares() ? shareUnread : 0);
    app.onclick = function (e) {
      if (onTrackingClick(e)) return;
      if (onDashboardClick(e)) return;
      if (which !== 'history') return;
      var viewBtn = e.target.closest('[data-history-view]');
      if (viewBtn) {
        var nextView = viewBtn.getAttribute('data-history-view') === 'exercise' ? 'exercise' : 'workout';
        if (nextView !== historyListView) {
          historyListView = nextView;
          paintHistory('', historySets, historyUnavailable);
        }
        return;
      }
      var sessionBtn = e.target.closest('[data-session]');
      if (sessionBtn) {
        go(historyDetailHash('session', sessionBtn.getAttribute('data-session') || ''));
        return;
      }
      var button = e.target.closest('[data-history]');
      if (!button) return;
      go(historyDetailHash('exercise', button.getAttribute('data-history')));
    };
    bindPicker();
  }
  function freeClient() {
    if (!cachedProfile || !window.WBPrograms) return false;
    return WBPrograms.roleOf(cachedProfile) === 'free_client';
  }
  // Free clients, and anyone who chose a plan but has not paid, open shared
  // copies instead of a live sheet. Choosing Enthusiast without paying leaves
  // membership at none.
  function shareInbox() {
    return freeClient() || !!(window.WBDashboard && !WBDashboard.allowed(cachedProfile) && !trainerAccount());
  }
  // A paid Enthusiast keeps the live, view-only sheet and can also open shares.
  function paidEnthusiast() {
    return !!(cachedProfile && cachedProfile.membership === 'enthusiast');
  }
  function countsShares() {
    return shareInbox() || paidEnthusiast();
  }
  function trainerAccount() {
    return !!(window.WBPrograms && WBPrograms.isTrainer(WBPrograms.roleOf(cachedProfile)));
  }
  function trackingTail() {
    var parts = hashBody().split('/');
    var id = parts[3] || '';
    try { id = decodeURIComponent(id); } catch (e) {}
    return { dashboard: parts[1] === 'dashboard', kind: parts[2] || '', id: id };
  }
  function onDashboard(token) {
    return token === routeToken && hashPage() === 'tracking' && trackingTail().dashboard;
  }
  function refreshShareCount(token) {
    if (!countsShares()) {
      shareUnread = 0;
      shareRows = [];
      shareLoadError = false;
      return Promise.resolve({ rows: [], error: false });
    }
    var pending;
    try { pending = WBAuth.myShares ? WBAuth.myShares() : Promise.resolve({ unavailable: true, shares: [] }); }
    catch (e) { pending = Promise.resolve({ unavailable: true, shares: [] }); }
    return Promise.resolve(pending).then(function (res) {
      if (token !== routeToken || !countsShares()) return { rows: shareRows.slice(), error: false };
      if (res && res.error) return shareLoadFailed(token);
      shareLoadError = false;
      var rows = res && Array.isArray(res.shares) ? res.shares : [];
      shareRows = window.WBShares ? WBShares.byNewest(rows) : rows.slice();
      shareUnread = window.WBShares ? WBShares.unread(shareRows) : 0;
      paintDashboardCount(shareUnread);
      return { rows: shareRows.slice(), error: false };
    }, function () {
      return shareLoadFailed(token);
    });
  }
  function shareLoadFailed(token) {
    if (token !== routeToken || !countsShares()) return { rows: [], error: true };
    shareLoadError = true;
    paintDashboardCount(shareUnread);
    return { rows: shareRows.slice(), error: true };
  }
  // An Enthusiast is membership or intended plan, or the roster plan label.
  // Free Clients stay Free Clients. Same rule as the All-clients calendar.
  function enthusiastClient(c) {
    if (!c) return false;
    if (c.enthusiast === true) return true;
    if (window.WBPrograms && WBPrograms.ownerPlanOf(c) === 'enthusiast') return true;
    var membership = String(c.membership || '').toLowerCase();
    var intended = String(c.intended_plan || c.intendedPlan || '').toLowerCase();
    return membership.indexOf('enthusiast') !== -1 || intended === 'enthusiast';
  }
  function clientChoices() {
    var free = [];
    var fans = [];
    var rows = trainerRoster && Array.isArray(trainerRoster.clients) ? trainerRoster.clients : [];
    rows.forEach(function (c) {
      if (!c || !window.WBShares || !WBShares.isUuid(c.id)) return;
      var enthusiast = enthusiastClient(c);
      var name = personLabel(c);
      if (!name) name = enthusiast ? 'Enthusiast' : 'Client';
      var choice = {
        id: String(c.id),
        name: name,
        plan: c.plan || '',
        membership: c.membership || '',
        enthusiast: enthusiast
      };
      if (enthusiast) fans.push(choice);
      else free.push(choice);
    });
    return free.concat(fans);
  }
  function clientRecord(id) {
    var found = null;
    clientChoices().forEach(function (c) { if (c.id === id) found = c; });
    return found;
  }
  // Any connected client can receive a frozen copy, including a paid Enthusiast.
  // Their live sheet stays in place. The roster plan label does not decide.
  function receivesShares(client) {
    return !!(client && client.id);
  }
  function clientShareStatus(id) {
    if (!Object.prototype.hasOwnProperty.call(clientShareMap, id)) return undefined;
    return clientShareMap[id];
  }
  // Free Clients are always visible. An Enthusiast is visible only while
  // share_status says sharing is on. A missing answer stays hidden.
  function clientShared(choice) {
    if (!choice || !choice.enthusiast) return true;
    var status = clientShareStatus(choice.id);
    if (!status || typeof status.shared !== 'boolean' || typeof status.enthusiast !== 'boolean') return false;
    if (status.enthusiast !== true) return true;
    return status.shared === true;
  }
  function clientMenuLabel(choice) {
    if (choice && choice.enthusiast && !clientShared(choice)) return choice.name + ' · Not shared';
    return choice ? choice.name : '';
  }
  function notSharedHtml() {
    return '<div class="card" id="tracking-private"><div class="name">Not shared</div><p class="mute">This Enthusiast has turned off sharing.</p></div>';
  }
  function clientMissingHtml() {
    return '<div class="card" id="client-missing"><div class="name">That client is not connected.</div></div>';
  }
  function decodeHashPart(value) {
    try { return decodeURIComponent(value || ''); } catch (e) { return value || ''; }
  }
  // Null means this hash does not name a person. An empty string is the
  // trainer's own tracking. A client detail keeps the id in the address.
  function trackingClientFromHash() {
    var parts = hashBody().split('/');
    if (hashPage() === 'history') {
      if (parts[1] === 'client') return decodeHashPart(parts[2] || '');
      return null;
    }
    if (hashPage() !== 'tracking') return null;
    if (parts[1] === 'dashboard') {
      if (parts[2] === 'client') return decodeHashPart(parts[3] || '');
      return '';
    }
    if (parts[1] === 'client') return decodeHashPart(parts[2] || '');
    return '';
  }
  function activeTrackingClient() {
    var fromHash = trackingClientFromHash();
    if (fromHash != null) {
      trackingClient = fromHash;
      return fromHash;
    }
    return trackingClient || '';
  }
  function trackingHash(which, clientId) {
    var id = clientId || '';
    if (!id || !window.WBShares || !WBShares.isUuid(id)) id = '';
    if (which === 'dashboard') {
      return id ? '#/tracking/dashboard/client/' + encodeURIComponent(id) : '#/tracking/dashboard';
    }
    return id ? '#/tracking/client/' + encodeURIComponent(id) : '#/tracking';
  }
  function historyDetailHash(kind, value) {
    var piece = kind === 'session'
      ? 'session/' + encodeURIComponent(value || '')
      : encodeURIComponent(value || '');
    var clientId = trainerAccount() ? activeTrackingClient() : '';
    if (clientId && window.WBShares && WBShares.isUuid(clientId)) {
      return '#/history/client/' + encodeURIComponent(clientId) + '/' + piece;
    }
    return '#/history/' + piece;
  }
  function historyListHash() {
    var id = trainerAccount() ? (activeTrackingClient() || '') : '';
    return trackingHash('history', id);
  }
  function pickerHtml(selected) {
    if (!trainerAccount() || !window.WBPreview) return '';
    var options = [{ value: '', label: selfOptionLabel() }];
    clientChoices().forEach(function (c) { options.push({ value: c.id, label: clientMenuLabel(c) }); });
    return '<div id="client-pick-wrap">' + WBPreview.clientSelectHtml({
      id: 'client-pick',
      label: 'Client',
      selected: selected || '',
      options: options
    }) + '</div>';
  }
  function readRoster() {
    var pending;
    try { pending = WBAuth.roster ? WBAuth.roster() : Promise.resolve(null); }
    catch (e) { pending = Promise.resolve(null); }
    return Promise.resolve(pending).then(function (res) {
      trainerRoster = res && Array.isArray(res.clients) ? res : { clients: [] };
      return trainerRoster;
    }, function () {
      trainerRoster = { clients: [] };
      return trainerRoster;
    });
  }
  function loadClientShares() {
    var gen = ++clientShareGen;
    return readRoster().then(function () {
      if (gen !== clientShareGen) return clientShareMap;
      var people = clientChoices().filter(function (c) { return c.enthusiast; });
      if (!people.length || !window.WBAuth || typeof WBAuth.clientStatus !== 'function') {
        var locked = {};
        people.forEach(function (c) { locked[c.id] = null; });
        if (gen === clientShareGen) clientShareMap = locked;
        return clientShareMap;
      }
      return Promise.all(people.map(function (c) {
        return Promise.resolve().then(function () { return WBAuth.clientStatus(c.id); }).then(function (status) {
          if (!status || typeof status.shared !== 'boolean' || typeof status.enthusiast !== 'boolean') return { id: c.id, status: null };
          return { id: c.id, status: status };
        }, function () {
          return { id: c.id, status: null };
        });
      })).then(function (rows) {
        if (gen !== clientShareGen) return clientShareMap;
        var next = {};
        rows.forEach(function (row) { next[row.id] = row.status; });
        clientShareMap = next;
        return clientShareMap;
      });
    });
  }
  function bindPicker() {
    var sel = document.getElementById('client-pick');
    if (!sel) return;
    sel.onchange = function () {
      var clientId = sel.value;
      var which = hashPage() === 'tracking' && hashBody().split('/')[1] === 'dashboard' ? 'dashboard' : 'history';
      go(trackingHash(which, clientId));
    };
  }
  function selfOptionLabel() {
    var name = personLabel(cachedProfile || {});
    if (!name || name.indexOf('@') !== -1) return 'Me';
    return 'Me · ' + name;
  }
  function trainerName() {
    var p = cachedProfile || {};
    var name = personLabel({ display_name: p.display_name, plan: 'Trainer' });
    if (!name || name.indexOf('@') !== -1) name = 'Trainer';
    return name.slice(0, 80);
  }
  function dashboardDay() {
    var d = dashboardNow();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  var layoutWrite = Promise.resolve();
  var layoutLoaded = false;
  var layoutCanSave = false;
  var ownLayoutOrder = null;
  function paintClientEditor() {
    if (!window.WBDashboard || !trainerModel) return;
    var self = !editorClient;
    var order = dashboardEditing && Array.isArray(editDraft) ? editDraft : trainerOrder;
    var editor = WBDashboard.editorHtml(trainerModel, order, {
      self: self,
      share: !self && receivesShares(clientRecord(editorClient)),
      editing: dashboardEditing
    });
    var pick = pickerHtml(editorClient);
    if (pick) editor = editor.replace('<div id="dash-editor">', '<div id="dash-editor" class="dash-top">' + pick);
    var body = editor;
    paintTracking('dashboard', body, true);
  }
  function rememberOwnOrder(order) {
    ownLayoutOrder = Array.isArray(order) ? order.slice() : null;
  }
  // A failed read is not "never saved". Keep the last own-dashboard order.
  // trainerOrder is also the client editor's working list, so it is not the fallback.
  function adoptOwnOrder(res) {
    if (!window.WBShares) {
      layoutCanSave = false;
      return Array.isArray(ownLayoutOrder) ? ownLayoutOrder.slice() : [];
    }
    if (!res || res.error) {
      var keep = layoutLoaded && Array.isArray(ownLayoutOrder);
      layoutCanSave = false;
      toast(keep ? 'Could not refresh your saved dashboard.' : 'Could not load your saved dashboard.');
      return keep ? ownLayoutOrder.slice() : WBShares.standard();
    }
    layoutLoaded = true;
    layoutCanSave = true;
    var order = Array.isArray(res.cards) ? WBShares.orderOf(res.cards) : WBShares.standard();
    rememberOwnOrder(order);
    return order;
  }
  function whenLayoutWritesFinish() {
    var seen = layoutWrite;
    return seen.catch(function () { return null; }).then(function () {
      if (layoutWrite !== seen) return whenLayoutWritesFinish();
      return null;
    });
  }
  function saveOwnLayout(order) {
    if (editorClient) return;
    if (!layoutCanSave) {
      toast('Could not load your saved dashboard, so this change was not saved.');
      return;
    }
    var cards = (order || []).slice();
    layoutWrite = layoutWrite.catch(function () { return null; }).then(function () {
      var pending;
      try {
        pending = WBAuth.saveDashboardLayout ? WBAuth.saveDashboardLayout(cards) : Promise.resolve({ ok: false, unavailable: true });
      } catch (e) { pending = Promise.resolve({ ok: false }); }
      return Promise.resolve(pending).then(function (res) {
        if (res && res.ok) return;
        toast(res && res.unavailable ? 'Saving your layout is not available yet.' : 'Could not save your dashboard.');
      }, function () {
        toast('Could not save your dashboard.');
      });
    });
  }
  function visibleOrder() {
    var source = dashboardEditing && Array.isArray(editDraft) ? editDraft : (trainerOrder || []);
    return window.WBShares ? WBShares.orderOf(source) : source.slice();
  }
  function beginEdit() {
    if (dashboardEditing || !trainerModel) return;
    dashboardEditing = true;
    editDraft = (trainerOrder || []).slice();
    paintClientEditor();
  }
  function reviseDraft(next) {
    if (!dashboardEditing) return;
    editDraft = next;
    paintClientEditor();
  }
  function saveDashboardEdit() {
    if (!dashboardEditing || !window.WBShares) return;
    var next = WBShares.orderOf(editDraft || []);
    trainerOrder = next;
    dashboardEditing = false;
    editDraft = null;
    if (!editorClient) rememberOwnOrder(next);
    paintClientEditor();
    if (!editorClient) saveOwnLayout(next);
  }
  function resetOwnLayout() {
    if (!window.WBShares) return;
    if (editorClient) {
      dashboardEditing = false;
      editDraft = null;
      trainerOrder = WBShares.standard();
      paintClientEditor();
      toast('Dashboard reset.');
      return;
    }
    if (!layoutCanSave) {
      toast('Could not load your saved dashboard, so this change was not saved.');
      return;
    }
    dashboardEditing = false;
    editDraft = null;
    trainerOrder = WBShares.standard();
    rememberOwnOrder(trainerOrder);
    paintClientEditor();
    layoutWrite = layoutWrite.catch(function () { return null; }).then(function () {
      var pending;
      try {
        pending = WBAuth.resetDashboardLayout ? WBAuth.resetDashboardLayout() : Promise.resolve({ ok: false, unavailable: true });
      } catch (e) { pending = Promise.resolve({ ok: false }); }
      return Promise.resolve(pending).then(function (res) {
        if (res && res.ok) { toast('Dashboard reset.'); return; }
        toast(res && res.unavailable ? 'Saving your layout is not available yet.' : 'Could not reset your dashboard.');
      }, function () {
        toast('Could not reset your dashboard.');
      });
    });
  }
  function shareCurrent() {
    if (!window.WBDashboard || !trainerModel || !editorClient) return;
    if (!receivesShares(clientRecord(editorClient))) return;
    var order = visibleOrder();
    if (!order.length) return;
    trainerOrder = order.slice();
    if (dashboardEditing) editDraft = order.slice();
    var snap = WBDashboard.freeze(trainerModel, order, { asOf: dashboardDay(), trainerName: trainerName() });
    var btn = document.getElementById('dash-share');
    if (btn) btn.disabled = true;
    var pending;
    try {
      pending = WBAuth.shareDashboard ? WBAuth.shareDashboard({
        clientId: editorClient,
        asOf: snap.asOf,
        trainerName: snap.trainerName,
        cards: snap.cards
      }) : Promise.resolve({ ok: false, unavailable: true });
    } catch (e) { pending = Promise.resolve({ ok: false }); }
    Promise.resolve(pending).then(function (res) {
      if (btn) btn.disabled = !order.length;
      if (res && res.ok) { toast('Dashboard shared.'); return; }
      toast(res && res.unavailable ? 'Sharing is not available yet.' : 'Could not share that dashboard.');
    }, function () {
      if (btn) btn.disabled = false;
      toast('Could not share that dashboard.');
    });
  }
  function onDashboardClick(e) {
    if (e.target.closest('#dashboard-find')) {
      var note = document.getElementById('dashboard-hub');
      if (note) note.hidden = false;
      return true;
    }
    var message = e.target.closest('#dashboard-message');
    if (message) {
      var trainerId = message.getAttribute('data-trainer');
      if (trainerId) go('#/messages/' + encodeURIComponent(trainerId));
      return true;
    }
    if (e.target.closest('#dashboard-upgrade')) { go('#/subscriptions'); return true; }
    var opened = e.target.closest('[data-share]');
    if (opened) {
      go('#/tracking/dashboard/share/' + encodeURIComponent(opened.getAttribute('data-share')));
      return true;
    }
    if (e.target.closest('#dash-share')) { shareCurrent(); return true; }
    if (e.target.closest('#dash-reset')) { resetOwnLayout(); return true; }
    if (e.target.closest('#dash-edit')) { beginEdit(); return true; }
    if (e.target.closest('#dash-save')) { saveDashboardEdit(); return true; }
    var add = e.target.closest('[data-card-add]');
    if (add && dashboardEditing && window.WBShares) {
      reviseDraft(WBShares.addCard(editDraft, add.getAttribute('data-card-add')));
      return true;
    }
    var up = e.target.closest('[data-card-up]');
    if (up && dashboardEditing && window.WBShares) {
      reviseDraft(WBShares.moveCard(editDraft, up.getAttribute('data-card-up'), -1));
      return true;
    }
    var down = e.target.closest('[data-card-down]');
    if (down && dashboardEditing && window.WBShares) {
      reviseDraft(WBShares.moveCard(editDraft, down.getAttribute('data-card-down'), 1));
      return true;
    }
    var remove = e.target.closest('[data-card-remove]');
    if (remove && dashboardEditing && window.WBShares) {
      reviseDraft(WBShares.removeCard(editDraft, remove.getAttribute('data-card-remove')));
      return true;
    }
    return false;
  }
  function freeEmptyHtml(connection) {
    var trainerId = connection && connection.trainerId ? String(connection.trainerId) : '';
    var linked = window.WBShares && WBShares.isUuid(trainerId);
    var h = '<div class="card" id="dashboard-soon"><div class="name">Your trainer can share a dashboard with you.</div><div class="actions">';
    if (linked) h += '<button type="button" class="pri" id="dashboard-message" data-trainer="' + esc(trainerId) + '">Message your trainer</button>';
    else h += '<button type="button" id="dashboard-find">Find a trainer</button>';
    h += '<button type="button" class="pri" id="dashboard-upgrade">Upgrade to Enthusiast</button></div>';
    h += '<p class="db-note" id="dashboard-hub" hidden>The Trainer Hub is coming soon.</p></div>';
    return h;
  }
  function shareListHtml(rows) {
    var h = '<div id="share-list">';
    (rows || []).forEach(function (row) {
      if (!row || !row.id) return;
      var stamp = window.WBDashboard ? WBDashboard.stampText({
        asOf: row.as_of || row.asOf,
        trainerName: row.trainer_name || row.trainerName
      }) : '';
      h += '<button type="button" class="card share-row" data-share="' + esc(row.id) + '"><div class="name">' + esc(stamp) + '</div>';
      if (!(row.viewed_at || row.viewedAt)) h += '<div class="mute">Not opened</div>';
      h += '</button>';
    });
    return h + '</div>';
  }
  // Paid Enthusiasts keep the live sheet. Shares, when they have any, sit under it.
  // No shares means nothing extra: no empty-state nudge.
  function enthusiastShareHtml(pack) {
    if (!paidEnthusiast()) return '';
    var rows = pack && Array.isArray(pack.rows) ? pack.rows : [];
    var failed = !!(pack && pack.error);
    if (!rows.length) {
      if (!failed) return '';
      return '<p class="db-note" id="share-stale">The latest shares could not be loaded.</p>';
    }
    var h = '<section id="trainer-shares"><h2 id="trainer-shares-title">Shared by your trainer</h2>';
    if (failed) h += '<p class="db-note" id="share-stale">The latest shares could not be loaded.</p>';
    return h + shareListHtml(rows) + '</section>';
  }
  function dashboardCurrent(token) {
    var tail = trackingTail();
    return token === routeToken && hashPage() === 'tracking' && tail.dashboard && !tail.kind;
  }
  // Tests pin the day. A real visit uses today, so the sheet stays current.
  function dashboardNow() {
    var hooked = window.__wbDashboardNow;
    if (hooked != null && isFinite(Number(hooked))) return new Date(Number(hooked));
    return new Date();
  }
  function dashboardEntries(scheduleRes) {
    var userId = cachedProfile && cachedProfile.id ? String(cachedProfile.id) : '';
    var remote = scheduleRes && Array.isArray(scheduleRes.entries) ? scheduleRes.entries : [];
    if (!window.WBPrograms || !userId) return remote;
    var local = WBPrograms.forOwner(data.programs || [], userId);
    try {
      return WBPrograms.forOwner(WBPrograms.merge(local, remote, userId, {
        dropped: data.programDrops || {}
      }), userId);
    }
    catch (e) { return local; }
  }
  function dashboardWorkouts() {
    return data && Array.isArray(data.workouts) ? data.workouts : [];
  }
  function workoutList(value) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (e) { return []; }
    }
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.workouts)) return value.workouts;
    return [];
  }
  // Saved exercises for this client, so an older Static timer can be recognized.
  // A missing or refused read leaves those rows off the card; it does not fail the sheet.
  function clientDashboardWorkouts(clientId) {
    function quiet(fn) {
      if (typeof fn !== 'function') return Promise.resolve([]);
      var pending;
      try { pending = fn(clientId); } catch (e) { return Promise.resolve([]); }
      return Promise.resolve(pending).then(workoutList, function () { return []; });
    }
    var auth = window.WBAuth || {};
    return Promise.all([
      quiet(auth.clientAccountWorkouts),
      quiet(auth.clientWorkouts),
      quiet(auth.clientSentWorkouts)
    ]).then(function (lists) {
      var out = [];
      lists.forEach(function (rows) {
        rows.forEach(function (row) { if (row) out.push(row); });
      });
      return out;
    }, function () { return []; });
  }
  function paintLoadedDashboard(historyRes, scheduleRes, settle, prefix, sharePack) {
    var failed = !historyRes || historyRes.unavailable || historyRes.error;
    var sessions = historyRes && historyRes.sessions || [];
    var sets = window.WBHistory ? WBHistory.fromRows(sessions, historyRes && historyRes.sets, historyRes && historyRes.exercises) : [];
    var head = prefix || '';
    var extra = enthusiastShareHtml(sharePack);
    if (failed && !sessions.length && !sets.length) {
      paintTracking('dashboard', head + WBDashboard.unavailableHtml() + extra, settle);
      return;
    }
    var model = WBDashboard.build({
      sets: sets,
      sessions: sessions,
      entries: dashboardEntries(scheduleRes),
      workouts: dashboardWorkouts(),
      schemaVersion: data && data.version,
      now: dashboardNow()
    });
    paintTracking('dashboard', head + WBDashboard.html(model) + extra, settle);
  }
  function loadDashboard(token, settle) {
    var pendingHistory;
    var pendingSchedule;
    try {
      pendingHistory = WBAuth.myHistory ? WBAuth.myHistory() : Promise.resolve({ sets: [], sessions: [], exercises: [] });
    } catch (e) {
      pendingHistory = Promise.resolve({ error: true, sets: [], sessions: [], exercises: [] });
    }
    try {
      pendingSchedule = WBAuth.mySchedule ? WBAuth.mySchedule() : Promise.resolve({ unavailable: true, entries: [] });
    } catch (e2) {
      pendingSchedule = Promise.resolve({ unavailable: true, entries: [] });
    }
    var historyReady = Promise.resolve(pendingHistory).then(function (res) {
      return res || { error: true, sets: [], sessions: [], exercises: [] };
    }, function () {
      return { error: true, sets: [], sessions: [], exercises: [] };
    });
    var scheduleReady = Promise.resolve(pendingSchedule).then(function (res) {
      return res || { unavailable: true, entries: [] };
    }, function () {
      return { unavailable: true, entries: [] };
    });
    var rosterReady = trainerAccount() ? loadClientShares() : Promise.resolve(null);
    var shareReady = paidEnthusiast() ? refreshShareCount(token) : Promise.resolve(null);
    var layoutReady = trainerAccount() ? whenLayoutWritesFinish().then(readOwnLayout) : Promise.resolve(null);
    Promise.all([historyReady, scheduleReady, rosterReady, shareReady, layoutReady]).then(function (pair) {
      if (!dashboardCurrent(token)) return;
      if (trainerAccount()) {
        paintTrainerOwn(pair[0], pair[1], pair[4], settle);
        return;
      }
      paintLoadedDashboard(pair[0], pair[1], settle, '', pair[3]);
    });
  }
  function readOwnLayout() {
    var pending;
    try {
      pending = WBAuth.myDashboardLayout ? WBAuth.myDashboardLayout() : Promise.resolve({ unavailable: true, cards: null });
    } catch (e) { pending = Promise.resolve({ unavailable: true, cards: null }); }
    return Promise.resolve(pending).then(function (res) {
      return res || { error: true, cards: null };
    }, function () {
      return { error: true, cards: null };
    });
  }
  function paintTrainerOwn(historyRes, scheduleRes, layoutRes, settle) {
    editorClient = '';
    dashboardEditing = false;
    editDraft = null;
    var failed = !historyRes || historyRes.unavailable || historyRes.error;
    var sessions = historyRes && historyRes.sessions || [];
    var sets = window.WBHistory ? WBHistory.fromRows(sessions, historyRes && historyRes.sets, historyRes && historyRes.exercises) : [];
    if (failed && !sessions.length && !sets.length) {
      trainerModel = null;
      trainerOrder = adoptOwnOrder(layoutRes);
      paintTracking('dashboard', pickerHtml('') + WBDashboard.unavailableHtml(), settle);
      return;
    }
    trainerOrder = adoptOwnOrder(layoutRes);
    trainerModel = WBDashboard.build({
      sets: sets,
      sessions: sessions,
      entries: dashboardEntries(scheduleRes),
      workouts: dashboardWorkouts(),
      schemaVersion: data && data.version,
      now: dashboardNow(),
      layout: true
    });
    paintClientEditor();
  }
  function renderFreeDashboard(token) {
    paintTracking('dashboard', '<p class="mute" id="dashboard-loading">Loading…</p>', false);
    var connP;
    try { connP = WBAuth.myConnection ? WBAuth.myConnection() : Promise.resolve(null); }
    catch (e) { connP = Promise.resolve(null); }
    Promise.all([
      refreshShareCount(token),
      Promise.resolve(connP).then(function (row) { return row || null; }, function () { return null; })
    ]).then(function (pair) {
      if (!dashboardCurrent(token)) return;
      var pack = pair[0] || { rows: [], error: true };
      var rows = pack.rows || [];
      if (pack.error && !rows.length) {
        paintTracking('dashboard', '<div class="card" id="share-error"><div class="name">Shared dashboards could not be loaded.</div><p class="db-note">Try again in a moment.</p></div>', true);
        return;
      }
      var body = rows.length ? shareListHtml(rows) : freeEmptyHtml(pair[1]);
      if (pack.error) body = '<p class="db-note" id="share-stale">The latest shares could not be loaded.</p>' + body;
      paintTracking('dashboard', body, true);
    });
  }
  function renderOpenedShare(token, id) {
    paintTracking('dashboard', '<p class="mute">Loading…</p>', false);
    refreshShareCount(token).then(function () {
      var tail = trackingTail();
      if (!onDashboard(token) || tail.kind !== 'share' || tail.id !== id) return;
      var row = null;
      shareRows.forEach(function (item) { if (item && String(item.id) === String(id)) row = item; });
      if (!row || !window.WBDashboard) {
        var missing = shareLoadError
          ? '<div class="card" id="share-error"><div class="name">Shared dashboards could not be loaded.</div></div>'
          : '<div class="card" id="share-missing"><div class="name">That dashboard is not available.</div></div>';
        paintTracking('dashboard', missing, true);
        return;
      }
      paintTracking('dashboard', WBDashboard.snapshotHtml({
        asOf: row.as_of || row.asOf,
        trainerName: row.trainer_name || row.trainerName,
        cards: row.cards
      }), true);
      if (row.viewed_at || row.viewedAt) return;
      var mark;
      try { mark = WBAuth.markShareViewed ? WBAuth.markShareViewed(row.id) : Promise.resolve({ ok: false }); }
      catch (e2) { mark = Promise.resolve({ ok: false }); }
      Promise.resolve(mark).then(function (res) {
        if (!res || res.ok === false) return;
        if (!onDashboard(token)) return;
        row.viewed_at = res.viewed_at || new Date().toISOString();
        shareUnread = window.WBShares ? WBShares.unread(shareRows) : Math.max(0, shareUnread - 1);
        paintDashboardCount(shareUnread);
      }, function () {});
    });
  }
  function renderClientDashboard(token, clientId) {
    if (!window.WBShares || !WBShares.isUuid(clientId)) return go('#/tracking/dashboard');
    paintTracking('dashboard', '<p class="mute">Loading…</p>', false);
    loadClientShares().then(function () {
      if (!onDashboard(token) || trackingTail().id !== clientId) return;
      trackingClient = clientId;
      var known = clientRecord(clientId);
      if (!known) {
        editorClient = '';
        trainerModel = null;
        dashboardEditing = false;
        editDraft = null;
        paintTracking('dashboard', pickerHtml('') + clientMissingHtml(), true);
        return;
      }
      if (editorClient !== clientId) {
        editorClient = clientId;
        trainerOrder = WBShares.standard();
        trainerModel = null;
        dashboardEditing = false;
        editDraft = null;
      }
      if (!clientShared(known)) {
        trainerModel = null;
        dashboardEditing = false;
        editDraft = null;
        paintTracking('dashboard', pickerHtml(clientId) + notSharedHtml(), true);
        return;
      }
      var historyP;
      var scheduleP;
      try { historyP = WBAuth.clientTracking ? WBAuth.clientTracking(clientId) : Promise.resolve({ error: true, sets: [], sessions: [], exercises: [] }); }
      catch (e) { historyP = Promise.resolve({ error: true, sets: [], sessions: [], exercises: [] }); }
      try { scheduleP = WBAuth.clientSchedule ? WBAuth.clientSchedule(clientId) : Promise.resolve({ unavailable: true, entries: [] }); }
      catch (e2) { scheduleP = Promise.resolve({ unavailable: true, entries: [] }); }
      Promise.all([
        Promise.resolve(historyP).then(function (res) { return res || { error: true, sets: [], sessions: [], exercises: [] }; }, function () { return { error: true, sets: [], sessions: [], exercises: [] }; }),
        Promise.resolve(scheduleP).then(function (res) { return res || { unavailable: true, entries: [] }; }, function () { return { unavailable: true, entries: [] }; }),
        clientDashboardWorkouts(clientId)
      ]).then(function (pair) {
        if (!onDashboard(token) || trackingTail().id !== clientId) return;
        var historyRes = pair[0];
        var failed = !historyRes || historyRes.unavailable || historyRes.error;
        var sessions = historyRes.sessions || [];
        var sets = window.WBHistory ? WBHistory.fromRows(sessions, historyRes.sets, historyRes.exercises) : [];
        if (failed && !sessions.length && !sets.length) {
          trainerModel = null;
          dashboardEditing = false;
          editDraft = null;
          paintTracking('dashboard', pickerHtml(clientId) + WBDashboard.unavailableHtml(), true);
          return;
        }
        var entries = pair[1] && Array.isArray(pair[1].entries) ? pair[1].entries : [];
        trainerModel = WBDashboard.build({
          sets: sets,
          sessions: sessions,
          entries: entries,
          workouts: pair[2] || [],
          // Those copies are written by this app after migrate(). A Static
          // rep type there was chosen. A workout whose own version is under 4
          // is still the old time-only default.
          schemaVersion: window.WB && WB.SCHEMA_VERSION,
          now: dashboardNow(),
          layout: true
        });
        if (!trainerOrder) trainerOrder = WBShares.standard();
        paintClientEditor();
      });
    });
  }
  function renderDashboard(token) {
    var dashTail = trackingTail();
    backBtn.hidden = !(dashTail && dashTail.kind);
    app.oninput = null;
    app.onchange = null;
    var tail = trackingTail();
    if (tail.kind === 'share' && tail.id && countsShares()) return renderOpenedShare(token, tail.id);
    if (shareInbox()) {
      if (tail.kind) return go('#/tracking/dashboard');
      return renderFreeDashboard(token);
    }
    if (!window.WBDashboard) {
      paintTracking('dashboard', '<div class="empty db-empty" id="dashboard-unavailable"><div class="name">Saved sessions are not available yet.</div></div>', true);
      return;
    }
    if (tail.kind === 'client' && trainerAccount()) return renderClientDashboard(token, tail.id);
    if (tail.kind) return go('#/tracking/dashboard');
    paintTracking('dashboard', (trainerAccount() ? '<div id="client-pick-wrap"></div>' : '') + '<div id="dashboard" aria-busy="true"><p class="mute">Loading…</p></div>', false);
    loadDashboard(token, true);
  }
  function renderTracking(token) {
    if (hashPage() === 'tracking' && hashBody().split('/')[1] === 'dashboard') return renderDashboard(token);
    return renderHistory(token);
  }
  function paintHistory(key, sets, unavailable) {
    if (!key && !showingHistoryList()) return;
    historySets = sets || [];
    historyUnavailable = !!unavailable;
    if (!window.WBHistory) {
      if (!key) paintTracking('history', '<div class="empty">History is not available yet.</div>', true);
      else {
        titleEl.textContent = 'History';
        app.innerHTML = '<div class="empty">History is not available yet.</div>';
      }
      return;
    }
    var opts = historyOpts();
    if (unavailable) opts.unavailable = true;
    if (!key) {
      opts.view = historyListView === 'exercise' ? 'exercise' : 'workout';
      var rows = opts.view === 'exercise' ? WBHistory.list(sets) : WBHistory.workouts(sets);
      var body = rows.length ? WBHistory.listHtml(sets, opts) : WBHistory.emptyHtml(opts);
      paintTracking('history', pickerHtml(activeTrackingClient()) + body, true);
      bindHistoryImages();
      var box = document.getElementById('history-q');
      if (box) box.oninput = function () {
        var list = document.getElementById('history-list');
        if (!list) return;
        if (historyListView === 'exercise') {
          list.innerHTML = WBHistory.itemsHtml(WBHistory.decorate(WBHistory.filter(WBHistory.list(sets), box.value), opts));
        } else {
          list.innerHTML = WBHistory.workoutItemsHtml(WBHistory.filterWorkouts(WBHistory.workouts(sets), box.value));
        }
        bindHistoryImages();
      };
      return;
    }
    if (key.indexOf('session:') === 0) {
      var sessionView = WBHistory.sessionDetail(sets, key.slice(8));
      titleEl.textContent = 'Tracking';
      app.innerHTML = WBHistory.sessionHtml(sessionView, opts);
      app.onclick = null;
      app.oninput = null;
      return;
    }
    var view = WBHistory.detail(sets, key);
    titleEl.textContent = view.name || 'History';
    app.innerHTML = WBHistory.detailHtml(view, opts);
    app.onclick = null;
    app.oninput = null;
  }
  function renderHistory(token) {
    app.onclick = null;
    app.oninput = null;
    app.onchange = null;
    if (countsShares()) refreshShareCount(token);
    var fromHash = trackingClientFromHash();
    if (fromHash && !trainerAccount()) return go('#/tracking');
    if (fromHash && (!window.WBShares || !WBShares.isUuid(fromHash))) return go('#/tracking');
    var key = historyFocusKey();
    backBtn.hidden = !key && !trackingClientFromHash();
    if (!key && !showingHistoryList()) return;
    if (!window.WBHistory) {
      if (!key) paintTracking('history', '<div class="empty">History is not available yet.</div>', true);
      else {
        titleEl.textContent = 'History';
        app.innerHTML = '<div class="empty">History is not available yet.</div>';
      }
      return;
    }
    if (!key) paintTracking('history', (trainerAccount() ? '<div id="client-pick-wrap"></div>' : '') + '<p class="mute">Loading…</p>', false);
    else {
      titleEl.textContent = 'History';
      app.innerHTML = '<p class="mute">Loading…</p>';
    }
    var prepare = trainerAccount() ? loadClientShares() : Promise.resolve(null);
    prepare.then(function () {
      if (!historyViewCurrent(token, key)) return;
      var clientId = trainerAccount() ? activeTrackingClient() : '';
      if (clientId) {
        var known = clientRecord(clientId);
        if (!known) {
          historySets = [];
          if (!key) paintTracking('history', pickerHtml('') + clientMissingHtml(), true);
          else {
            titleEl.textContent = 'History';
            app.innerHTML = clientMissingHtml();
          }
          return;
        }
        if (!clientShared(known)) {
          historySets = [];
          if (!key) paintTracking('history', pickerHtml(clientId) + notSharedHtml(), true);
          else {
            titleEl.textContent = 'History';
            app.innerHTML = notSharedHtml();
          }
          return;
        }
      }
      var pending;
      try {
        if (clientId) pending = WBAuth.clientTracking ? WBAuth.clientTracking(clientId) : Promise.resolve({ error: true, sets: [], sessions: [], exercises: [] });
        else pending = WBAuth.myHistory ? WBAuth.myHistory() : Promise.resolve({ sets: [], sessions: [], exercises: [] });
      } catch (e) { pending = Promise.resolve({ error: true, sets: [], sessions: [], exercises: [] }); }
      Promise.resolve(pending).then(function (res) {
        if (!historyViewCurrent(token, key)) return;
        var sets = WBHistory.fromRows(res && res.sessions, res && res.sets, res && res.exercises);
        paintHistory(key, sets, !!(res && (res.unavailable || res.error) && !sets.length));
      }, function () {
        if (!historyViewCurrent(token, key)) return;
        paintHistory(key, [], true);
      });
    });
  }

  // ---------- Workout list ----------
  function renderList() {
    titleEl.textContent = 'Workouts'; backBtn.hidden = true;
    var note = takeInviteNotice();
    var trainerHome = !!(window.WBPrograms && WBPrograms.isTrainer(WBPrograms.roleOf(cachedProfile)));
    var tileIco = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="M12 8v5l3 2"/></svg>';
    var sendIco = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 11.5 21 3l-7.2 18-2.3-7.2z"/></svg>';
    var h = (levelNoteOn ? levelNoteHtml(cachedProfile) : '') +
      (note ? '<div class="' + (note.isError ? 'errs' : 'card') + '">' + esc(note.text) + '</div>' : '') +
      (trainerHome
        ? '<div class="home-tiles" id="home-tiles"><button type="button" class="home-tile" id="circuits-open" data-a="circuits">' + tileIco + '<span class="home-tile-label">Group Circuits</span></button><button type="button" class="home-tile" id="send-nav" data-a="send">' + sendIco + '<span class="home-tile-label">Send workout</span></button></div>'
        : '') +
      '<button class="pri" style="width:100%;margin-bottom:12px" data-a="new">+ New workout</button>';
    var statusLine = libraryStatusHtml();
    if (statusLine) h += statusLine;
    if (!data.workouts.length) h += '<div class="empty">No workouts yet.<br>Tap “New workout” to build one.</div>';
    data.workouts.forEach(function (w, wi) {
      if (!w) return;
      var n = Array.isArray(w.items) ? w.items.length : 0, nW = data.workouts.length;
      var locked = copyLocked(w);
      h += '<div class="card">';
      h += '<div class="name" data-a="open" data-id="' + w.id + '" style="cursor:pointer">' + esc(w.name) + '</div>' +
        '<div class="mute">' + n + ' exercise' + (n === 1 ? '' : 's') +
        (w.sourceTrainerId ? (locked ? ' · You can run it' : ' · You can edit it') : '') + '</div><div class="actions">';
      var canEditCard = !locked && (!!(w && w.sourceTrainerId) || levelCan(cachedProfile, 'open'));
      if (!locked) {
        h += '<button class="sm" data-a="wup" data-id="' + w.id + '" aria-label="Move up"' + (wi === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button class="sm" data-a="wdown" data-id="' + w.id + '" aria-label="Move down"' + (wi === nW - 1 ? ' disabled' : '') + '>▼</button>';
      }
      if (canEditCard) h += '<button class="pri sm" data-a="open" data-id="' + w.id + '">Edit</button>';
      h += '<button class="sm" data-a="view" data-id="' + w.id + '"' + (n ? '' : ' disabled') + '>View</button>' +
        '<button class="sm" data-a="run" data-id="' + w.id + '"' + (n ? '' : ' disabled') + '>Run</button>';
      if (!locked) {
        h += '<button class="sm danger" data-a="del" data-id="' + w.id + '">Delete</button>';
      }
      h += '</div></div>';
    });
    app.innerHTML = h;
    refreshRequestBadges();
    syncChrome();
    if (data.workouts.some(function (w) { return w && w.sourceTrainerId; }) && !cachedProfile) {
      var paint = routeToken;
      ensureProfile().then(function () {
        if (paint !== routeToken || hashPage() !== '' || !cachedProfile) return;
        renderList();
      });
    }
    pullCopies();
    app.onclick = function (e) {
      if (e.target.closest('#level-upgrade')) { levelNoteOn = false; return go('#/subscriptions'); }
      if (e.target.closest('#level-dismiss')) { levelNoteOn = false; return renderList(); }
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.dataset.a, w = getW(b.dataset.id);
      if (a === 'programs' || a === 'preview') return go('#/programs');
      if (a === 'tracking') return go('#/tracking');
      if (a === 'account') return openAccount();
      if (a === 'messages') return go('#/messages');
      if (a === 'hub') return go('#/hub');
      if (a === 'circuits') {
        if (!(window.WBPrograms && WBPrograms.isTrainer(WBPrograms.roleOf(cachedProfile)))) {
          levelNoteOn = true;
          return renderList();
        }
        return go('#/circuits');
      }
      if (a === 'send') {
        if (!levelCan(cachedProfile, 'send')) { levelNoteOn = true; return renderList(); }
        return go('#/send');
      }
      if (a === 'received') return go('#/received');
      if (a === 'new') {
        if (!levelCan(cachedProfile, 'open') || atWorkoutCap(cachedProfile)) { levelNoteOn = true; return renderList(); }
        var name = prompt('Workout name', 'New workout'); if (name === null) return;
        var nw = M.newWorkout(name.trim() || 'New workout'); data.workouts.unshift(nw); persist(); go('#/w/' + nw.id);
      } else if (a === 'open') {
        if (!(w && w.sourceTrainerId) && !levelCan(cachedProfile, 'open')) { levelNoteOn = true; return renderList(); }
        if (w && w.sourceTrainerId) markReceivedSeen([w.id]);
        setCopyReturn(''); go('#/w/' + w.id);
      }
      else if (a === 'run') {
        if (!(w && w.items && w.items.length)) return;
        if (!workoutRunnable(w)) { toast(RUN_NEEDS_NUMBERS); return; }
        if (w && w.sourceTrainerId) markReceivedSeen([w.id]);
        setCopyReturn(''); go('#/play/' + w.id);
      }
      else if (a === 'view') {
        if (!(w && w.items && w.items.length)) return;
        if (w && w.sourceTrainerId) markReceivedSeen([w.id]);
        setCopyReturn(''); go('#/view/' + w.id);
      }
      else if (a === 'del') {
        if (!(w && w.sourceTrainerId) && !levelCan(cachedProfile, 'open')) { levelNoteOn = true; return renderList(); }
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
          } else if (!w.remoteOwnerId) noteDrop(w.id, Date.now());
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
        if (!(w && w.sourceTrainerId) && !levelCan(cachedProfile, 'open')) { levelNoteOn = true; return renderList(); }
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
      '<button class="sm danger" data-a="delex" data-id="' + it.id + '">Delete</button></div></div>';
  }
  function canRenameWorkout(w) {
    if (!w || copyLocked(w) || !window.WBPrograms || !cachedProfile) return false;
    var role = WBPrograms.roleOf(cachedProfile);
    return role === 'enthusiast' || role === 'trainer' || role === 'master_trainer';
  }
  function paintWorkoutTitle(w) {
    if (!w) return;
    if (!canRenameWorkout(w)) { titleEl.textContent = w.name; return; }
    titleEl.innerHTML = '<button type="button" id="wo-name" class="bar-name">' + esc(w.name) + ' <span class="name-pen" aria-hidden="true">✎</span></button>';
    var btn = document.getElementById('wo-name');
    if (btn) btn.onclick = function () { editWorkoutTitle(w); };
  }
  function editWorkoutTitle(w) {
    titleEl.innerHTML = '<input id="wo-name-input" class="bar-name-input" aria-label="Workout name" value="' + esc(w.name) + '" autocomplete="off">';
    var input = document.getElementById('wo-name-input');
    if (!input) return;
    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      var current = getW(w.id);
      if (save && current) {
        var next = String(input.value || '').trim();
        if (next && next !== current.name) {
          current.name = next;
          current.updatedAt = Date.now();
          persist();
        }
      }
      var live = getW(w.id) || w;
      if (hashPage() === 'w' && live && !copyLocked(live)) paintWorkoutTitle(live);
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
    input.focus();
    input.select();
  }
  function renderWorkout(w) {
    backBtn.hidden = false;
    paintWorkoutTitle(w);
    if (!cachedProfile && WBAuth.profile) {
      var token = routeToken;
      var id = w.id;
      ensureProfile().then(function () {
        if (token !== routeToken || hashPage() !== 'w') return;
        var live = getW(id);
        if (!live || document.getElementById('wo-name-input')) return;
        paintWorkoutTitle(live);
      });
    }
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
      if (a === 'play') {
        if (!workoutRunnable(w)) { toast(RUN_NEEDS_NUMBERS); return; }
        return go('#/play/' + w.id);
      }
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
      libQuery: '', libBody: '', libEquip: '', libTarget: '', libRows: [], libBoosted: [], libServerOffset: 0, libMore: false, libStatus: '', libError: false, libCollapsed: false,
      notesFor: media && media.kind === 'library' ? 'library:' + String(media.libraryId || '') : 'manual' };
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
  function numIn(bind, val, ph, step, req) {
    var mode = step ? 'decimal' : 'numeric';
    return '<input type="text" inputmode="' + mode + '" data-clear="1"' + (req ? ' data-req="1"' : '') + ' data-b="' + bind + '" value="' + esc(val) + '" placeholder="' + esc(ph || '') + '" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"' + (step ? '' : ' pattern="[0-9]*"') + '>';
  }
  function timeIn(prefix, c, mk, sk, dis, req) {
    var d = dis ? ' disabled' : '', off = dis ? ' is-off' : '';
    var open = dis ? '' : ' data-clear="1"' + (req ? ' data-req="1"' : '');
    var attrs = ' type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"' + open;
    return '<div class="time' + off + '">' +
      '<input' + attrs + ' data-b="' + prefix + '.' + mk + '" value="' + esc(c[mk]) + '" placeholder="min"' + d + '><span>:</span>' +
      '<input' + attrs + ' data-b="' + prefix + '.' + sk + '" value="' + esc(c[sk]) + '" placeholder="sec"' + d + '><span class="mute" style="font-size:14px;font-weight:400">mm:ss</span></div>';
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
      if (row.on) {
        h += '<input data-lename="' + i + '" value="' + esc(row.name) + '" placeholder="Event name" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="event-suggest-' + i + '">';
        h += '<div id="event-suggest-' + i + '" class="name-suggest event-suggest" data-for="' + i + '" role="listbox" aria-label="Saved event names" hidden></div>';
      }
      h += '</div>';
    }
    return h;
  }
  var libToken = 0, libFilters = { bodyParts: [], equipment: [], targets: [] }, libFiltersLoaded = false, libCatalog = {};
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
  function libThumbPlaceholder() {
    return '<span class="lib-thumb" aria-hidden="true"><svg class="lib-thumb-ph" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"></rect><circle cx="9" cy="10" r="1.5" fill="currentColor"></circle><path d="M3 16l5-4 4 3 3-2 6 5" fill="none" stroke="currentColor" stroke-width="1.8"></path></svg></span>';
  }
  function libThumbHtml(row) {
    var url = M.exerciseStillUrl(row.id, gifBase());
    if (!url) return libThumbPlaceholder();
    return '<button type="button" class="lib-thumb" data-a="libzoom" data-src="' + esc(url) + '" data-name="' + esc(row.name || '') + '" aria-label="Enlarge ' + esc(row.name || 'exercise') + '"><img alt="" loading="lazy" src="' + esc(url) + '"></button>';
  }
  function libHitHtml(row, d) {
    var on = String(row.id) === String(d.libraryId) ? ' on' : '';
    var yours = row.savedName ? '<span class="mute lib-yours">Your name: ' + esc(row.savedName) + '</span>' : '';
    var savedAttr = row.savedName ? ' data-saved-name="' + esc(row.savedName) + '"' : '';
    return '<div class="lib-hit' + on + '" data-a="pick" data-id="' + esc(row.id) + '" data-name="' + esc(row.name) + '"' + savedAttr + '>' +
      libThumbHtml(row) +
      '<button type="button" class="lib-hit-main"><span class="name">' + esc(row.name) + '</span>' +
      yours +
      (libMeta(row) ? '<span class="mute">' + esc(libMeta(row)) + '</span>' : '') + '</button></div>';
  }
  function resultsHtml(d) {
    // A pick hides the list. It stays hidden through filter changes and re-renders
    // until the search text changes, or the search box is focused while it still
    // has text. Clicking outside or Escape hides it again.
    if (d.libCollapsed) return '';
    if (d.libStatus) return '<p class="' + (d.libError ? 'errs' : 'mute') + '">' + esc(d.libStatus) + '</p>';
    var q = String(d.libQuery || '').trim();
    var filtered = d.libBody || d.libEquip || d.libTarget;
    if (q.length < 2 && !filtered) return '<p class="mute">Type at least 2 letters, or choose a filter.</p>';
    var rows = (d.libBoosted || []).concat(d.libRows || []);
    if (!rows.length) return '<p class="mute">No exercises match that search.</p>';
    var h = rows.map(function (row) { return libHitHtml(row, d); }).join('');
    if (d.libMore && !d.libBusy) h += '<button type="button" data-a="libmore">More</button>';
    return h;
  }
  function rememberLibRows(rows) {
    (rows || []).forEach(function (row) {
      if (!row || row.id == null || String(row.id) === '') return;
      libCatalog[String(row.id)] = {
        id: row.id,
        name: row.name,
        body_part: row.body_part,
        equipment: row.equipment,
        target: row.target,
        description: row.description
      };
    });
  }
  // Saved custom names already point at a library id. Keep the catalog row so
  // the next keystroke can filter it without another lookup.
  function boostedFrom(aliases, rows, filters) {
    var byId = {};
    (rows || []).forEach(function (row) {
      if (!row || row.id == null) return;
      byId[String(row.id)] = row;
    });
    var out = [];
    (aliases || []).forEach(function (alias) {
      var row = byId[String(alias.libraryId)];
      if (!row || !M.libraryRowMatches(row, filters)) return;
      out.push({
        id: row.id,
        name: row.name,
        body_part: row.body_part,
        equipment: row.equipment,
        target: row.target,
        description: row.description,
        savedName: alias.name
      });
    });
    return out;
  }
  function libraryRowsFor(aliases, filters) {
    var missing = [], found = [];
    aliases.forEach(function (alias) {
      var row = libCatalog[String(alias.libraryId)];
      if (row) found.push(row);
      else missing.push(alias.libraryId);
    });
    function finish(extra) { return boostedFrom(aliases, found.concat(extra || []), filters); }
    if (!missing.length) return Promise.resolve(finish());
    var lookup = window.WBAuth && WBAuth.exercisesByIds;
    if (typeof lookup !== 'function') return Promise.resolve(finish());
    return Promise.resolve().then(function () { return lookup(missing); }).then(function (rows) {
      rememberLibRows(rows);
      return finish(rows);
    }).catch(function () { return finish(); });
  }
  function paintLib() {
    var box = document.getElementById('lib-results');
    if (!box || !draft) return;
    box.innerHTML = resultsHtml(draft);
    bindLibThumbs(box);
  }
  function libThumbFailed(img) {
    var thumb = img && img.closest && img.closest('.lib-thumb');
    if (!thumb || !thumb.parentNode || thumb.getAttribute('data-lib-ph')) return;
    thumb.setAttribute('data-lib-ph', '1');
    thumb.insertAdjacentHTML('afterend', libThumbPlaceholder());
    thumb.remove();
  }
  // A cached 404 often does not fire error again after a rebuild. Check images
  // that already failed, and keep one capture listener for loads that fail later.
  function bindLibThumbs(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('.lib-thumb img'), function (img) {
      if (img.complete && img.naturalWidth === 0) libThumbFailed(img);
    });
  }
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG' || !t.closest || !t.closest('.lib-thumb')) return;
    libThumbFailed(t);
  }, true);
  function libQueryValue() {
    var input = document.getElementById('lib-q');
    if (input) return String(input.value || '');
    return String((draft && draft.libQuery) || '');
  }
  // Focusing the search box brings the same matches back. An empty box stays shut.
  function reopenLibResults() {
    if (!draft || draft.source !== 'library' || !draft.libCollapsed) return;
    if (!libQueryValue().trim()) return;
    draft.libCollapsed = false;
    paintLib();
  }
  function collapseLibResults() {
    if (!draft || draft.source !== 'library' || draft.libCollapsed) return;
    draft.libCollapsed = true;
    closeLibStill();
    paintLib();
  }
  function libSearchInside(e) {
    var t = e && e.target && e.target.closest ? e.target : null;
    if (!t) return false;
    return !!(t.closest('#lib-q') || t.closest('#lib-results') || t.closest('.lib-filters') || t.closest('#lib-still'));
  }
  function closeLibStill() {
    var el = document.getElementById('lib-still');
    if (!el) return false;
    el.remove();
    document.body.classList.remove('lib-still-on');
    return true;
  }
  function openLibStill(src, name) {
    if (!src) return;
    closeLibStill();
    var layer = document.createElement('div');
    layer.id = 'lib-still';
    layer.className = 'lib-still';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', name || 'Exercise still');
    layer.innerHTML = '<button type="button" class="lib-still-x" aria-label="Close">\u00d7</button><img alt="' + esc(name || '') + '" src="' + esc(src) + '">';
    layer.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'IMG') return;
      e.preventDefault();
      e.stopPropagation();
      closeLibStill();
    });
    document.body.classList.add('lib-still-on');
    document.body.appendChild(layer);
    var closer = layer.querySelector('.lib-still-x');
    if (closer) closer.focus();
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
    draft.libBoosted = [];
    draft.libServerOffset = 0;
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
      d.libRows = []; d.libBoosted = []; d.libServerOffset = 0; d.libMore = false; d.libStatus = ''; d.libError = false; d.libBusy = false; paintLib(); return;
    }
    var search = window.WBAuth && WBAuth.searchExercises;
    if (!search) { d.libStatus = 'The exercise library is not ready yet.'; d.libError = true; d.libBusy = false; paintLib(); return; }
    d.libBusy = true;
    if (!append) { d.libStatus = 'Searching\u2026'; d.libError = false; }
    paintLib();
    var offset = append ? (d.libServerOffset || 0) : 0;
    search(q, filters, 21, offset).then(function (rows) {
      if (token !== libToken || !draft || draft.source !== 'library') return;
      rows = Array.isArray(rows) ? rows : [];
      rememberLibRows(rows);
      var more = rows.length > 20;
      if (more) rows = rows.slice(0, 20);
      draft.libServerOffset = offset + rows.length;
      var aliases = append || q.length < 2 || !M.savedLibraryMatches ? [] : M.savedLibraryMatches(data.workouts || [], q);
      var boostReady = aliases.length ? libraryRowsFor(aliases, filters) : Promise.resolve(append ? (draft.libBoosted || []) : []);
      return boostReady.then(function (boosts) {
        if (token !== libToken || !draft || draft.source !== 'library') return;
        if (!append) draft.libBoosted = boosts || [];
        var skip = {};
        (draft.libBoosted || []).forEach(function (row) { if (row && row.id != null) skip[String(row.id)] = 1; });
        if (append) (draft.libRows || []).forEach(function (row) { if (row && row.id != null) skip[String(row.id)] = 1; });
        var page = rows.filter(function (row) { return row && row.id != null && !skip[String(row.id)]; });
        draft.libRows = append ? (draft.libRows || []).concat(page) : page;
        draft.libMore = more;
        draft.libStatus = ''; draft.libError = false; draft.libBusy = false;
        paintLib();
      });
    }).catch(function (err) {
      if (token !== libToken || !draft) return;
      draft.libStatus = (err && err.message) || 'Could not search the exercise library.';
      draft.libError = true; draft.libBusy = false;
      if (!append) { draft.libRows = []; draft.libBoosted = []; }
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
  // Notes follow the exercise being edited. A library pick always replaces them
  // with that exercise's description, including notes that were saved or typed.
  // No description clears Notes so the previous exercise's text does not linger.
  // Choosing Enter manually clears Notes that still belong to that library
  // exercise. Editing the name does not. Notes typed after Enter manually stay
  // while it remains that manual exercise.
  function notesBelongToLibrary(d) {
    return !!(d.notesFor && String(d.notesFor).indexOf('library:') === 0);
  }
  function clearManualNotes(d) {
    d.notes = '';
    d.notesFor = 'manual';
  }
  function applyLibraryDescription(d, row) {
    d.notes = row && typeof row.description === 'string' ? row.description : '';
    d.notesFor = 'library:' + String((row && row.id) || d.libraryId || '');
  }
  function libRowById(d, id) {
    var lists = [d.libBoosted, d.libRows], j, i;
    for (j = 0; j < lists.length; j++) {
      var rows = lists[j] || [];
      for (i = 0; i < rows.length; i++) if (rows[i] && String(rows[i].id) === String(id)) return rows[i];
    }
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
  // Manual name suggestions. Spellings already saved on this user's workouts.
  // Choosing one only fills the name. It does not read or write Notes.
  var nameSuggestActive = -1;
  function closeNameSuggest() {
    nameSuggestActive = -1;
    var box = document.getElementById('name-suggest');
    var input = app.querySelector('[data-b=name]');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
  }
  function markNameSuggest() {
    var box = document.getElementById('name-suggest');
    var input = app.querySelector('[data-b=name]');
    if (!box) return;
    var opts = box.querySelectorAll('[data-a=suggest-name]');
    if (nameSuggestActive >= opts.length) nameSuggestActive = opts.length - 1;
    Array.prototype.forEach.call(opts, function (el, i) {
      var on = i === nameSuggestActive;
      if (on) el.classList.add('on'); else el.classList.remove('on');
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (!input) return;
    if (nameSuggestActive >= 0 && opts[nameSuggestActive]) input.setAttribute('aria-activedescendant', opts[nameSuggestActive].id);
    else input.removeAttribute('aria-activedescendant');
  }
  function paintNameSuggest() {
    var box = document.getElementById('name-suggest');
    var input = app.querySelector('[data-b=name]');
    if (!box || !input || !draft || draft.source === 'library' || !window.WBNames) return;
    var names = WBNames.suggestNames(data.workouts || [], draft.name, { excludeExerciseId: draft.id, limit: 6 });
    nameSuggestActive = -1;
    if (!names.length) { closeNameSuggest(); return; }
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
    box.innerHTML = names.map(function (name, i) {
      return '<button type="button" class="name-hit" role="option" id="name-suggest-opt-' + i + '" data-a="suggest-name" data-name="' + esc(name) + '" aria-selected="false"><span class="name">' + esc(name) + '</span></button>';
    }).join('');
  }
  function chooseSuggestedName(name) {
    if (!draft || draft.source === 'library' || !name) return;
    draft.name = name;
    var input = app.querySelector('[data-b=name]');
    if (input) {
      input.value = name;
      try { input.setSelectionRange(name.length, name.length); } catch (err) {}
      input.focus();
    }
    closeNameSuggest();
  }
  function nameSuggestTarget(e) {
    return e && e.target && e.target.closest ? e.target : null;
  }
  function nameSuggestInside(e) {
    var t = nameSuggestTarget(e);
    return !!(t && (t.closest('#name-suggest') || t.closest('[data-b=name]')));
  }
  // Stopwatch event names. Same list, keyboard, and screen-reader behavior as
  // manual exercise names. Choosing one only fills that event. Notes stay.
  var eventSuggestActive = -1;
  function eventSuggestInput(index) {
    return app.querySelector('[data-lename="' + index + '"]');
  }
  function closeEventSuggest() {
    eventSuggestActive = -1;
    var boxes = app.querySelectorAll('.event-suggest');
    Array.prototype.forEach.call(boxes, function (box) {
      box.hidden = true;
      box.innerHTML = '';
      var input = eventSuggestInput(box.getAttribute('data-for'));
      if (!input) return;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    });
  }
  function markEventSuggest(index) {
    var box = document.getElementById('event-suggest-' + index);
    var input = eventSuggestInput(index);
    if (!box) return;
    var opts = box.querySelectorAll('[data-a=suggest-event]');
    if (eventSuggestActive >= opts.length) eventSuggestActive = opts.length - 1;
    Array.prototype.forEach.call(opts, function (el, i) {
      var on = i === eventSuggestActive;
      if (on) el.classList.add('on'); else el.classList.remove('on');
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (!input) return;
    if (eventSuggestActive >= 0 && opts[eventSuggestActive]) input.setAttribute('aria-activedescendant', opts[eventSuggestActive].id);
    else input.removeAttribute('aria-activedescendant');
  }
  function paintEventSuggest(input) {
    if (!input || !draft || !window.WBNames || !WBNames.suggestEventNames) return;
    var index = input.getAttribute('data-lename');
    var box = document.getElementById('event-suggest-' + index);
    if (index == null || !box) return;
    var names = WBNames.suggestEventNames(data.workouts || [], input.value, { limit: 6 });
    closeEventSuggest();
    if (!names.length) return;
    eventSuggestActive = -1;
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
    box.innerHTML = names.map(function (name, i) {
      return '<button type="button" class="name-hit" role="option" id="event-suggest-' + index + '-opt-' + i + '" data-a="suggest-event" data-lap="' + index + '" data-name="' + esc(name) + '" aria-selected="false"><span class="name">' + esc(name) + '</span></button>';
    }).join('');
  }
  function chooseSuggestedEvent(index, name) {
    if (!draft || !name) return;
    var row = ensureEventDraft(draft.cfg.stopwatch)[+index];
    if (row) row.name = name;
    var input = eventSuggestInput(index);
    if (input) {
      input.value = name;
      try { input.setSelectionRange(name.length, name.length); } catch (err) {}
      input.focus();
    }
    closeEventSuggest();
  }
  function eventSuggestInside(e) {
    var t = nameSuggestTarget(e);
    if (!t) return false;
    if (t.closest('.event-suggest')) return true;
    var input = t.closest('[data-lename]');
    if (!input) return false;
    var box = document.getElementById('event-suggest-' + input.getAttribute('data-lename'));
    return !!(box && !box.hidden);
  }
  document.addEventListener('click', function (e) {
    var box = document.getElementById('name-suggest');
    if (box && !box.hidden && !nameSuggestInside(e)) closeNameSuggest();
    if (!eventSuggestInside(e)) closeEventSuggest();
    if (!libSearchInside(e)) collapseLibResults();
  });
  document.addEventListener('focusin', function (e) {
    var box = document.getElementById('name-suggest');
    if (box && !box.hidden && !nameSuggestInside(e)) closeNameSuggest();
    if (!eventSuggestInside(e)) closeEventSuggest();
    if (e.target && e.target.id === 'lib-q') reopenLibResults();
  });
  document.addEventListener('pointerdown', function (e) {
    if (e.target && e.target.id === 'lib-q') reopenLibResults();
  });
  document.addEventListener('keydown', function (e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (closeLibStill()) { e.preventDefault(); return; }
    if (document.getElementById('profile-sheet')) return;
    var nameBox = document.getElementById('name-suggest');
    if (nameBox && !nameBox.hidden) return;
    var evOpen = false;
    Array.prototype.forEach.call(document.querySelectorAll('.event-suggest'), function (box) {
      if (!box.hidden) evOpen = true;
    });
    if (evOpen) return;
    if (!draft || draft.source !== 'library' || draft.libCollapsed) return;
    collapseLibResults();
    e.preventDefault();
  });
  function renderEditor(w, exId) {
    closeLibStill();
    var isNew = exId === 'new', ex = isNew ? null : w.items.filter(function (x) { return x.id === exId; })[0];
    if (!isNew && !ex) return go('#/w/' + w.id);
    if (!draft) draft = makeDraft(ex || M.newExercise());
    var d = draft, c = d.cfg[d.mode];
    var ssBlock = d.groupId ? M.blocks(w).filter(function (b) { return b.groupId === d.groupId; })[0] : null;
    var ssNonFinal = !!(ssBlock && ssBlock.items[ssBlock.items.length - 1].id !== d.id);
    titleEl.textContent = isNew ? 'New exercise' : 'Edit exercise'; backBtn.hidden = false;
    var h = '<div class="ex-form">' + (ssBlock ? '<div class="warn" role="status">Only the final rest period will function in each set of a superset</div>' : '') +
      seg('source', [['custom', 'Enter manually'], ['library', 'Exercise library']], d.source || 'custom') +
      (d.source === 'library'
        ? '<input id="lib-q" aria-label="Search exercises" placeholder="Search exercises" autocomplete="off" value="' + esc(d.libQuery || '') + '">' +
          '<div class="lib-filters">' +
            filterSelect('lib-equip', 'Equipment used', d.libEquip, libFilters.equipment) +
            filterSelect('lib-target', 'Target muscle', d.libTarget, libFilters.targets) +
          '</div><div id="lib-results">' + resultsHtml(d) + '</div>'
        : '') +
      '<label>Exercise name</label><input data-b="name" value="' + esc(d.name) + '" placeholder="e.g. Goblet squat" autocomplete="off"' +
      (d.source === 'library' ? '' : ' role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="name-suggest"') + '>' +
      (d.source === 'library' ? '' : '<div id="name-suggest" class="name-suggest" role="listbox" aria-label="Saved exercise names" hidden></div>') +
      (d.source === 'library' && d.libraryId ? '<p class="mute">Library demo is attached.</p>' : '') +
      '<label>Mode</label>' + seg('mode', [['reps', 'Reps'], ['intervals', 'Intervals'], ['timer', 'Timer'], ['stopwatch', 'Stopwatch']], d.mode);
    function weightFields() {
      return '<label>Weight</label>' + seg('unit', [['lb', 'lb'], ['kg', 'kg'], ['bodyweight', 'Bodyweight']], d.unit) +
        (d.unit !== 'bodyweight' ? '<div style="margin-top:8px">' + numIn('wval', d.wval, 'Weight in ' + d.unit + ' (optional)', 'any') + '</div>' : '');
    }
    function setsField(label, hint) {
      return '<label>' + label + '</label>' + numIn('sets', d.sets, hint, null, true);
    }
    function repsFields(allowStatic) {
      var o = [['number', 'Number'], ['range', 'Range']]; if (allowStatic) o.push(['static', 'Static hold']);
      var x = '<label>Reps type' + (allowStatic ? ' <span class="mute" style="font-weight:400">(optional — tap again to clear)</span>' : '') + '</label>' + seg('repsType', o, c.repsType);
      if (c.repsType === 'number') x += '<label>Reps</label>' + numIn('cfg.count', c.count, 'e.g. 10', null, true);
      if (c.repsType === 'range') x += '<label>Rep range (min – max)</label><div class="row"><div class="grow">' + numIn('cfg.min', c.min, 'min', null, true) + '</div><span>–</span><div class="grow">' + numIn('cfg.max', c.max, 'max', null, true) + '</div></div>';
      if (c.repsType === 'static') x += '<p class="mute">Static hold — time only, no rep count.</p>';
      return x;
    }
    function repsColumn() {
      if (c.repsType === 'range') return '<label>Rep range</label><div class="row"><div class="grow">' + numIn('cfg.min', c.min, 'min', null, true) + '</div><span>–</span><div class="grow">' + numIn('cfg.max', c.max, 'max', null, true) + '</div></div>';
      if (c.repsType === 'static') return '<label>Reps</label><p class="mute">Static hold — time only, no rep count.</p>';
      return '<label>Reps</label>' + numIn('cfg.count', c.count, 'e.g. 10', null, true);
    }
    if (d.mode === 'reps') {
      h += '<label>Reps type</label>' + seg('repsType', [['number', 'Number'], ['range', 'Range']], c.repsType);
      h += '<div class="field-row"><div>' + setsField('Sets', 'e.g. 3') + '</div><div>' + repsColumn() + '</div></div>';
      h += weightFields();
      h += '<label>Rest time between sets (optional)</label>' + (ssNonFinal ? '<p class="mute">Disabled — not final in a superset</p>' : '') + timeIn('cfg', c, 'rm', 'rs', ssNonFinal);
    } else if (d.mode === 'intervals') {
      h += setsField('# of intervals', 'e.g. 8') + weightFields();
      h += '<label>Interval time</label>' + timeIn('cfg', c, 'wm', 'ws', false, true) + repsFields(true);
    } else if (d.mode === 'timer') {
      h += setsField('Sets', 'e.g. 3') + weightFields();
      h += '<label>Work time</label>' + timeIn('cfg', c, 'wm', 'ws', false, true) + '<label>Rest time</label>' + (ssNonFinal ? '<p class="mute">Disabled — not final in a superset</p>' : '') + timeIn('cfg', c, 'rm', 'rs', ssNonFinal, true) + repsFields(true);
    } else {
      h += setsField('Attempts', 'e.g. 3') + weightFields();
      h += '<p class="mute">Counts up from 0:00 during the workout. No settings needed.</p>' +
        '<label class="row" style="font-weight:400"><input type="checkbox" class="sel" data-b="cfg.lapsEnabled"' + (c.lapsEnabled ? ' checked' : '') + '> Record laps (agility / splits)</label>' +
        (c.lapsEnabled ? '<label>Lap quantity</label>' + numIn('cfg.lapCount', c.lapCount, 'e.g. 4', null, true) + '<div id="lap-events">' + lapEventsHtml(c) + '</div>' : '');
    }
    h += '<label>Notes</label><textarea data-b="notes" placeholder="Cues, tempo, equipment…">' + esc(d.notes) + '</textarea>' +
      editorMediaHtml(d) + '<div id="errs"></div>' +
      '<div class="actions" style="margin-top:16px"><button class="pri grow" data-a="save">Save exercise</button><button data-a="cancel">Cancel</button></div></div>';
    app.innerHTML = copyNote(w) + h;
    bindLibThumbs(app);
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
        closeEventSuggest();
        var evBox = document.getElementById('lap-events');
        if (evBox) evBox.innerHTML = lapEventsHtml(d.cfg.stopwatch);
        return;
      }
      if (t.dataset && t.dataset.lename != null) {
        var named = ensureEventDraft(d.cfg.stopwatch)[+t.dataset.lename];
        if (named) named.name = t.value;
        if (e.type === 'input') paintEventSuggest(t);
        return;
      }
      var b = t.dataset.b; if (!b) return;
      var v = t.type === 'checkbox' ? t.checked : t.value;
      if (b.indexOf('cfg.') === 0) d.cfg[d.mode][b.slice(4)] = v; else d[b] = v;
      if (t.hasAttribute('data-req') && reqOk(t)) { t.classList.remove('is-empty'); t.removeAttribute('aria-invalid'); }
      if (b === 'name') {
        if (e.type === 'input' && d.source !== 'library') paintNameSuggest();
        return;
      }
      if (b === 'cfg.lapCount') {
        var box = document.getElementById('lap-events');
        // Skip a no-op refresh (the field's change event on blur) so it doesn't
        // replace a checkbox the user is clicking in the lap list.
        var next = lapEventsHtml(d.cfg.stopwatch);
        if (box && box.innerHTML !== next) {
          closeEventSuggest();
          box.innerHTML = next;
        }
        return;
      }
      if (b === 'cfg.lapsEnabled') renderEditor(w, exId);
    };
    app.onclick = function (e) {
      if (e.target && e.target.id === 'lib-q') reopenLibResults();
      var s = e.target.closest('[data-seg]');
      if (s) {
        var k = s.dataset.seg;
        if (k === 'source') {
          if (d.source !== s.dataset.v) {
            if (s.dataset.v !== 'library' && notesBelongToLibrary(d)) clearManualNotes(d);
            d.source = s.dataset.v;
            onLibrarySourceChange();
          }
          return renderEditor(w, exId);
        }
        if (k === 'repsType') { var cc = d.cfg[d.mode]; cc.repsType = d.mode !== 'reps' && cc.repsType === s.dataset.v ? null : s.dataset.v; }
        else d[k] = s.dataset.v;
        return renderEditor(w, exId);
      }
      var b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'suggest-name') { chooseSuggestedName(b.getAttribute('data-name') || ''); return; }
      if (b.dataset.a === 'suggest-event') { chooseSuggestedEvent(b.getAttribute('data-lap'), b.getAttribute('data-name') || ''); return; }
      if (b.dataset.a === 'cancel') { releasePendingImage(); return go('#/w/' + w.id); }
      if (b.dataset.a === 'libzoom') {
        openLibStill(b.getAttribute('data-src') || '', b.getAttribute('data-name') || '');
        return;
      }
      if (b.dataset.a === 'pick') {
        var hit = b.closest('.lib-hit') || b;
        d.libraryId = hit.dataset.id || '';
        var savedName = hit.getAttribute('data-saved-name');
        d.name = savedName ? savedName : (hit.dataset.name || d.name);
        d.source = 'library';
        if (d.view !== '360') d.view = '180';
        applyLibraryDescription(d, libRowById(d, d.libraryId));
        closeLibStill();
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
        var emptyReq = false;
        Array.prototype.forEach.call(app.querySelectorAll('input[data-req]'), function (field) {
          if (reqOk(field)) { field.classList.remove('is-empty'); field.removeAttribute('aria-invalid'); return; }
          field.classList.add('is-empty');
          field.setAttribute('aria-invalid', 'true');
          if (String(field.value == null ? '' : field.value).trim() === '') emptyReq = true;
        });
        var res = buildFromDraft(d);
        if (plan.error) res.errors.unshift(plan.error);
        var msgs = res.errors.filter(function (msg) { return !(emptyReq && emptyExplains(msg, d)); });
        if (emptyReq) msgs.unshift(EMPTY_FIELDS);
        if (msgs.length) {
          document.getElementById('errs').innerHTML = '<div class="errs">' + msgs.map(esc).join('<br>') + '</div>';
          var badField = app.querySelector('input.is-empty');
          (badField || document.getElementById('errs')).scrollIntoView({ block: 'center' });
          return;
        }
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
    app.onmousedown = function (e) {
      var hit = e.target && e.target.closest && e.target.closest('[data-a=suggest-name], [data-a=suggest-event]');
      if (!hit) return;
      e.preventDefault();
    };
    app.onkeydown = function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      var t = e.target;
      if (t && t.getAttribute('data-lename') != null) {
        var index = t.getAttribute('data-lename');
        var evBox = document.getElementById('event-suggest-' + index);
        var evOpen = evBox && !evBox.hidden;
        if (e.key === 'Escape') {
          if (evOpen) { closeEventSuggest(); e.preventDefault(); }
          return;
        }
        if (!evOpen) return;
        var evOpts = evBox.querySelectorAll('[data-a=suggest-event]');
        if (!evOpts.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (eventSuggestActive < 0) eventSuggestActive = e.key === 'ArrowDown' ? 0 : evOpts.length - 1;
          else if (e.key === 'ArrowDown') eventSuggestActive = Math.min(evOpts.length - 1, eventSuggestActive + 1);
          else eventSuggestActive = Math.max(0, eventSuggestActive - 1);
          markEventSuggest(index);
          return;
        }
        if (e.key === 'Enter' && eventSuggestActive >= 0 && evOpts[eventSuggestActive]) {
          e.preventDefault();
          chooseSuggestedEvent(index, evOpts[eventSuggestActive].getAttribute('data-name') || '');
        }
        return;
      }
      if (!t || t.getAttribute('data-b') !== 'name' || !draft || draft.source === 'library') return;
      var box = document.getElementById('name-suggest');
      var open = box && !box.hidden;
      if (e.key === 'Escape') {
        if (open) { closeNameSuggest(); e.preventDefault(); }
        return;
      }
      if (!open) return;
      var opts = box.querySelectorAll('[data-a=suggest-name]');
      if (!opts.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (nameSuggestActive < 0) nameSuggestActive = e.key === 'ArrowDown' ? 0 : opts.length - 1;
        else if (e.key === 'ArrowDown') nameSuggestActive = Math.min(opts.length - 1, nameSuggestActive + 1);
        else nameSuggestActive = Math.max(0, nameSuggestActive - 1);
        markNameSuggest();
        return;
      }
      if (e.key === 'Enter' && nameSuggestActive >= 0 && opts[nameSuggestActive]) {
        e.preventDefault();
        chooseSuggestedName(opts[nameSuggestActive].getAttribute('data-name') || '');
      }
    };
  }
  function emptyExplains(msg, d) {
    var c = d.cfg[d.mode];
    function blank(v) { return String(v == null ? '' : v).trim() === ''; }
    if (blank(d.sets) && (/^Sets must be/.test(msg) || /^Attempts must be/.test(msg))) return true;
    if (c.repsType === 'number' && blank(c.count) && /^Reps must be/.test(msg)) return true;
    if (c.repsType === 'range' && (blank(c.min) || blank(c.max)) && /^Range min and max/.test(msg)) return true;
    if (d.mode === 'intervals' && (blank(c.wm) || blank(c.ws)) && /^Interval time must/.test(msg)) return true;
    if (d.mode === 'timer' && (blank(c.wm) || blank(c.ws)) && /^Work time must/.test(msg)) return true;
    if (d.mode === 'timer' && (blank(c.rm) || blank(c.rs)) && /^Rest time cannot/.test(msg)) return true;
    if (d.mode === 'stopwatch' && c.lapsEnabled && blank(c.lapCount) && /^Lap quantity/.test(msg)) return true;
    return false;
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
  archiveCurrent();
  function readUserDrops() {
    var merged = {};
    if (!window.WBLibrary) return merged;
    [libraryUserId, libraryOwner(), '_pending'].forEach(function (key) {
      if (!key) return;
      var row = userMap(WBLibrary.DROP_KEY, key);
      Object.keys(row).forEach(function (id) {
        if (!WBLibrary.isUserDrop(row[id])) return;
        if (!WBLibrary.isUserDrop(merged[id]) || WBLibrary.dropTime(row[id]) > WBLibrary.dropTime(merged[id])) merged[id] = row[id];
      });
    });
    return merged;
  }
  function listStamp(list) {
    return (list || []).map(function (w) {
      if (!w) return '';
      var n = 0;
      try { n = JSON.stringify(w.items || []).length; } catch (e) { n = 0; }
      return [w.id, w.name, w.updatedAt || 0, n].join(':');
    }).join('|');
  }
  // Another tab saved the list or recorded a Delete. Honor that Delete, and
  // copy a newer workout onto the object this tab already has open.
  function adoptSiblingSave() {
    if (!window.WBLibrary || applyingLibrary) return;
    var before = listStamp(data.workouts);
    var had = {};
    data.workouts.forEach(function (w) { if (w && w.id) had[String(w.id)] = 1; });
    var next = WBLibrary.reconcileDevice(data.workouts, M.load(localStorage).workouts, readUserDrops());
    if (listStamp(next) === before) return;
    var removed = {};
    var still = {};
    next.forEach(function (w) { if (w && w.id) still[String(w.id)] = 1; });
    Object.keys(had).forEach(function (id) { if (!still[id]) removed[id] = 1; });
    data.workouts = next;
    var page = hashPage();
    var id = hashBody().split('/')[1] || '';
    if (id && removed[id] && (page === 'w' || page === 'play' || page === 'view')) {
      go('#/');
    } else if (page === '') {
      renderList();
    } else if (page === 'w' && hashBody().split('/').length === 2 && !document.getElementById('wo-name-input')) {
      var live = getW(id);
      if (live) renderWorkout(live);
    }
    scheduleAccountSync();
  }
  window.addEventListener('storage', function (e) {
    if (!e || !window.WBLibrary || e.storageArea !== localStorage) return;
    if (e.key !== M.STORAGE_KEY && e.key !== WBLibrary.DROP_KEY) return;
    adoptSiblingSave();
  });
  window.addEventListener('online', function () { ensureShare(); libraryOff = false; scheduleAccountSync(); });
  window.addEventListener('offline', function () {
    if ((!libraryUserId && !libraryOwner()) || libraryOff) return;
    setLibraryStatus('offline', '');
    paintLibraryStatus();
  });
  // Coming back to the app checks for workouts saved on another device.
  // Focus, pageshow, and visibility often fire together, so one check covers the burst.
  function resumeLibrarySoon() {
    if (libraryOff) return;
    var wait = (typeof window.__wbLibraryResumeMs === 'number') ? window.__wbLibraryResumeMs : 4000;
    var now = Date.now();
    if (now < libraryResumeAt) return;
    libraryResumeAt = now + wait;
    scheduleAccountSync();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    ensureShare();
    resumeLibrarySoon();
  });
  window.addEventListener('focus', resumeLibrarySoon);
  window.addEventListener('pageshow', resumeLibrarySoon);
  if (WBAuth.onAuth) {
    WBAuth.onAuth(function (event) {
      if (event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED' && event !== 'INITIAL_SESSION') return;
      // This callback runs while the sign-in client holds its lock. Sync after it lets go.
      setTimeout(function () { scheduleAccountSync(); }, 0);
    });
  }
  fillLandingPlans();
  bindLandingShots();
  route();
})();
