/* Trainer invite rules. No network. Browser: window.WBInvites. Node: require. */
(function (root) {
  'use strict';
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var CODE_LEN = 8;
  var TTL_MS = 24 * 60 * 60 * 1000;
  var SITE = 'https://coachtrainerapp.com/';
  var MSG = {
    notTrainer: 'Only a Trainer or Master Trainer can create invites.',
    noSlots: 'No invite slots left.',
    notFound: 'That invite code was not found.',
    used: 'That invite has already been used.',
    canceled: 'That invite was canceled.',
    expired: 'That invite has expired.',
    trainerClient: 'A Trainer or Master Trainer cannot join as a client.',
    already: 'You are already connected to a trainer. End that connection before using a new invite.',
    cap: 'That trainer has no open client spots.',
    cancel: 'That invite cannot be canceled.',
    noLink: 'There is no connection to end.',
    free: 'You are connected as a Free Client.',
    enthusiast: 'You are connected. Your Enthusiast plan is unchanged.',
    ended: 'Connection ended.'
  };

  function normalizeCode(raw) {
    return String(raw || '').toUpperCase().replace(/[\s-]/g, '');
  }
  function codeIsWellFormed(code) {
    if (!code || code.length !== CODE_LEN) return false;
    for (var i = 0; i < code.length; i++) if (ALPHABET.indexOf(code.charAt(i)) < 0) return false;
    return true;
  }
  function formatCode(code) {
    var n = normalizeCode(code);
    if (n.length !== CODE_LEN) return n;
    return n.slice(0, 4) + '-' + n.slice(4);
  }
  function inviteLink(code) {
    return SITE + '?invite=' + normalizeCode(code) + '#/join';
  }
  function generateCode(rng) {
    rng = rng || Math.random;
    var out = '';
    for (var i = 0; i < CODE_LEN; i++) out += ALPHABET.charAt(Math.floor(rng() * ALPHABET.length));
    return out;
  }
  function trainerRole(profile) {
    if (!profile) return null;
    if (profile.membership === 'master_trainer' || profile.membership === 'trainer') return profile.membership;
    if (profile.intended_plan === 'master_trainer' || profile.intended_plan === 'trainer') return profile.intended_plan;
    return null;
  }
  function capFor(profile) {
    var role = trainerRole(profile);
    if (role === 'master_trainer') return 30;
    if (role === 'trainer') return 15;
    return 0;
  }
  function toMs(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    return new Date(v).getTime();
  }
  function inviteState(invite, now) {
    if (!invite) return 'unknown';
    if (invite.canceled_at) return 'canceled';
    if (invite.used_at || invite.used_by) return 'used';
    if (!(toMs(invite.expires_at) > now)) return 'expired';
    return 'open';
  }
  function isOpen(invite, now) { return inviteState(invite, now) === 'open'; }
  function activeLinks(links) {
    return (links || []).filter(function (l) { return l && !l.ended_at; });
  }
  function slotsUsed(invites, links, now) {
    var open = 0;
    (invites || []).forEach(function (inv) { if (isOpen(inv, now)) open++; });
    return open + activeLinks(links).length;
  }
  function canCreate(profile, invites, links, now) {
    var cap = capFor(profile);
    if (!cap) return { ok: false, message: MSG.notTrainer };
    var used = slotsUsed(invites, links, now);
    if (used >= cap) return { ok: false, message: MSG.noSlots, cap: cap, used: used };
    return { ok: true, cap: cap, used: used, remaining: cap - used };
  }
  function isEnthusiast(profile) {
    return !!(profile && (profile.membership === 'enthusiast' || profile.intended_plan === 'enthusiast'));
  }
  function clientLabel(profile) {
    if (isEnthusiast(profile)) return 'Enthusiast';
    return 'Free Client';
  }
  function timeLeft(expiresAt, now) {
    var ms = toMs(expiresAt) - now;
    if (!(ms > 0)) return 'Expired';
    var mins = Math.floor(ms / 60000);
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    if (h >= 1) return h + 'h ' + m + 'm left';
    if (m < 1) return 'Less than a minute left';
    return m + 'm left';
  }
  function redeemDecision(profile, invite, trainer, trainerLinks, existing, now) {
    var state = inviteState(invite, now);
    if (state === 'unknown') return { ok: false, message: MSG.notFound };
    if (state === 'used') return { ok: false, message: MSG.used };
    if (state === 'canceled') return { ok: false, message: MSG.canceled };
    if (state === 'expired') return { ok: false, message: MSG.expired };
    if (!codeIsWellFormed(invite && normalizeCode(invite.code))) return { ok: false, message: MSG.notFound };
    if (trainerRole(profile)) return { ok: false, message: MSG.trainerClient };
    if (existing && !existing.ended_at) return { ok: false, message: MSG.already };
    var cap = capFor(trainer);
    if (activeLinks(trainerLinks).length >= cap) return { ok: false, message: MSG.cap };
    var enthusiast = isEnthusiast(profile);
    var membership = profile && profile.membership;
    if (!enthusiast && membership !== 'free_client') membership = 'free_client';
    return {
      ok: true,
      membership: membership || 'free_client',
      enthusiast: enthusiast,
      message: enthusiast ? MSG.enthusiast : MSG.free,
      plan: enthusiast ? 'Enthusiast' : 'Free Client'
    };
  }
  function withoutTrainerWorkouts(workouts, trainerId) {
    return (workouts || []).filter(function (w) { return !w || w.sourceTrainerId !== trainerId; });
  }

  function createBook(seed) {
    seed = seed || {};
    var state = {
      users: seed.users || {},
      me: seed.me || null,
      signedIn: !!seed.signedIn,
      invites: seed.invites ? seed.invites.slice() : [],
      links: seed.links ? seed.links.slice() : [],
      now: seed.now || null
    };
    function clock() { return state.now == null ? Date.now() : (typeof state.now === 'function' ? state.now() : state.now); }
    function me() { return state.users[state.me] || null; }
    function reject(message) { return Promise.reject(new Error(message)); }
    function ownedInvites() {
      var id = state.me;
      return state.invites.filter(function (inv) { return inv.trainer_id === id; });
    }
    function ownedLinks() {
      var id = state.me;
      return state.links.filter(function (l) { return l.trainer_id === id; });
    }
    function uniqueCode() {
      var code, guard = 0;
      do { code = generateCode(); guard++; } while (state.invites.some(function (inv) { return inv.code === code; }) && guard < 50);
      return code;
    }
    function session() {
      if (!state.signedIn) return Promise.resolve(null);
      var u = me();
      if (!u) return Promise.resolve(null);
      return Promise.resolve({ user: { id: u.id, email: u.email } });
    }
    function profile() {
      if (!state.signedIn) return Promise.resolve(null);
      var u = me();
      if (!u) return Promise.resolve(null);
      return Promise.resolve({ id: u.id, email: u.email, membership: u.membership, intended_plan: u.intended_plan || null });
    }
    function signIn() {
      state.signedIn = true;
      return session();
    }
    function signUp() {
      state.signedIn = true;
      return session().then(function (s) { return { session: s, needsConfirmation: false }; });
    }
    function signOut() { state.signedIn = false; return Promise.resolve(); }
    function saveIntended(planId) {
      var u = me();
      if (!u) return reject('Sign in first.');
      if (planId !== 'enthusiast' && planId !== 'trainer' && planId !== 'master_trainer') return reject('A trainer invite is required for Free Client.');
      u.intended_plan = planId;
      return profile();
    }
    function roster() {
      var u = me();
      var role = trainerRole(u);
      if (!role) return Promise.resolve({ role: null });
      var now = clock();
      var clients = activeLinks(ownedLinks()).map(function (l) {
        var person = state.users[l.client_id] || {};
        var shown = person.display_name || '';
        if (!shown || shown.indexOf('@') !== -1) shown = '';
        return { id: l.client_id, name: shown, avatarPath: person.avatar_path || '', membership: person.membership || '', plan: l.plan || clientLabel(person) };
      });
      var invites = ownedInvites().filter(function (inv) { return isOpen(inv, now); }).map(function (inv) {
        return { code: inv.code, expiresAt: inv.expires_at };
      });
      var cap = capFor(u);
      return Promise.resolve({
        role: role,
        cap: cap,
        clientCount: clients.length,
        canCreate: slotsUsed(ownedInvites(), ownedLinks(), now) < cap,
        clients: clients,
        invites: invites
      });
    }
    function createInvite() {
      var u = me();
      var now = clock();
      var decision = canCreate(u, ownedInvites(), ownedLinks(), now);
      if (!decision.ok) return reject(decision.message);
      var invite = {
        id: 'inv_' + (state.invites.length + 1),
        trainer_id: u.id,
        code: uniqueCode(),
        created_at: now,
        expires_at: now + TTL_MS,
        used_at: null,
        used_by: null,
        canceled_at: null
      };
      state.invites.push(invite);
      return Promise.resolve({ code: invite.code, expiresAt: invite.expires_at, link: inviteLink(invite.code) });
    }
    function cancelInvite(code) {
      var norm = normalizeCode(code);
      var inv = state.invites.filter(function (item) { return item.code === norm && item.trainer_id === state.me; })[0];
      if (!inv || inv.used_at || inv.canceled_at) return reject(MSG.cancel);
      inv.canceled_at = clock();
      return Promise.resolve({ code: inv.code });
    }
    function myConnection() {
      var link = activeLinks(state.links).filter(function (l) { return l.client_id === state.me; })[0];
      if (!link) return Promise.resolve(null);
      var trainer = state.users[link.trainer_id] || {};
      var shown = trainer.display_name || '';
      if (!shown || shown.indexOf('@') !== -1) shown = '';
      return Promise.resolve({ trainerId: link.trainer_id, trainerName: shown, avatarPath: trainer.avatar_path || '' });
    }
    function redeemInvite(code, share) {
      var norm = normalizeCode(code);
      var u = me();
      if (!u) return reject('Sign in first.');
      var inv = state.invites.filter(function (item) { return item.code === norm; })[0];
      if (inv && !codeIsWellFormed(norm)) inv = null;
      var existing = activeLinks(state.links).filter(function (l) { return l.client_id === u.id; })[0] || null;
      var trainer = inv ? state.users[inv.trainer_id] : null;
      var trainerLinks = inv ? state.links.filter(function (l) { return l.trainer_id === inv.trainer_id; }) : [];
      var decision = redeemDecision(u, inv && codeIsWellFormed(norm) ? inv : null, trainer, trainerLinks, existing, clock());
      if (!decision.ok) return reject(decision.message);
      u.membership = decision.membership;
      if (decision.enthusiast) u.share_with_trainer = typeof share === 'boolean' ? share : true;
      inv.used_at = clock();
      inv.used_by = u.id;
      state.links.push({
        id: 'link_' + (state.links.length + 1),
        trainer_id: inv.trainer_id,
        client_id: u.id,
        created_at: clock(),
        ended_at: null,
        plan: decision.plan
      });
      return Promise.resolve({ message: decision.message, trainerId: inv.trainer_id, membership: u.membership });
    }
    function endConnection(clientId) {
      var now = clock();
      var link = null;
      if (clientId && clientId !== 'self') {
        link = activeLinks(state.links).filter(function (l) { return l.trainer_id === state.me && l.client_id === clientId; })[0];
      } else {
        link = activeLinks(state.links).filter(function (l) { return l.client_id === state.me; })[0];
      }
      if (!link) return reject(MSG.noLink);
      link.ended_at = now;
      return Promise.resolve({ trainerId: link.trainer_id, message: MSG.ended });
    }
    return {
      state: state,
      setNow: function (n) { state.now = n; },
      setMe: function (id, signed) { state.me = id; if (signed != null) state.signedIn = !!signed; },
      api: function () {
        return {
          session: session, profile: profile, signIn: signIn, signUp: signUp, signOut: signOut, saveIntended: saveIntended,
          roster: roster, createInvite: createInvite, cancelInvite: cancelInvite, redeemInvite: redeemInvite,
          endConnection: endConnection, myConnection: myConnection
        };
      }
    };
  }

  var TERMINAL_MESSAGE = {};
  TERMINAL_MESSAGE[MSG.notFound] = 1;
  TERMINAL_MESSAGE[MSG.used] = 1;
  TERMINAL_MESSAGE[MSG.canceled] = 1;
  TERMINAL_MESSAGE[MSG.expired] = 1;
  TERMINAL_MESSAGE[MSG.cap] = 1;
  TERMINAL_MESSAGE[MSG.trainerClient] = 1;
  TERMINAL_MESSAGE[MSG.already] = 1;
  TERMINAL_MESSAGE['That invite could not be used.'] = 1;
  var TERMINAL_CODE = {
    invite_invalid: 1,
    invite_expired: 1,
    invite_canceled: 1,
    invite_used: 1,
    invite_full: 1,
    invite_connected: 1,
    invite_trainer: 1
  };
  function trimMessage(err) {
    return String(err && err.message || '').replace(/^\s+|\s+$/g, '');
  }
  function walkErrors(err, fn) {
    var seen = 0;
    var cur = err;
    while (cur && seen < 4) {
      if (fn(cur)) return true;
      if (!cur.cause || cur.cause === cur) break;
      cur = cur.cause;
      seen++;
    }
    return false;
  }
  function isWaiting(err) {
    return walkErrors(err, function (item) {
      return trimMessage(item) === 'Your account is waiting for approval.';
    });
  }
  function outcomeOf(err) {
    var found = '';
    walkErrors(err, function (item) {
      if (found) return true;
      if (typeof item.inviteOutcome === 'string' && TERMINAL_CODE[item.inviteOutcome]) found = item.inviteOutcome;
      else if (typeof item.hint === 'string' && item.hint.indexOf('invite_') === 0 && TERMINAL_CODE[item.hint]) found = item.hint;
      return !!found;
    });
    return found;
  }
  function isPermanent(err) {
    if (isWaiting(err)) return false;
    if (outcomeOf(err)) return true;
    var terminal = false;
    walkErrors(err, function (item) {
      if (TERMINAL_MESSAGE[trimMessage(item)]) terminal = true;
      return terminal;
    });
    return terminal;
  }
  // 'terminal' drops both copies. Anything else, including a 5xx, a dropped
  // network, and an unknown message, is tried again on the next signed-in page.
  // Waiting for approval keeps the code and is also tried again later.
  function inviteFailureKind(err) {
    if (isPermanent(err)) return 'terminal';
    return 'retry';
  }
  function wrapInviteError(err, res) {
    res = res || {};
    var msg = (err && (err.message || err.details)) || '';
    if (!msg && res.statusText) msg = res.statusText;
    var friendly = String(msg || '');
    if (/schema cache|could not find the function|does not exist|PGRST202|PGRST205/i.test(friendly)) {
      friendly = 'Invite storage is not ready yet. Apply the invite SQL in the Supabase SQL editor.';
    }
    var out = new Error(friendly || 'Could not use invites');
    if (err && err.name && err.name !== 'Error') {
      try { out.name = err.name; } catch (e) {}
    }
    var status = typeof res.status === 'number' ? res.status : (err && typeof err.status === 'number' ? err.status : undefined);
    if (typeof status !== 'number' && err && typeof err.statusCode === 'number') status = err.statusCode;
    if (typeof status === 'number') out.status = status;
    if (typeof res.statusText === 'string' && res.statusText) out.statusText = res.statusText;
    var fetchError = err && err.name === 'TypeError' && /failed to fetch|load failed|networkerror/i.test(String(err.message || ''));
    if ((err && err.offline === true) || status === 0 || fetchError) out.offline = true;
    if (err && typeof err.code === 'string') out.code = err.code;
    if (err && typeof err.hint === 'string') out.hint = err.hint;
    if (err && typeof err.hint === 'string' && err.hint.indexOf('invite_') === 0) out.inviteOutcome = err.hint;
    else if (err && typeof err.inviteOutcome === 'string') out.inviteOutcome = err.inviteOutcome;
    try { out.cause = err || null; } catch (e2) {}
    return out;
  }
  // supabase-js rpc resolves { data, error, status, statusText }. The HTTP
  // status is on that object, not on error.
  function redeemResponseError(res) {
    res = res || {};
    var err = res.error;
    if (!err && (res.status === 0 || (typeof res.status === 'number' && res.status >= 400))) {
      err = {
        message: res.statusText || 'Could not use invites',
        name: res.status === 0 ? 'TypeError' : 'Error'
      };
    }
    if (!err) return null;
    return wrapInviteError(err, res);
  }

  var api = {
    ALPHABET: ALPHABET, CODE_LEN: CODE_LEN, TTL_MS: TTL_MS, SITE: SITE, MSG: MSG,
    normalizeCode: normalizeCode, codeIsWellFormed: codeIsWellFormed, formatCode: formatCode, inviteLink: inviteLink,
    generateCode: generateCode, trainerRole: trainerRole, capFor: capFor, inviteState: inviteState, slotsUsed: slotsUsed,
    canCreate: canCreate, isEnthusiast: isEnthusiast, clientLabel: clientLabel, timeLeft: timeLeft,
    redeemDecision: redeemDecision, withoutTrainerWorkouts: withoutTrainerWorkouts, createBook: createBook,
    inviteFailureKind: inviteFailureKind, wrapInviteError: wrapInviteError, redeemResponseError: redeemResponseError
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBInvites = api;
})(typeof window !== 'undefined' ? window : this);
