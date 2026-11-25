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
  function readQueue() {
    try {
      var raw = root.localStorage.getItem(QUEUE);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function writeQueue(list) {
    try { root.localStorage.setItem(QUEUE, JSON.stringify(list || [])); } catch (e) {}
  }
  function permanentError(err) {
    var msg = String((err && err.message) || '');
    return /choose a linked client|that circuit could not be saved/i.test(msg);
  }
  function remember(userId, payload) {
    var id = String(userId || '');
    var list = readQueue().filter(function (row) {
      return !(row && row.userId === id && row.payload && row.payload.runId === payload.runId);
    });
    list.push({ userId: id, payload: payload });
    writeQueue(list);
  }
  function forget(userId, runId) {
    var id = String(userId || '');
    writeQueue(readQueue().filter(function (row) {
      return !(row && row.userId === id && row.payload && row.payload.runId === runId);
    }));
  }
  function clearQueue() {
    writeQueue([]);
  }
  function pendingCount() {
    return readQueue().length;
  }
  function savePayload(userId, payload) {
    var auth = root.WBAuth;
    if (!userId) {
      remember('', payload);
      return Promise.reject(new Error('Saved on this phone. It will send when you have a signal.'));
    }
    if (!auth || !auth.circuitSaveRun) {
      remember(userId, payload);
      return Promise.reject(new Error('Saving a circuit is not available yet.'));
    }
    return Promise.resolve().then(function () { return auth.circuitSaveRun(payload); }).then(function () {
      forget(userId, payload.runId);
      return { ok: true };
    }, function (err) {
      err = err || new Error('Could not save the circuit.');
      if (permanentError(err)) {
        err.permanent = true;
        forget(userId, payload.runId);
        return Promise.reject(err);
      }
      remember(userId, payload);
      return Promise.reject(err);
    });
  }
  function saveRecord(record, status, userId) {
    var payload = payloadFromRecord(record, status);
    if (record && record.runId) payload.runId = safeId(record.runId) || payload.runId;
    return savePayload(userId || '', payload);
  }
  function flush(userId) {
    var id = String(userId || '');
    if (!id) return Promise.resolve(readQueue());
    var list = readQueue().map(function (row) {
      if (row && row.payload && !row.userId) return { userId: id, payload: row.payload };
      return row;
    });
    writeQueue(list);
    var pending = list.filter(function (row) { return row && row.userId === id && row.payload; });
    if (!pending.length) return Promise.resolve([]);
    function step(i) {
      if (i >= pending.length) return Promise.resolve(readQueue());
      return savePayload(id, pending[i].payload).then(function () { return step(i + 1); }, function () { return step(i + 1); });
    }
    return step(0);
  }

  var api = {
    payloadFromRecord: payloadFromRecord,
    safeName: safeName,
    readQueue: readQueue,
    permanentError: permanentError,
    remember: remember,
    forget: forget,
    clearQueue: clearQueue,
    pendingCount: pendingCount,
    saveRecord: saveRecord,
    flush: flush
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WBCircuitHistory = api;
})(typeof window !== 'undefined' ? window : globalThis);
