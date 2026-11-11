/* Enthusiast sharing choice. No network. Browser: window.WBSharing. Node: require. */
(function (root) {
  'use strict';
  var LOG_KEY = 'wb.ownSessions.v1';
  var NOTE = 'This helps avoid training conflicts when you also train on your own.';
  var UNAVAILABLE = 'Sharing workouts is not available yet. Apply the sharing SQL in the Supabase SQL editor.';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initialState() {
    return { confirmed: null, phase: 'loading', message: '', busy: false };
  }
  function isUnavailable(err) {
    var msg = String((err && err.message) || '');
    return /not available yet|not ready|schema cache|could not find the function|does not exist|PGRST202|PGRST205|42P01|share_with_trainer|own_workouts|own_sessions/i.test(msg);
  }
  // A setting is usable only when the server sent a real boolean. Anything else
  // is unknown and must not be stored as on or off.
  function parseSetting(row) {
    if (!row || typeof row.on !== 'boolean') return { ok: false };
    return {
      ok: true,
      on: row.on,
      enthusiast: row.enthusiast === true,
      linked: row.linked === true
    };
  }
  function parseStatus(row) {
    if (!row || typeof row.shared !== 'boolean' || typeof row.enthusiast !== 'boolean' || typeof row.linked !== 'boolean') {
      return { ok: false };
    }
    return {
      ok: true,
      shared: row.shared,
      enthusiast: row.enthusiast,
      linked: row.linked,
      email: row.email || '',
      plan: row.plan || ''
    };
  }
  function reduce(state, event) {
    state = state || initialState();
    event = event || {};
    if (event.type === 'load-start') {
      if (state.busy) return state;
      if (typeof state.confirmed === 'boolean' && state.phase === 'ready') return state;
      return { confirmed: state.confirmed, phase: 'loading', message: '', busy: false };
    }
    if (event.type === 'load-ok') {
      if (typeof event.on !== 'boolean') {
        if (typeof state.confirmed === 'boolean') return state;
        return { confirmed: null, phase: 'error', message: 'Could not load sharing.', busy: false };
      }
      if (state.busy) return state;
      return { confirmed: event.on, phase: 'ready', message: '', busy: false };
    }
    if (event.type === 'load-unavailable') {
      return { confirmed: state.confirmed, phase: 'unavailable', message: event.message || UNAVAILABLE, busy: false };
    }
    if (event.type === 'load-error') {
      if (typeof state.confirmed === 'boolean') return { confirmed: state.confirmed, phase: 'ready', message: '', busy: false };
      return { confirmed: null, phase: 'error', message: event.message || 'Could not load sharing.', busy: false };
    }
    if (event.type === 'save-start') {
      if (state.busy || typeof state.confirmed !== 'boolean' || state.phase === 'unavailable') return state;
      return { confirmed: state.confirmed, phase: 'ready', message: '', busy: true };
    }
    if (event.type === 'save-ok') {
      if (typeof event.on !== 'boolean') {
        return {
          confirmed: state.confirmed,
          phase: typeof state.confirmed === 'boolean' ? 'ready' : 'error',
          message: typeof state.confirmed === 'boolean' ? '' : 'Could not confirm that choice.',
          busy: false
        };
      }
      return { confirmed: event.on, phase: 'ready', message: '', busy: false };
    }
    if (event.type === 'save-fail') {
      return {
        confirmed: state.confirmed,
        phase: typeof state.confirmed === 'boolean' ? 'ready' : 'error',
        message: event.message || '',
        busy: false
      };
    }
    if (event.type === 'redeemed') {
      if (typeof event.on !== 'boolean') return state;
      return { confirmed: event.on, phase: 'ready', message: '', busy: false };
    }
    if (event.type === 'reset') return initialState();
    return state;
  }
  function shouldPush(state) {
    return !!(state && state.confirmed === true && state.phase === 'ready' && !state.busy);
  }
  function showSwitch(state) {
    return !!(state && typeof state.confirmed === 'boolean' && state.phase === 'ready');
  }

  function linkOption(checked) {
    var on = checked !== false;
    return '<label class="checkline" id="share-option"><input id="share-link" class="tick" type="checkbox" data-share="workouts"' +
      (on ? ' checked' : '') + '>' +
      '<span><span class="name" style="display:block;font-size:16px">Let your trainer view your workouts and tracking</span>' +
      '<span class="mute" style="display:block;margin-top:4px">' + esc(NOTE) + '</span></span></label>';
  }
  function accountCard(state) {
    if (!state || state.phase === 'unavailable') {
      var detail = (state && state.message) || UNAVAILABLE;
      return '<div class="card" id="share-card"><div id="share-wait"><div class="name">Not available yet</div><p class="mute">' + esc(detail) + '</p></div></div>';
    }
    if (!showSwitch(state)) {
      if (state.phase === 'error') {
        return '<div class="card" id="share-card"><div id="share-error"><div class="name">Could not load sharing</div><p class="mute">' + esc(state.message || 'Could not load sharing.') + '</p></div></div>';
      }
      return '<div class="card" id="share-card"><p class="mute" id="share-loading">Loading…</p></div>';
    }
    var on = state.confirmed === true;
    return '<div class="card" id="share-card"><div class="row">' +
      '<button type="button" class="switch' + (on ? ' on' : '') + '" id="share-account" data-share-toggle role="switch" aria-checked="' +
      (on ? 'true' : 'false') + '"' + (state.busy ? ' disabled' : '') +
      ' aria-label="Share my workouts and tracking with my trainer"><i></i></button>' +
      '<div class="grow"><div class="name" style="font-size:16px">Share my workouts and tracking with my trainer</div>' +
      '<p class="mute" style="margin:4px 0 0">' + esc(NOTE) + '</p></div></div></div>';
  }
  function unavailableHtml(message) {
    return '<div class="card" id="client-wait"><div class="name">Not available yet</div><p class="mute">' + esc(message || UNAVAILABLE) + '</p></div>';
  }
  function errorHtml(message) {
    return '<div class="card" id="client-error"><div class="name">Could not load this client</div><p class="mute">' + esc(message || 'Could not load this client.') + '</p></div>';
  }
  function setLine(r) {
    if (!r || r.logged === false) return '';
    var bits = [];
    if (r.name) bits.push(String(r.name));
    if (r.set != null && r.set !== '') bits.push('set ' + r.set + (r.of ? ' of ' + r.of : ''));
    if (r.reps != null && r.reps !== '') bits.push(r.reps + ' reps');
    if (r.holdSec != null && r.holdSec !== '') bits.push(r.holdSec + 's hold');
    if (r.rounds != null && r.rounds !== '') bits.push(r.rounds + ' rounds');
    if (r.workSec != null && r.workSec !== '') bits.push(r.workSec + 's work');
    if (r.mode === 'stopwatch' && r.durationMs != null) {
      var fmt = root.WB && root.WB.formatStopwatch;
      bits.push(fmt ? fmt(r.durationMs) : (Math.round(r.durationMs / 1000) + 's'));
    }
    if (r.unit === 'bodyweight') bits.push('bodyweight');
    else if (r.weight != null && r.weight !== '' && r.unit) bits.push(r.weight + ' ' + r.unit);
    return bits.join(' · ');
  }
  function whenLabel(v) {
    if (v == null || v === '') return '';
    var t = typeof v === 'number' ? v : Date.parse(v);
    if (!isFinite(t)) return '';
    var d = new Date(t);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function clientHtml(status, workouts, sessions) {
    if (!status || status.ok === false || typeof status.shared !== 'boolean' || typeof status.enthusiast !== 'boolean') {
      return errorHtml('Could not load this client.');
    }
    var head = '<p class="mute">' + esc(status.plan || (status.enthusiast ? 'Enthusiast' : 'Free Client')) + '</p>';
    if (!status.enthusiast) {
      return '<div id="client-free">' + head +
        '<div class="card"><div class="name">Not part of this option</div>' +
        '<p class="mute">Free Clients are unchanged. Their own workouts and tracking stay private.</p></div></div>';
    }
    if (!status.shared) {
      return '<div id="client-private">' + head +
        '<div class="card"><div class="name">Not shared</div>' +
        '<p class="mute">This Enthusiast has turned off sharing. You cannot see their own workouts or tracking.</p></div></div>';
    }
    if (!Array.isArray(workouts) || !Array.isArray(sessions)) return errorHtml('Could not load workouts.');
    var h = '<div id="client-view" data-readonly="true">' + head +
      '<p class="note" id="client-readonly">Read only. You cannot edit these.</p>' +
      '<div class="name" style="margin-bottom:8px">Their workouts</div>';
    if (!workouts.length) h += '<p class="mute" id="client-no-workouts">No workouts of their own yet.</p>';
    workouts.forEach(function (w) {
      var items = Array.isArray(w.items) ? w.items : [];
      h += '<div class="card"><div class="name">' + esc(w.name || 'Workout') + '</div>';
      h += '<div class="mute">' + items.length + (items.length === 1 ? ' exercise' : ' exercises') + '</div>';
      items.forEach(function (it) {
        if (!it) return;
        var line = it.name || 'Exercise';
        if (it.sets) line += ' · ' + it.sets + (it.sets === 1 ? ' set' : ' sets');
        h += '<div class="mute">' + esc(line) + '</div>';
      });
      h += '</div>';
    });
    h += '<div class="name" style="margin:12px 0 8px">Tracking</div>';
    if (!sessions.length) h += '<p class="mute" id="client-no-sessions">No completed sessions yet.</p>';
    sessions.forEach(function (s) {
      h += '<div class="card"><div class="name">' + esc(s.workoutName || 'Session') + '</div>';
      var when = whenLabel(s.endedAt);
      if (when) h += '<div class="mute">' + esc(when) + '</div>';
      var lines = (Array.isArray(s.results) ? s.results : []).map(setLine).filter(Boolean);
      if (lines.length) {
        h += '<ul class="sets">';
        lines.forEach(function (line) { h += '<li>' + esc(line) + '</li>'; });
        h += '</ul>';
      }
      h += '</div>';
    });
    return h + '</div>';
  }

  function isOwnWorkout(w) {
    return !!(w && w.id && !w.sourceTrainerId);
  }
  function sessionIsOwn(sess, workouts) {
    if (!sess || !sess.id) return false;
    var match = null;
    (workouts || []).forEach(function (w) { if (w && w.id === sess.workoutId) match = w; });
    if (match && match.sourceTrainerId) return false;
    return true;
  }
  function readLog(storage) {
    try {
      var raw = storage.getItem(LOG_KEY);
      if (!raw) return [];
      var rows = JSON.parse(raw);
      if (!Array.isArray(rows)) return null;
      return rows;
    } catch (e) { return null; }
  }
  function rememberSession(storage, sess, workouts) {
    if (!sessionIsOwn(sess, workouts)) return false;
    var rows = readLog(storage);
    if (rows == null) return false;
    if (rows.some(function (r) { return r && r.id === sess.id; })) return false;
    var copy;
    try { copy = JSON.parse(JSON.stringify(sess)); } catch (e) { return false; }
    rows.push(copy);
    try { storage.setItem(LOG_KEY, JSON.stringify(rows.slice(-60))); } catch (e2) { return false; }
    return true;
  }
  // Own workouts and their logged sets, for a push. Null means the local read
  // failed or was not a list: the caller must not upload or delete anything.
  function payload(data, log) {
    if (!data || !Array.isArray(data.workouts) || !Array.isArray(log)) return null;
    var sessions = [];
    var seen = {};
    function add(list) {
      (list || []).forEach(function (s) {
        if (!sessionIsOwn(s, data.workouts) || seen[s.id]) return;
        seen[s.id] = true;
        sessions.push(s);
      });
    }
    if (Array.isArray(data.sessions)) add(data.sessions);
    else if (data.sessions != null) return null;
    add(log);
    return {
      workouts: data.workouts.filter(isOwnWorkout).map(function (w) {
        return { localId: String(w.id), name: w.name || 'Workout', items: Array.isArray(w.items) ? w.items : [] };
      }),
      sessions: sessions.map(function (s) {
        return {
          localId: String(s.id),
          workoutId: s.workoutId || '',
          workoutName: s.workoutName || '',
          startedAt: s.startedAt == null ? null : s.startedAt,
          endedAt: s.endedAt == null ? null : s.endedAt,
          results: Array.isArray(s.results) ? s.results : []
        };
      })
    };
  }

  var api = {
    LOG_KEY: LOG_KEY, NOTE: NOTE, UNAVAILABLE: UNAVAILABLE,
    esc: esc, initialState: initialState, isUnavailable: isUnavailable,
    parseSetting: parseSetting, parseStatus: parseStatus, reduce: reduce,
    shouldPush: shouldPush, showSwitch: showSwitch,
    linkOption: linkOption, accountCard: accountCard, unavailableHtml: unavailableHtml, errorHtml: errorHtml,
    setLine: setLine, whenLabel: whenLabel, clientHtml: clientHtml,
    isOwnWorkout: isOwnWorkout, sessionIsOwn: sessionIsOwn,
    readLog: readLog, rememberSession: rememberSession, payload: payload
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBSharing = api;
})(typeof window !== 'undefined' ? window : this);
