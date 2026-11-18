// Trainer Hub text, order, and privacy. No browser and no database.
const assert = require('assert');
global.WBProfile = require('../profile.js');
const H = require('../hub.js');

assert.strictEqual(H.clean('  hi  '), 'hi');
assert.strictEqual(H.validatePost({ title: '  ', body: 'Hello' }).message, 'Enter a title.');
assert.strictEqual(H.validatePost({ title: 'Hello', body: '  ' }).message, 'Enter a post.');
assert.strictEqual(H.validatePost({ title: 'x'.repeat(121), body: 'Hello' }).message, 'That title is too long.');
assert.strictEqual(H.validatePost({ title: 'Hello', body: 'x'.repeat(4001) }).message, 'That post is too long.');
assert.deepStrictEqual(H.validatePost({ title: '  Saturday  ', body: '  9am  ' }), {
  ok: true, message: '', title: 'Saturday', body: '9am'
});
assert.strictEqual(H.validateReply('   ').message, 'Enter a reply.');
assert.strictEqual(H.validateReply('x'.repeat(2001)).message, 'That reply is too long.');
assert.strictEqual(H.validateReply('  See you  ').body, 'See you');

assert.strictEqual(H.publicName('ada@example.com', 'Free Client'), 'Client');
assert.strictEqual(H.publicName('Coach Kim', 'Trainer'), 'Coach Kim');
assert.strictEqual(H.publicName('', 'Master Trainer'), 'Trainer');
assert.strictEqual(H.roleOf('Nope'), 'Member');

const posts = H.sortPosts([
  { id: 'a', title: 'Older', activityAt: '2026-11-01T00:00:00.000Z' },
  { id: 'c', title: 'Same late', activityAt: '2026-11-18T00:00:00.000Z' },
  { id: 'b', title: 'Same early', activityAt: '2026-11-18T00:00:00.000Z' }
]);
assert.deepStrictEqual(posts.map(function (row) { return row.id; }), ['c', 'b', 'a']);

const nasty = {
  id: 'p1',
  title: '<script>alert(1)</script>',
  body: '<img src=x onerror="alert(1)">\nline',
  activityAt: '2026-11-18T15:00:00.000Z',
  replyCount: 1,
  author: { name: 'ada@example.com', role: 'Free Client', verified: false },
  email: 'ada@example.com',
  author_email: 'secret@example.com'
};
const list = H.listHtml([nasty]);
assert.ok(list.indexOf('<script>') === -1);
assert.ok(list.indexOf('<img') === -1);
assert.ok(list.indexOf('&lt;script&gt;') !== -1);
assert.ok(list.indexOf('@') === -1);
assert.ok(list.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;') !== -1);
assert.ok(list.indexOf('Client') !== -1);
assert.ok(list.indexOf('Free Client') !== -1);
assert.ok(list.indexOf('1 reply') !== -1);

const thread = H.postHtml(Object.assign({ mine: false, reported: false, createdAt: nasty.activityAt }, nasty), [
  {
    id: 'r1',
    body: '<b>bold</b>',
    createdAt: '2026-11-18T16:00:00.000Z',
    mine: false,
    reported: false,
    author: { name: 'Jo Park', role: 'Enthusiast', verified: false },
    email: 'jo@example.com'
  }
], '');
assert.ok(thread.indexOf('<script>') === -1);
assert.ok(thread.indexOf('<b>') === -1);
assert.ok(thread.indexOf('@') === -1);
assert.ok(thread.indexOf('Jo Park') !== -1);
assert.ok(thread.indexOf('Enthusiast') !== -1);
assert.ok(thread.indexOf('id="hub-report"') !== -1);
assert.ok(thread.indexOf('data-reply-report="r1"') !== -1);

const mine = H.postHtml({
  id: 'p2', title: 'Mine', body: 'Hello', createdAt: '2026-11-18T12:00:00.000Z', mine: true,
  author: { name: 'Coach Kim', role: 'Trainer', verified: true }
}, [], '');
assert.ok(mine.indexOf('id="hub-edit"') !== -1);
assert.ok(mine.indexOf('id="hub-delete"') !== -1);
assert.ok(mine.indexOf('id="hub-report"') === -1);
assert.ok(mine.indexOf('Verified') !== -1 || mine.indexOf('seal') !== -1);

const form = H.formHtml(null);
assert.ok(form.indexOf('id="hub-title"') !== -1);
assert.ok(form.indexOf('>Post<') !== -1);
const editing = H.formHtml({ id: 'p2', title: 'A & B', body: '<tag>' });
assert.ok(editing.indexOf('value="A &amp; B"') !== -1);
assert.ok(editing.indexOf('&lt;tag&gt;') !== -1);
assert.ok(editing.indexOf('>Save<') !== -1);

const reports = H.reportCardsHtml([{
  id: 'rep-1',
  kind: 'post',
  postId: 'p1',
  title: 'Deload weeks',
  body: 'How do you <script> plan them?',
  createdAt: '2026-11-18T12:00:00.000Z',
  authorName: 'Jo Park',
  authorRole: 'Enthusiast',
  reporterName: 'Ada Lee',
  email: 'jo@example.com',
  reporterEmail: 'ada@example.com'
}]);
assert.ok(reports.indexOf('@') === -1);
assert.ok(reports.indexOf('<script>') === -1);
assert.ok(reports.indexOf('Jo Park') !== -1);
assert.ok(reports.indexOf('Enthusiast') !== -1);
assert.ok(reports.indexOf('Reported by Ada Lee') !== -1);
assert.ok(reports.indexOf('data-hub-report="delete"') !== -1);
assert.ok(reports.indexOf('data-hub-report="dismiss"') !== -1);
assert.ok(H.reportCardsHtml([]).indexOf('No reports waiting') !== -1);

console.log('hub rules ok');
