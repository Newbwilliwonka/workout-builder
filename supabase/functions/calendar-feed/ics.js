// Turns a calendar_feed_for_token result into a text/calendar body.
// Times are converted to UTC from the timezone stored when the link was created,
// so Google shows the same clock time the person scheduled.

const ZONE_PATTERN = '^[A-Za-z0-9_+-]{1,64}(/[A-Za-z0-9_+-]{1,64}){0,3}$';
const TOKEN_PATTERN = '^[0-9a-f]{64}$';
const DESCRIPTION = 'https://coachtrainerapp.com';
const zoneRe = new RegExp(ZONE_PATTERN);
const tokenRe = new RegExp(TOKEN_PATTERN);

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function validZone(zone) {
  return zoneRe.test(String(zone || ''));
}

function icsText(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldLine(line) {
  const encoder = new TextEncoder();
  let out = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of String(line)) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit && out.length) {
      out += '\r\n ';
      bytes = 1;
      limit = 75;
    }
    out += ch;
    bytes += n;
  }
  return out;
}

function zoneOffsetMs(utcDate, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const map = {};
  dtf.formatToParts(utcDate).forEach(function (part) {
    if (part.type !== 'literal') map[part.type] = part.value;
  });
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return asUTC - utcDate.getTime();
}

function zonedToUtc(day, time, timeZone) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(time || ''));
  if (!dm || !tm || !validZone(timeZone)) return null;
  const utc = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), Number(tm[3] || 0));
  let offset = zoneOffsetMs(new Date(utc), timeZone);
  let adjusted = utc - offset;
  const offset2 = zoneOffsetMs(new Date(adjusted), timeZone);
  if (offset2 !== offset) adjusted = utc - offset2;
  return new Date(adjusted);
}

function formatUtc(date) {
  return date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) + 'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) + 'Z';
}

function dateStamp(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return '';
  return m[1] + m[2] + m[3];
}

function nextDateStamp(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
}

function clockOk(value) {
  return /^(\d{2}):(\d{2})(?::\d{2})?$/.test(String(value || ''));
}

function uidFor(id) {
  const clean = String(id || '').toLowerCase().replace(/[^0-9a-f-]/g, '');
  return (clean || 'entry') + '@coachtrainerapp.com';
}

function sequenceOf(updated, fallbackMs) {
  const t = Date.parse(updated);
  const ms = isFinite(t) ? t : fallbackMs;
  if (!isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 1000);
}

export function tokenFromUrl(input) {
  let url;
  try { url = new URL(String(input || '')); } catch (e) { return ''; }
  const query = String(url.searchParams.get('token') || '').toLowerCase();
  if (tokenRe.test(query)) return query;
  const parts = url.pathname.split('/').filter(Boolean);
  let last = parts[parts.length - 1] || '';
  try { last = decodeURIComponent(last); } catch (e) { last = ''; }
  last = last.replace(/\.ics$/i, '').toLowerCase();
  return tokenRe.test(last) ? last : '';
}

export function buildIcs(feed, now) {
  const stampDate = now instanceof Date ? now : new Date();
  const stamp = formatUtc(stampDate);
  const zone = feed && validZone(feed.timezone) ? feed.timezone : '';
  const events = feed && Array.isArray(feed.events) ? feed.events : [];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Coach Trainer//Program Calendar//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Programs'
  ];
  if (zone) lines.push('X-WR-TIMEZONE:' + zone);
  lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT4H');
  lines.push('X-PUBLISHED-TTL:PT4H');
  events.forEach(function (event) {
    const day = dateStamp(event && event.day);
    if (!day) return;
    const title = icsText((event.title && String(event.title).trim()) || 'Workout');
    const updated = sequenceOf(event.updated, stampDate.getTime());
    const modified = isFinite(Date.parse(event.updated)) ? formatUtc(new Date(event.updated)) : stamp;
    const start = clockOk(event.start) ? event.start : '';
    const end = clockOk(event.end) ? event.end : '';
    const startUtc = zone && start && end ? zonedToUtc(event.day, start, zone) : null;
    const endUtc = zone && start && end ? zonedToUtc(event.day, end, zone) : null;
    const timed = !!(startUtc && endUtc && endUtc.getTime() > startUtc.getTime());
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + uidFor(event.id));
    lines.push('DTSTAMP:' + stamp);
    if (timed) {
      lines.push('DTSTART:' + formatUtc(startUtc));
      lines.push('DTEND:' + formatUtc(endUtc));
    } else if (start && end && !zone) {
      lines.push('DTSTART:' + day + 'T' + start.slice(0, 2) + start.slice(3, 5) + '00');
      lines.push('DTEND:' + day + 'T' + end.slice(0, 2) + end.slice(3, 5) + '00');
    } else {
      lines.push('DTSTART;VALUE=DATE:' + day);
      lines.push('DTEND;VALUE=DATE:' + nextDateStamp(event.day));
    }
    lines.push('SUMMARY:' + title);
    lines.push('DESCRIPTION:' + icsText(DESCRIPTION));
    lines.push('LAST-MODIFIED:' + modified);
    lines.push('SEQUENCE:' + updated);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export { DESCRIPTION, ZONE_PATTERN, TOKEN_PATTERN };
