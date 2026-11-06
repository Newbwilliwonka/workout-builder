/* Workout Builder UI (Stage 2). Hash routes: #/  |  #/w/<id>  |  #/w/<id>/ex/<exId or new> */
(function () {
  'use strict';
  var M = window.WB, app = document.getElementById('app'), titleEl = document.getElementById('title'), backBtn = document.getElementById('back');
  var data = M.load(localStorage), selected = {}, draft = null;

  function persist() { M.save(localStorage, data); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getW(id) { return data.workouts.filter(function (w) { return w.id === id; })[0]; }
  function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function go(h) { location.hash = h; }
  backBtn.onclick = function () {
    var page = location.hash.replace(/^#\/?/, '').split('/')[0];
    if (page === 'signin' || page === 'join') return;
    var p = location.hash.split('/');
    if (p[1] === 'play') return WBPlayer.requestEnd();
    go(p.length > 3 ? '#/w/' + p[2] : '#/');
  };

  function hashPage() { return location.hash.replace(/^#\/?/, '').split('/')[0]; }
  function onAuthPage() { var p = hashPage(); return p === 'signin' || p === 'join'; }
  // Temporary, until a payment processor exists. Not a subscription limit.
  var BUILDER_EMAILS = ['kinisiathletics@gmail.com', 'hempled@gmail.com'];
  function builderAllowed(session) {
    var email = session && session.user && session.user.email;
    return BUILDER_EMAILS.indexOf(String(email || '').trim().toLowerCase()) !== -1;
  }
  var routeToken = 0;
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
      go(builderAllowed(session) ? '#/' : '#/subscriptions');
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
      var emailEl = document.getElementById('acct-email'), passEl = document.getElementById('acct-pass');
      var email = emailEl ? emailEl.value.trim() : '', password = passEl ? passEl.value : '';
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
  function renderSubscriptions(message, isError) {
    titleEl.textContent = 'Subscriptions'; backBtn.hidden = false;
    app.innerHTML = '<p class="mute">Loading…</p>';
    WBAuth.session().then(function (session) {
      if (hashPage() !== 'subscriptions') return;
      if (!session) return go('#/signin');
      WBAuth.profile().then(function (profile) {
        if (hashPage() !== 'subscriptions') return;
        drawSubscriptions(session, profile, message, isError);
      }).catch(function () {
        if (hashPage() === 'subscriptions') drawSubscriptions(session, null, message || 'Signed in, but membership storage is not ready yet. Apply the profiles SQL in the Supabase SQL editor.', true);
      });
    }).catch(function (e) {
      if (hashPage() !== 'subscriptions') return;
      showSignInNotice((e && e.message) || 'Could not reach sign-in', true);
    });
  }
  function drawSubscriptions(session, profile, message, isError) {
    var h = '<div class="sales">';
    if (message) h += '<div class="' + (isError ? 'errs' : 'card') + '">' + esc(message) + '</div>';
    h += '<h2>Choose how you want to train</h2>';
    h += '<p class="lede">Every plan is defined by what you can do, now and as the next features arrive.</p>';
    h += '<p class="note">Beta pricing for the first 100 members.</p>';
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
    app.onclick = function (e) {
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
        var ent = WBMembership.entitlements(profile);
        var plan = ent.active ? ent.tier : WBMembership.tier(profile.intended_plan);
        var h = '<div class="gate"><div class="card"><div class="name">' + esc(session.user.email || 'Signed in') + '</div>' +
          '<p class="mute">' + esc(plan ? plan.name : 'Membership') + '</p>' +
          '<button data-auth="out" style="width:100%">Sign out</button></div></div>';
        app.innerHTML = h;
        app.onclick = function (e) {
          var b = e.target.closest('[data-auth]'); if (!b) return;
          WBAuth.signOut().then(function () {
            if (hashPage() !== 'account') return;
            go('#/signin');
          }).catch(function (err) {
            if (hashPage() !== 'account') return;
            app.insertAdjacentHTML('afterbegin', '<div class="errs">' + esc((err && err.message) || 'Could not sign out') + '</div>');
          });
        };
      }).catch(function () { if (hashPage() === 'account') go('#/subscriptions'); });
    }).catch(function () { if (hashPage() === 'account') go('#/signin'); });
  }
  function showBuilder() {
    var p = location.hash.replace(/^#\/?/, '').split('/');
    if (p[0] === 'play' && getW(p[1]) && getW(p[1]).items.length) {
      titleEl.textContent = getW(p[1]).name; backBtn.hidden = false;
      return WBPlayer.mount(app, getW(p[1]), data, persist, function () { go('#/w/' + p[1]); });
    }
    if (p[0] === 'w' && getW(p[1])) {
      if (p[2] === 'ex') return renderEditor(getW(p[1]), p[3]);
      return renderWorkout(getW(p[1]));
    }
    renderList();
  }
  function route() {
    var token = ++routeToken;
    window.WBPlayer && WBPlayer.unmount();
    document.body.classList.remove('playing');
    var page = hashPage();
    if (page === 'signin') return renderSign('in');
    if (page === 'join') return renderSign('up');
    if (page === 'subscriptions') return renderSubscriptions();
    if (page === 'account') return renderSimpleAccount();
    var requested = location.hash;
    app.innerHTML = '';
    app.onclick = null; app.oninput = null; app.onchange = null;
    var pending;
    try { pending = WBAuth.session(); } catch (e) { return go('#/signin'); }
    if (!pending || !pending.then) return go('#/signin');
    pending.then(function (session) {
      if (token !== routeToken || location.hash !== requested) return;
      if (!session) return go('#/signin');
      if (!builderAllowed(session)) return go('#/subscriptions');
      showBuilder();
    }).catch(function () {
      if (token !== routeToken || location.hash !== requested) return;
      go('#/signin');
    });
  }
  window.addEventListener('hashchange', function () {
    draft = null;
    if (hashPage() !== 'signin') pendingSignNotice = null;
    route();
    window.scrollTo(0, 0);
  });

  // ---------- Workout list ----------
  function renderList() {
    titleEl.textContent = 'Workouts'; backBtn.hidden = true;
    var h = '<button style="width:100%;margin-bottom:8px" data-a="account">Account</button>' +
      '<button class="pri" style="width:100%;margin-bottom:12px" data-a="new">+ New workout</button>';
    if (!data.workouts.length) h += '<div class="empty">No workouts yet.<br>Tap “New workout” to build one.</div>';
    data.workouts.forEach(function (w, wi) {
      var n = w.items.length, nW = data.workouts.length;
      h += '<div class="card"><div class="name" data-a="open" data-id="' + w.id + '" style="cursor:pointer">' + esc(w.name) + '</div>' +
        '<div class="mute">' + n + ' exercise' + (n === 1 ? '' : 's') + '</div><div class="actions">' +
        '<button class="sm" data-a="wup" data-id="' + w.id + '" aria-label="Move up"' + (wi === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button class="sm" data-a="wdown" data-id="' + w.id + '" aria-label="Move down"' + (wi === nW - 1 ? ' disabled' : '') + '>▼</button>' +
        '<button class="pri sm" data-a="open" data-id="' + w.id + '">Open</button>' +
        '<button class="sm" data-a="run" data-id="' + w.id + '"' + (n ? '' : ' disabled') + '>Run</button>' +
        '<button class="sm" data-a="rename" data-id="' + w.id + '">Rename</button>' +
        '<button class="sm" data-a="dup" data-id="' + w.id + '">Duplicate</button>' +
        '<button class="sm danger" data-a="del" data-id="' + w.id + '">Delete</button></div></div>';
    });
    app.innerHTML = h;
    app.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.dataset.a, w = getW(b.dataset.id);
      if (a === 'account') return openAccount();
      if (a === 'new') {
        var name = prompt('Workout name', 'New workout'); if (name === null) return;
        var nw = M.newWorkout(name.trim() || 'New workout'); data.workouts.unshift(nw); persist(); go('#/w/' + nw.id);
      } else if (a === 'open') go('#/w/' + w.id);
      else if (a === 'run') { if (w.items.length) go('#/play/' + w.id); }
      else if (a === 'rename') { var r = prompt('Rename workout', w.name); if (r && r.trim()) { w.name = r.trim(); w.updatedAt = Date.now(); persist(); renderList(); } }
      else if (a === 'dup') { var c = M.duplicateWorkout(w); data.workouts.splice(data.workouts.indexOf(w) + 1, 0, c); persist(); renderList(); toast('Duplicated'); }
      else if (a === 'del') { if (confirm('Delete “' + w.name + '”? This cannot be undone.')) { data.workouts.splice(data.workouts.indexOf(w), 1); persist(); renderList(); toast('Deleted'); } }
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
    var bl = M.blocks(w), h = '', chain = '<svg class="chain-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M17 7h-4v2h4a3 3 0 010 6h-4v2h4a5 5 0 000-10zm-6 8H7a3 3 0 010-6h4V7H7a5 5 0 000 10h4v-2zm-3-4h8v2H8v-2z"/></svg>';
    if (!w.items.length) h += '<div class="empty">No exercises yet.<br>Tap “+ Exercise” below.</div>';
    else h += '<p class="mute">Tick 2 exercises, then tap “Link superset”.</p>';
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
        if (M.supersetLinkSize(w, ids) > 2) { toast('Supersets are limited to 2 exercises'); return; }
        M.linkSuperset(w, ids); selected = {}; toast('Superset linked — only the final rest period will function in each set');
      }
      else if (a === 'delex') { var ex = w.items.filter(function (x) { return x.id === id; })[0]; if (!confirm('Delete “' + ex.name + '”?')) return; M.deleteExercise(w, id); delete selected[id]; }
      persist(); renderWorkout(w);
    };
  }

  // ---------- Exercise editor ----------
  // Draft holds raw input strings + a config per mode, so switching mode/type keeps what was typed.
  function makeDraft(ex) {
    var d = { id: ex.id, name: ex.name, sets: String(ex.sets), unit: ex.weight.unit, wval: ex.weight.value == null ? '' : String(ex.weight.value),
      mode: ex.mode, notes: ex.notes, groupId: ex.groupId, media: ex.media, cfg: {} };
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
  function renderEditor(w, exId) {
    var isNew = exId === 'new', ex = isNew ? null : w.items.filter(function (x) { return x.id === exId; })[0];
    if (!isNew && !ex) return go('#/w/' + w.id);
    if (!draft) draft = makeDraft(ex || M.newExercise());
    var d = draft, c = d.cfg[d.mode];
    var ssBlock = d.groupId ? M.blocks(w).filter(function (b) { return b.groupId === d.groupId; })[0] : null;
    var ssNonFinal = !!(ssBlock && ssBlock.items[ssBlock.items.length - 1].id !== d.id);
    titleEl.textContent = isNew ? 'New exercise' : 'Edit exercise'; backBtn.hidden = false;
    var h = '<div class="card">' + (ssBlock ? '<div class="warn" role="status">Only the final rest period will function in each set of a superset</div>' : '') +
      '<label>Exercise name</label><input data-b="name" value="' + esc(d.name) + '" placeholder="e.g. Goblet squat" autocomplete="off">' +
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
        (c.lapsEnabled ? '<label>Lap quantity</label>' + numIn('cfg.lapCount', c.lapCount, 'e.g. 4') : '');
    }
    h += '<label>Notes</label><textarea data-b="notes" placeholder="Cues, tempo, equipment…">' + esc(d.notes) + '</textarea>' +
      '<div class="media">🎬 Media coming soon</div><div id="errs"></div>' +
      '<div class="actions" style="margin-top:16px"><button class="pri grow" data-a="save">Save exercise</button><button data-a="cancel">Cancel</button></div></div>';
    app.innerHTML = h;
    app.onchange = null;
    app.oninput = app.onchange = function (e) {
      var b = e.target.dataset.b; if (!b) return;
      var v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (b.indexOf('cfg.') === 0) d.cfg[d.mode][b.slice(4)] = v; else d[b] = v;
      if (b === 'cfg.lapsEnabled') renderEditor(w, exId);
    };
    app.onclick = function (e) {
      var s = e.target.closest('[data-seg]');
      if (s) { var k = s.dataset.seg; if (k === 'repsType') { var cc = d.cfg[d.mode]; cc.repsType = d.mode !== 'reps' && cc.repsType === s.dataset.v ? null : s.dataset.v; } else d[k] = s.dataset.v; return renderEditor(w, exId); }
      var b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'cancel') return go('#/w/' + w.id);
      if (b.dataset.a === 'save') {
        var res = buildFromDraft(d);
        if (res.errors.length) { document.getElementById('errs').innerHTML = '<div class="errs">' + res.errors.map(esc).join('<br>') + '</div>'; document.getElementById('errs').scrollIntoView({ block: 'center' }); return; }
        M.upsertExercise(w, res.ex); persist(); toast('Saved'); go('#/w/' + w.id);
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
    if (d.mode === 'stopwatch') { ex.modeConfig = { lapsEnabled: !!c.lapsEnabled, lapCount: intOf(c.lapCount) }; if (c.lapsEnabled) raw.push(c.lapCount); }
    if (raw.some(function (v) { var n = M.num(v); return n !== null && n < 0; })) errs.push('Numbers cannot be negative.');
    if (d.mode !== 'stopwatch' && [c.ws, c.rs].some(function (v) { return M.num(v) > 59; })) errs.push('Seconds must be 0–59.');
    errs = errs.concat(M.validateExercise(ex).filter(function (m) { return errs.indexOf(m) < 0; }));
    return { ex: ex, errors: errs };
  }
  window.WB_buildFromDraft = buildFromDraft; window.WB_makeDraft = makeDraft; // exposed for testing
  route();
})();
