// Link shape and calendar text. No network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../calendar.js');

(async function () {
  const ics = await import('../supabase/functions/calendar-feed/ics.js');
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261112150000_calendar_feeds.sql'), 'utf8');
  const fn = fs.readFileSync(path.join(__dirname, '../supabase/functions/calendar-feed/index.ts'), 'utf8');
  assert.ok(sql.includes(C.ZONE_PATTERN));
  assert.ok(sql.includes(C.TOKEN_PATTERN));
  assert.ok(ics.ZONE_PATTERN === C.ZONE_PATTERN);
  assert.ok(ics.TOKEN_PATTERN === C.TOKEN_PATTERN);
  assert.strictEqual(ics.DESCRIPTION, 'https://coachtrainerapp.com');
  assert.ok(fn.includes("auth: 'none'"));
  assert.ok(fn.includes('calendar_feed_for_token'));
  assert.ok(!/service_role|sb_secret|SUPABASE_SECRET/.test(fn));

  const token = C.newToken();
  assert.ok(C.validToken(token));
  assert.ok(!C.validToken(token.slice(1)));
  assert.ok(!C.validToken(token.toUpperCase()));
  assert.ok(C.validZone('America/Guayaquil'));
  assert.ok(C.validZone('America/New_York'));
  assert.ok(C.validZone('UTC'));
  assert.ok(!C.validZone('America/Guayaquil;drop'));
  assert.ok(!C.validZone('America/New York'));
  assert.strictEqual(C.deviceZone().length > 0, true);

  const url = C.feedUrl(token);
  assert.strictEqual(url, 'https://thyrgloermygnezfareg.supabase.co/functions/v1/calendar-feed/' + token + '.ics');
  const google = C.googleAddUrl(url);
  assert.strictEqual(google.indexOf('https://calendar.google.com/calendar/r?cid='), 0);
  assert.strictEqual(decodeURIComponent(google.split('cid=')[1]), url.replace('https://', 'webcal://'));
  assert.strictEqual(ics.tokenFromUrl(url), token);
  assert.strictEqual(ics.tokenFromUrl(url.toUpperCase()), token);
  assert.strictEqual(ics.tokenFromUrl('https://thyrgloermygnezfareg.supabase.co/functions/v1/calendar-feed?token=' + token), token);
  assert.strictEqual(ics.tokenFromUrl('https://thyrgloermygnezfareg.supabase.co/functions/v1/calendar-feed'), '');

  const ownId = '11111111-1111-4111-8111-111111111111';
  const clientId = '22222222-2222-4222-8222-222222222222';
  const body = ics.buildIcs({
    timezone: 'America/Guayaquil',
    events: [
      {
        id: ownId,
        title: 'Morning lift',
        day: '2026-11-12',
        start: '09:00',
        end: '10:30',
        updated: '2026-11-12T12:00:00Z'
      },
      {
        id: clientId,
        title: 'Morning lift \u2013 Jane',
        day: '2026-11-13',
        start: '06:00',
        end: '07:00',
        updated: '2026-11-12T12:00:00Z'
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Easy day, park',
        day: '2026-11-14',
        start: null,
        end: null,
        updated: '2026-11-12T12:00:00Z'
      }
    ]
  }, new Date('2026-11-12T15:00:00Z'));

  assert.ok(body.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(body.endsWith('END:VCALENDAR\r\n'));
  assert.ok(body.includes('UID:' + ownId + '@coachtrainerapp.com'));
  assert.ok(body.includes('UID:' + clientId + '@coachtrainerapp.com'));
  assert.ok(body.includes('SUMMARY:Morning lift\r\n'));
  assert.ok(body.includes('SUMMARY:Morning lift \u2013 Jane\r\n'));
  assert.ok(body.includes('DESCRIPTION:https://coachtrainerapp.com'));
  assert.strictEqual(body.split('DESCRIPTION:https://coachtrainerapp.com').length - 1, 3);
  assert.ok(body.includes('DTSTART:20261112T140000Z'));
  assert.ok(body.includes('DTEND:20261112T153000Z'));
  assert.ok(body.includes('DTSTART:20261113T110000Z'));
  assert.ok(body.includes('DTEND:20261113T120000Z'));
  assert.ok(body.includes('DTSTART;VALUE=DATE:20261114'));
  assert.ok(body.includes('DTEND;VALUE=DATE:20261115'));
  assert.ok(body.includes('SUMMARY:Easy day\\, park'));
  assert.ok(body.includes('X-WR-TIMEZONE:America/Guayaquil'));
  const again = ics.buildIcs({
    timezone: 'America/Guayaquil',
    events: [{ id: ownId, title: 'Morning lift', day: '2026-11-12', start: '18:00', end: '19:00', updated: '2026-11-12T18:00:00Z' }]
  }, new Date('2026-11-12T18:00:00Z'));
  assert.ok(again.includes('UID:' + ownId + '@coachtrainerapp.com'));
  assert.ok(again.includes('DTSTART:20261112T230000Z'));
  assert.ok(!again.includes('DTSTART:20261112T140000Z'));

  const ny = ics.buildIcs({
    timezone: 'America/New_York',
    events: [{ id: ownId, title: 'Summer', day: '2026-07-15', start: '09:00', end: '10:00', updated: '2026-07-15T12:00:00Z' }]
  }, new Date('2026-07-15T12:00:00Z'));
  assert.ok(ny.includes('DTSTART:20260715T130000Z'));
  assert.ok(ny.includes('DTEND:20260715T140000Z'));
  console.log('calendar ok');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
