import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { DEFAULT_DURATION, DURATIONS, LIMITS } from './config.js';
import { HttpError, clientIp, readJson, sendJson } from './http.js';
import { isClosed, isVoterId, parsePollInput, parseVote, toPublicPoll } from './polls.js';
import { RateLimiter } from './rate-limit.js';
import { Router } from './router.js';
import { isValidSlug, randomWord, randomWordWithNumber } from './slug.js';

const MAX_JSON_BYTES = 16 * 1024;
const MAX_QR_LENGTH = 512;

// The routes are the same everywhere; `store` decides where polls live
// (a local JSON file, or Upstash Redis on Vercel).
export function createApi({ store, config }) {
  const requestLimit = new RateLimiter({ windowMs: 60_000, max: 300 });
  const createLimit = store.limiter({ name: 'create', windowMs: 10 * 60_000, max: 20 });
  const voteLimit = store.limiter({ name: 'vote', windowMs: 60_000, max: 30 });
  // One-word links are easy to guess, so looking up links that don't exist
  // (or asking whether one is taken) has a much tighter budget.
  const lookupLimit = store.limiter({ name: 'lookup', windowMs: 10 * 60_000, max: 100 });

  const router = new Router()
    .on('GET', '/api/config', getConfig)
    .on('GET', '/api/qr', getQrCode)
    .on('GET', '/api/slugs/:slug', checkSlug)
    .on('POST', '/api/polls', createPoll)
    .on('GET', '/api/polls/:slug', getPoll)
    .on('DELETE', '/api/polls/:slug', deletePoll)
    .on('POST', '/api/polls/:slug/votes', vote)
    .on('POST', '/api/polls/:slug/close', closePoll);

  return async function handleApi(req, res, url) {
    res.setHeader('X-Robots-Tag', 'noindex');

    const ip = clientIp(req, config.trustProxy);
    if (!requestLimit.take(ip)) {
      throw new HttpError(429, 'Too many requests. Try again in a minute.');
    }

    const { handler, params } = router.match(req.method, url.pathname);
    await handler({ req, res, url, params, ip });
  };

  function getConfig({ res }) {
    sendJson(res, 200, { durations: DURATIONS, defaultDuration: DEFAULT_DURATION, limits: LIMITS });
  }

  async function getQrCode({ res, url }) {
    const data = url.searchParams.get('data') ?? '';
    if (data === '' || data.length > MAX_QR_LENGTH) throw new HttpError(400, 'Nothing to encode.');

    const svg = await QRCode.toString(data, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.end(svg);
  }

  async function checkSlug({ res, params, ip }) {
    await requireLookupBudget(ip);
    const valid = isValidSlug(params.slug);
    sendJson(res, 200, { valid, available: valid && !(await store.isTaken(params.slug)) });
  }

  async function createPoll({ req, res, ip }) {
    if (!(await createLimit.take(ip))) {
      throw new HttpError(429, 'Too many polls created. Try again in a few minutes.');
    }

    const input = parsePollInput(await readJson(req, MAX_JSON_BYTES));
    if (input.slug && (await store.isTaken(input.slug))) {
      throw new HttpError(409, 'That link is already taken.');
    }

    const adminKey = randomBytes(24).toString('base64url');
    const now = Date.now();
    const poll = {
      slug: input.slug ?? (await uniqueSlug()),
      question: input.question,
      options: input.options,
      multiple: input.multiple,
      createdAt: now,
      closesAt: now + input.duration * 1000,
      closedAt: null,
      adminHash: hashKey(adminKey),
    };
    await store.create(poll);

    const counts = poll.options.map(() => 0);
    sendJson(res, 201, { ...toPublicPoll({ poll, counts, voters: 0 }), adminKey });
  }

  async function getPoll({ res, url, params, ip }) {
    const voter = url.searchParams.get('voter');
    const entry = await store.get(params.slug, isVoterId(voter) ? voter : null);
    if (!entry) {
      await requireLookupBudget(ip);
      throw notFound();
    }
    sendJson(res, 200, toPublicPoll(entry));
  }

  async function vote({ req, res, params, ip }) {
    const { poll } = await requirePoll(params.slug);
    if (isClosed(poll)) throw new HttpError(409, 'Voting has closed on this poll.');
    if (!(await voteLimit.take(ip))) {
      throw new HttpError(429, 'Too many votes from this network. Try again in a minute.');
    }

    const { voter, choices } = parseVote(await readJson(req, MAX_JSON_BYTES), poll);
    const recorded = await store.vote(poll, voter, choices);

    const entry = await requirePoll(params.slug, voter);
    sendJson(res, recorded ? 201 : 200, { ...toPublicPoll(entry), alreadyVoted: !recorded });
  }

  async function closePoll({ req, res, params }) {
    const { poll } = await requirePoll(params.slug);
    requireAdmin(req, poll);

    if (!isClosed(poll)) {
      poll.closedAt = Date.now();
      await store.close(poll);
    }
    sendJson(res, 200, toPublicPoll(await requirePoll(params.slug)));
  }

  async function deletePoll({ req, res, params }) {
    const { poll } = await requirePoll(params.slug);
    requireAdmin(req, poll);
    await store.delete(poll.slug);
    res.writeHead(204).end();
  }

  async function uniqueSlug() {
    for (const pick of [randomWord, randomWordWithNumber]) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const slug = pick();
        if (!(await store.isTaken(slug))) return slug;
      }
    }
    throw new HttpError(503, 'Could not create a link. Try again.');
  }

  async function requireLookupBudget(ip) {
    if (!(await lookupLimit.take(ip))) {
      throw new HttpError(429, 'Too many lookups. Try again in a few minutes.');
    }
  }

  async function requirePoll(slug, voter = null) {
    const entry = await store.get(slug, voter);
    if (!entry) throw notFound();
    return entry;
  }
}

function notFound() {
  return new HttpError(404, 'This poll does not exist or has been removed.');
}

function requireAdmin(req, poll) {
  const header = req.headers.authorization ?? '';
  const key = header.startsWith('Bearer ') ? header.slice(7) : '';
  const matches =
    key !== '' && timingSafeEqual(Buffer.from(hashKey(key), 'hex'), Buffer.from(poll.adminHash, 'hex'));
  if (!matches) throw new HttpError(403, 'Only the person who made this poll can change it.');
}

function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}
