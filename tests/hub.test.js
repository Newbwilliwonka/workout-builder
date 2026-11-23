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

assert.strictEqual(H.validateRequest('  hello  ').note, 'hello');
assert.strictEqual(H.validateRequest('').ok, true);
assert.strictEqual(H.validateRequest('x'.repeat(301)).message, 'Keep the note short.');
assert.strictEqual(H.NOTE_MAX, 300);

const found = H.findResultsHtml({
  trainers: [{
    id: 't1',
    name: '<script>Coach</script>',
    role: 'Master Trainer',
    verified: true,
    serviceType: 'both',
    request: 'none',
    email: 'coach@example.com'
  }, {
    id: 't2',
    name: 'Bea',
    role: 'Trainer',
    verified: false,
    serviceType: 'online',
    request: 'open',
    email: 'bea@example.com'
  }]
});
assert.ok(found.indexOf('Online only') !== -1);
assert.ok(found.indexOf('Near me') !== -1);
assert.ok(found.indexOf('Coming soon') === -1);
assert.ok(found.indexOf('id="find-near" disabled') === -1);
assert.ok(found.indexOf('aria-pressed="false">Near me</button>') !== -1);
assert.ok(found.indexOf('<script>') === -1);
assert.ok(found.indexOf('@') === -1);
assert.ok(found.indexOf('Request to message') !== -1);
assert.ok(found.indexOf('>Requested<') !== -1);
assert.ok(found.indexOf('In Person and Online') !== -1);
assert.ok(found.indexOf('>Both<') === -1);
assert.ok(found.indexOf('Master Trainer') !== -1);
assert.strictEqual(H.distanceLabel({ distanceMiles: 0 }), 'About 1 mi');
assert.strictEqual(H.distanceLabel({ distanceMiles: 2.4 }), 'About 2 mi');
assert.strictEqual(H.distanceLabel({}), '');
assert.strictEqual(H.placeLabel({ city: ' Austin ', state: 'Texas' }), 'Austin, Texas');
const near = H.findResultsHtml({
  mode: 'near',
  searched: true,
  trainers: [{
    id: 't3',
    name: 'Cara',
    role: 'Trainer',
    verified: false,
    serviceType: 'in_person',
    request: 'none',
    city: '<script>Austin</script>',
    state: 'Texas',
    distanceMiles: 2,
    email: 'cara@example.com',
    latitude: 30.2672
  }]
});
assert.ok(near.indexOf('About 2 mi') !== -1);
assert.ok(near.indexOf('&lt;script&gt;Austin&lt;/script&gt;, Texas · About 2 mi') !== -1);
assert.ok(near.indexOf('<script>') === -1);
assert.ok(near.indexOf('30.2672') === -1);
assert.ok(near.indexOf('Your location is used only for this search and is not saved.') !== -1);
assert.ok(near.indexOf('Use my location') !== -1);
assert.ok(near.indexOf('@') === -1);
assert.ok(near.indexOf('In person') !== -1);
const onlineCard = H.findResultsHtml({
  trainers: [{
    id: 't4',
    name: 'Bea',
    role: 'Trainer',
    serviceType: 'online',
    city: 'Dallas',
    state: 'Texas',
    request: 'none'
  }]
});
assert.ok(onlineCard.indexOf('>Online<') !== -1);
assert.ok(onlineCard.indexOf('Dallas') === -1);
const bothCard = H.findResultsHtml({
  trainers: [{
    id: 't5',
    name: 'Amy',
    role: 'Master Trainer',
    serviceType: 'both',
    city: 'Austin',
    state: 'Texas',
    request: 'none'
  }]
});
assert.ok(bothCard.indexOf('In Person and Online') !== -1);
assert.ok(bothCard.indexOf('Austin, Texas') !== -1);
const onlineRequest = H.requestFormHtml({
  id: 't4',
  name: 'Bea',
  role: 'Trainer',
  serviceType: 'online',
  city: 'Dallas',
  state: 'Texas'
});
assert.ok(onlineRequest.indexOf('Dallas') === -1);
assert.ok(onlineRequest.indexOf('>Online<') !== -1);

const linkedOnly = H.findResultsHtml({
  mode: 'online',
  trainers: [{
    id: 'zara',
    name: 'Zara Coach',
    role: 'Trainer',
    verified: false,
    serviceType: 'in_person',
    city: 'Austin',
    state: 'Texas',
    isLinked: true,
    email: 'zara@example.com',
    request: 'none'
  }]
});
assert.ok(linkedOnly.indexOf('>Your trainer<') !== -1);
assert.ok(linkedOnly.indexOf('No other trainers are listed yet.') !== -1);
assert.ok(linkedOnly.indexOf('id="find-none"') !== -1);
assert.ok(linkedOnly.indexOf('data-message="zara"') !== -1);
assert.ok(linkedOnly.indexOf('Request to message') === -1);
assert.ok(linkedOnly.indexOf('No trainers are available online right now.') === -1);
assert.ok(linkedOnly.indexOf('@') === -1);
assert.ok(linkedOnly.indexOf('Zara Coach') !== -1);
assert.ok(linkedOnly.indexOf('Austin, Texas') !== -1);
assert.ok(linkedOnly.indexOf('data-trainer="zara"') === -1);

const linkedFirst = H.findResultsHtml({
  trainers: [
    {
      id: 'bea',
      name: 'Bea',
      role: 'Trainer',
      serviceType: 'online',
      request: 'none',
      isLinked: false,
      email: 'bea@example.com'
    },
    {
      id: 'zara',
      name: 'Zara Coach',
      role: 'Trainer',
      serviceType: 'online',
      isLinked: true,
      email: 'zara@example.com'
    },
    {
      id: 'zara',
      name: 'Zara Coach',
      role: 'Trainer',
      serviceType: 'online',
      isLinked: false
    }
  ]
});
const zaraAt = linkedFirst.indexOf('data-message="zara"');
const beaAt = linkedFirst.indexOf('data-trainer="bea"');
assert.ok(zaraAt !== -1 && zaraAt < beaAt);
assert.strictEqual(linkedFirst.split('data-message="zara"').length - 1, 1);
assert.strictEqual(linkedFirst.split('Zara Coach').length - 1, 1);
assert.ok(linkedFirst.indexOf('id="find-none"') === -1);
assert.ok(linkedFirst.indexOf('data-request="bea"') !== -1);
assert.ok(linkedFirst.indexOf('data-request="zara"') === -1);
assert.ok(linkedFirst.indexOf('@') === -1);
assert.ok(linkedFirst.indexOf('No other trainers are listed yet.') === -1);

const snakeLinked = H.findResultsHtml({
  trainers: [{ id: 'zed', name: 'Zed', role: 'Trainer', serviceType: 'online', is_linked: true }]
});
assert.ok(snakeLinked.indexOf('data-message="zed"') !== -1);
assert.ok(snakeLinked.indexOf('>Your trainer<') !== -1);
assert.ok(snakeLinked.indexOf('No other trainers are listed yet.') !== -1);

const noneOnline = H.findResultsHtml({ trainers: [] });
assert.ok(noneOnline.indexOf('No trainers are available online right now.') !== -1);
assert.ok(noneOnline.indexOf('No other trainers are listed yet.') === -1);
assert.ok(noneOnline.indexOf('id="find-empty"') !== -1);

const noneNear = H.findResultsHtml({ mode: 'near', searched: true, trainers: [] });
assert.ok(noneNear.indexOf('No trainers are near that place right now.') !== -1);
assert.ok(noneNear.indexOf('No other trainers are listed yet.') === -1);
assert.ok(noneNear.indexOf('Your trainer') === -1);

const nearPrompt = H.findResultsHtml({
  mode: 'near',
  searched: false,
  trainers: [{ id: 'zara', name: 'Zara Coach', role: 'Trainer', isLinked: true }]
});
assert.ok(nearPrompt.indexOf('Your trainer') === -1);
assert.ok(nearPrompt.indexOf('id="find-list"') === -1);
assert.ok(nearPrompt.indexOf('No other trainers are listed yet.') === -1);

const requestForm = H.requestFormHtml({
  id: 't1',
  name: 'Amy <Coach>',
  role: 'Trainer',
  serviceType: 'online',
  email: 'amy@example.com'
});
assert.ok(requestForm.indexOf('Amy &lt;Coach&gt;') !== -1);
assert.ok(requestForm.indexOf('@') === -1);
assert.ok(requestForm.indexOf('id="find-note"') !== -1);
assert.ok(requestForm.indexOf('maxlength="300"') !== -1);
assert.ok(requestForm.indexOf('Send request') !== -1);

const incoming = H.requestCardsHtml([{
  id: 'r1',
  name: 'Ada <Lee>',
  role: 'Free Client',
  note: 'Hello <script>alert(1)</script>',
  at: '2026-11-18T12:00:00.000Z',
  email: 'ada@example.com'
}]);
assert.ok(incoming.indexOf('@') === -1);
assert.ok(incoming.indexOf('<script>') === -1);
assert.ok(incoming.indexOf('Ada &lt;Lee&gt;') !== -1);
assert.ok(incoming.indexOf('Hello &lt;script&gt;') !== -1);
assert.ok(incoming.indexOf('data-request-approve="r1"') !== -1);
assert.ok(incoming.indexOf('data-request-decline="r1"') !== -1);
assert.ok(incoming.indexOf('>Approve<') !== -1);
assert.ok(incoming.indexOf('>Decline<') !== -1);
assert.strictEqual(H.viewerOf({ membership: 'free_client' }).finder, true);
assert.strictEqual(H.viewerOf({ membership: 'trainer' }).inbox, true);
assert.strictEqual(H.viewerOf({ membership: 'trainer' }).finder, false);

console.log('hub rules ok');
