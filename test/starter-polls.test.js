import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { STARTER_POLLS } from '../server/starter-polls.js';
import { MemoryStore } from '../server/stores/memory.js';

async function withServer(store, env, run) {
  const server = http.createServer(createApp({ store, config: loadConfig(env) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('starter polls are posted once, with no votes', async () => {
  const store = new MemoryStore();
  await withServer(store, {}, async (base) => {
    const first = await (await fetch(`${base}/api/community`)).json();
    const again = await (await fetch(`${base}/api/community`)).json();

    assert.equal(first.polls.length, STARTER_POLLS.length);
    assert.equal(again.polls.length, STARTER_POLLS.length);
    assert.ok(first.polls.every((poll) => poll.voters === 0 && !poll.closed));
    assert.equal(first.polls[0].question, STARTER_POLLS[0].question);
    assert.ok(first.polls.some((poll) => poll.author === null));
  });

  // A second server on the same store must not add them again.
  await withServer(store, {}, async (base) => {
    const { polls } = await (await fetch(`${base}/api/community`)).json();
    assert.equal(polls.length, STARTER_POLLS.length);
  });
});

test('STARTER_POLLS=false skips them', async () => {
  await withServer(new MemoryStore(), { STARTER_POLLS: 'false' }, async (base) => {
    const { polls } = await (await fetch(`${base}/api/community`)).json();
    assert.equal(polls.length, 0);
  });
});
