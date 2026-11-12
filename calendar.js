/* Private program-calendar link. Browser: window.WBCalendar. Node: require.
   The feed itself is built by the calendar-feed Edge Function. This file only
   makes the link the Programs page shows. */
(function (root) {
  'use strict';

  var HOST = 'https://thyrgloermygnezfareg.supabase.co';
  var ZONE_PATTERN = '^[A-Za-z0-9_+-]{1,64}(/[A-Za-z0-9_+-]{1,64}){0,3}$';
  var TOKEN_PATTERN = '^[0-9a-f]{64}$';
  var zoneRe = new RegExp(ZONE_PATTERN);
  var tokenRe = new RegExp(TOKEN_PATTERN);

  function validZone(zone) { return zoneRe.test(String(zone || '')); }
  function validToken(token) { return tokenRe.test(String(token || '')); }
  function newToken() {
    var bytes = new Uint8Array(32);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    var hex = '';
    for (var j = 0; j < bytes.length; j++) hex += ('0' + bytes[j].toString(16)).slice(-2);
    return hex;
  }
  function deviceZone() {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (validZone(zone)) return zone;
    } catch (e) {}
    return 'America/Guayaquil';
  }
  function feedUrl(token) {
    return HOST + '/functions/v1/calendar-feed/' + token + '.ics';
  }
  function googleAddUrl(url) {
    var webcal = String(url || '').replace(/^https:\/\//i, 'webcal://');
    return 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal);
  }

  var api = {
    HOST: HOST,
    ZONE_PATTERN: ZONE_PATTERN,
    TOKEN_PATTERN: TOKEN_PATTERN,
    validZone: validZone,
    validToken: validToken,
    newToken: newToken,
    deviceZone: deviceZone,
    feedUrl: feedUrl,
    googleAddUrl: googleAddUrl
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WBCalendar = api;
})(typeof window !== 'undefined' ? window : globalThis);
