import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PAGE_CSP } from '../server/static.js';

test('vercel.json sends the same page CSP as the local server', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const headers = config.headers.find((rule) => rule.source === '/(.*)').headers;
  const csp = headers.find((header) => header.key === 'Content-Security-Policy').value;
  assert.equal(csp, PAGE_CSP);
});

test('vercel.json only rewrites valid link shapes to the poll page', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rule = config.rewrites.find((rewrite) => rewrite.destination === '/poll.html');
  assert.ok(rule.source.includes('[a-z0-9][a-z0-9-]{1,38}[a-z0-9]'));
});
