import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { MemoryStore } from '../server/stores/memory.js';

const voterA = 'voter-aaaaaaaaaaaaaaaaaaaa';
const voterB = 'voter-bbbbbbbbbbbbbbbbbbbb';

let server;
let base;

before(async () => {
  const store = new MemoryStore();
  server = http.createServer(createApp({ store, config: loadConfig({}) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function call(path, { method = 'GET', body, key } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

function createPoll(overrides = {}) {
  return call('/api/polls', { method: 'POST', body: { question: 'Lunch?', options: ['Tacos', 'Sushi'], ...overrides } });
}

test('creates a poll with a one-word link and counts votes once per voter', async () => {
  const { status, data: poll } = await createPoll();
  assert.equal(status, 201);
  assert.match(poll.slug, /^[a-z]+\d*$/);
  assert.ok(poll.adminKey);
  assert.equal(poll.adminHash, undefined);

  const first = await call(`/api/polls/${poll.slug}/votes`, { method: 'POST', body: { voter: voterA, choices: [1] } });
  assert.equal(first.status, 201);
  assert.deepEqual(first.data.myVote, [1]);
  assert.equal(first.data.options[1].votes, 1);

  const again = await call(`/api/polls/${poll.slug}/votes`, { method: 'POST', body: { voter: voterA, choices: [0] } });
  assert.equal(again.status, 200);
  assert.equal(again.data.alreadyVoted, true);
  assert.deepEqual(again.data.myVote, [1]);
  assert.equal(again.data.options[0].votes, 0);

  await call(`/api/polls/${poll.slug}/votes`, { method: 'POST', body: { voter: voterB, choices: [1] } });
  const { data } = await call(`/api/polls/${poll.slug}?voter=${voterB}`);
  assert.equal(data.voters, 2);
  assert.equal(data.options[1].votes, 2);
  assert.deepEqual(data.myVote, [1]);
});

test('multiple choice polls count each picked option', async () => {
  const { data: poll } = await createPoll({ options: ['A', 'B', 'C'], multiple: true });
  const { data } = await call(`/api/polls/${poll.slug}/votes`, { method: 'POST', body: { voter: voterA, choices: [0, 2] } });
  assert.deepEqual(data.options.map((option) => option.votes), [1, 0, 1]);
  assert.equal(data.voters, 1);
});

test('custom links must be free', async () => {
  const first = await createPoll({ slug: 'team-lunch' });
  assert.equal(first.status, 201);
  assert.equal(first.data.slug, 'team-lunch');

  const check = await call('/api/slugs/team-lunch');
  assert.deepEqual(check.data, { valid: true, available: false });

  const second = await createPoll({ slug: 'team-lunch' });
  assert.equal(second.status, 409);
});

test('only the creator can close or delete a poll', async () => {
  const { data: poll } = await createPoll();

  const stranger = await call(`/api/polls/${poll.slug}/close`, { method: 'POST', key: 'not-the-key' });
  assert.equal(stranger.status, 403);

  const closed = await call(`/api/polls/${poll.slug}/close`, { method: 'POST', key: poll.adminKey });
  assert.equal(closed.status, 200);
  assert.equal(closed.data.closed, true);

  const late = await call(`/api/polls/${poll.slug}/votes`, { method: 'POST', body: { voter: voterA, choices: [0] } });
  assert.equal(late.status, 409);

  assert.equal((await call(`/api/polls/${poll.slug}`, { method: 'DELETE' })).status, 403);
  assert.equal((await call(`/api/polls/${poll.slug}`, { method: 'DELETE', key: poll.adminKey })).status, 204);
  assert.equal((await call(`/api/polls/${poll.slug}`)).status, 404);
});

test('serves the poll page for one-word links and a 404 page otherwise', async () => {
  const page = await fetch(`${base}/maple`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /poll\.js/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);

  const missing = await fetch(`${base}/Not_A_Poll`);
  assert.equal(missing.status, 404);
});

test('makes QR codes as SVG', async () => {
  const response = await fetch(`${base}/api/qr?data=${encodeURIComponent('https://quickpoll.essam.biz/maple')}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/svg+xml');
  assert.match(await response.text(), /^<svg/);
});
