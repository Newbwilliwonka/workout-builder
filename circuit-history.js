/* Turn a finished group circuit into one save the trainer can retry. No emails. */
(function (root) {
  'use strict';

  var QUEUE = 'wb.circuitRuns.v1';

  function safeName(value) {
    var name = String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
    if (!name || name.indexOf('@') !== -1) return 'Client';
    return name.slice(0, 80);
  }
  function safeId(value) {
    var id = String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '');
    return id.slice(0, 80);
  }
  function libraryId(value) {
    var id = String(value == null ? '' : value).trim();
    return /^[A-Za-z0-9_-]{1,32}$/.test(id) ? id : '';
  }
  function uuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '')) ? String(value) : '';
  }
  function newRunId() {
    var c = (root && root.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    if (c && c.randomUUID) return c.randomUUID();
    var hex = '';
    for (var i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
  }
  function zone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  }
  function payloadFromRecord(record, status) {
    record = record || {};
    var stations = [];
    var byId = {};
    (record.stations || []).forEach(function (station) {
      if (!station || !station.id) return;
      var row = {
        id: safeId(station.id),
        name: safeName(station.name || 'Station'),
        libraryId: libraryId(station.libraryId)
      };
      if (!row.id) return;
      stations.push(row);
      byId[row.id] = row;
    });
    var people = [];
    (record.people || []).forEach(function (person) {
      if (!person) return;
      var rounds = [];
      (person.rounds || []).forEach(function (round) {
        if (!round || !round.stationId || round.benched) return;
        var stationId = safeId(round.stationId);
        if (!stationId || !byId[stationId]) return;
        var work = Math.round(Number(round.workSec) || 0);
        if (work < 1) return;
        rounds.push({ stationId: stationId, workSec: work });
      });
      var clientId = person.source === 'linked' ? uuid(person.id) : '';
      people.push({
        clientId: clientId,
        name: safeName(person.name),
        rounds: rounds
      });
    });
    var clock = record.clock || {};
    var rawName = String(record.name || '').replace(/^\s+|\s+$/g, '');
    var name = (!rawName || rawName.indexOf('@') !== -1) ? 'Group circuit' : rawName.slice(0, 120);
    return {
      runId: safeId(record.runId || newRunId()),
      name: name,
      circuitId: safeId(record.circuitId || 'circuit'),
      status: status === 'ended_early' ? 'ended_early' : 'completed',
      startedAt: record.startedAt || new Date().toISOString(),
      endedAt: record.endedAt || new Date().toISOString(),
      timeZone: zone(),
      workSec: Math.max(0, Math.round(Number(clock.workSec) || 0)),
      moveSec: Math.max(0, Math.round(Number(clock.moveSec) || 0)),
      stations: stations,
      people: people
    };
  }
  function storePending(row) {
    try {
      if (!row) root.localStorage.removeItem(QUEUE);
      else root.localStorage.setItem(QUEUE, JSON.stringify({ ownerId: row.ownerId, payload: row.payload }));
    } catch (e) {}
  }
  function ownedRow(item) {
    var id = uuid(item && item.ownerId);
    if (!id || !item.payload || !item.payload.runId) return null;
    return { ownerId: id, payload: item.payload };
  }
  function loadPending() {
    var raw = null;
    try { raw = root.localStorage.getItem(QUEUE); } catch (e) { return null; }
    if (!raw) return null;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e2) { parsed = null; }
    if (Array.isArray(parsed)) {
      var kept = null;
      for (var i = parsed.length - 1; i >= 0; i--) {
        kept = ownedRow(parsed[i]);
        if (kept) break;
      }
      storePending(kept);
      return kept;
    }
    var row = ownedRow(parsed);
    if (!row) storePending(null);
    return row;
  }
  function readQueue() {
    var row = loadPending();
    return row ? [row] : [];
  }
  function errorCode(err) {
    return String(err && err.code || '').toUpperCase();
  }
  function staleWindow(payload) {
    var started = Date.parse(payload && payload.startedAt);
    var ended = Date.parse(payload && payload.endedAt);
    if (!isFinite(started)) return false;
    if (started < Date.now() - 7 * 24 * 60 * 60 * 1000) return true;
    if (isFinite(ended) && ended - started > 6 * 60 * 60 * 1000) return true;
    return false;
  }
  function permanentError(err, payload) {
    var code = errorCode(err);
    if (code === '22023' || code === 'P0102' || code === '42501') return true;
    if (code === 'P0101') return staleWindow(payload);
    return false;
  }
  function remember(ownerId, payload) {
    var id = uuid(ownerId);
    if (!id || !payload || !payload.runId) return;
    storePending({ ownerId: id, payload: payload });
  }
  function forget(ownerId, runId) {
    var id = uuid(ownerId);
    if (!id) return;
    var row = loadPending();
    if (row && row.ownerId === id && row.payload.runId === runId) storePending(null);
  }
  function clearFor(ownerId) {
    var id = uuid(ownerId);
    if (!id) return;
    var row = loadPending();
    if (row && row.ownerId === id) storePending(null);
  }
  function pendingCount(ownerId) {
    var id = uuid(ownerId);
    if (!id) return 0;
    var row = loadPending();
    return row && row.ownerId === id ? 1 : 0;
  }
  function savePayload(ownerId, payload) {
    var auth = root.WBAuth;
    var id = uuid(ownerId);
    if (!id) {
      var blocked = new Error('Sign in to run a class.');
      blocked.signin = true;
      return Promise.reject(blocked);
    }
    if (!auth || !auth.circuitSaveRun) {
      remember(id, payload);
      return Promise.reject(new Error('Saving a circuit is not available yet.'));
    }
    return Promise.resolve().then(function () { return auth.circuitSaveRun(payload); }).then(function () {
      forget(id, payload.runId);
      return { ok: true };
    }, function (err) {
      err = err || new Error('Could not save the circuit.');
      if (permanentError(err, payload)) {
        err.permanent = true;
        err.circuitName = payload.name || 'that circuit';
        forget(id, payload.runId);
        return Promise.reject(err);
      }
      remember(id, payload);
      return Promise.reject(err);
    });
  }
  function saveRecord(record, status, ownerId, signedInId) {
    var payload = payloadFromRecord(record, status);
    if (record && record.runId) payload.runId = safeId(record.runId) || payload.runId;
    var owner = uuid(ownerId);
    if (!owner) {
      var blocked = new Error('Sign in to run a class.');
      blocked.signin = true;
      return Promise.reject(blocked);
    }
    if (uuid(signedInId) !== owner) {
      remember(owner, payload);
      return Promise.reject(new Error('Saved on this phone. It will send when you have a signal.'));
    }
    return savePayload(owner, payload);
  }
  function flush(signedInId) {
    var id = uuid(signedInId);
    if (!id) return Promise.resolve([]);
    var row = loadPending();
    if (!row || row.ownerId !== id) return Promise.resolve([]);
    return savePayload(id, row.payload).then(function () { return []; }, function () { return []; });
  }

  var api = {
    payloadFromRecord: payloadFromRecord,
    safeName: safeName,
    readQueue: readQueue,
    permanentError: permanentError,
    remember: remember,
    forget: forget,
    clearFor: clearFor,
    pendingCount: pendingCount,
    saveRecord: saveRecord,
    flush: flush
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBCircuitHistory = api;
})(typeof window !== 'undefined' ? window : globalThis);
