import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../http.js';
import { isClosed, keepUntil } from '../polls.js';
import { RateLimiter } from '../rate-limit.js';

// Keeps polls in memory and, when given a folder, saves them to a JSON file
// so they survive a restart. Right for one process; use Redis for more.
export class MemoryStore {
  #polls = new Map();
  #seeded = false;
  #file;
  #saving = null;
  #dirty = false;

  constructor({ dir = null } = {}) {
    this.#file = dir ? path.join(dir, 'polls.json') : null;
  }

  async init() {
    if (!this.#file) return;
    await fs.mkdir(path.dirname(this.#file), { recursive: true });

    let saved;
    try {
      saved = JSON.parse(await fs.readFile(this.#file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    this.#seeded = saved.seeded === true;
    for (const { poll, counts, voters, reports = [] } of saved.polls ?? []) {
      this.#polls.set(poll.slug, { poll, counts, voters: new Map(voters), reports: new Set(reports) });
    }
  }

  async get(slug, voter = null, now = Date.now()) {
    const entry = this.#live(slug, now);
    return entry ? view(entry, voter) : null;
  }

  async isTaken(slug) {
    return this.#live(slug) !== null;
  }

  async create(poll) {
    if (this.#live(poll.slug)) throw new HttpError(409, 'That link is already taken.');
    this.#polls.set(poll.slug, {
      poll: { ...poll },
      counts: poll.options.map(() => 0),
      voters: new Map(),
      reports: new Set(),
    });
    this.#save();
  }

  // Returns false when this voter has already voted.
  async vote(poll, voter, choices) {
    const entry = this.#live(poll.slug);
    if (!entry || entry.voters.has(voter)) return false;

    entry.voters.set(voter, choices);
    for (const choice of choices) entry.counts[choice] += 1;
    this.#save();
    return true;
  }

  async close(poll) {
    const entry = this.#live(poll.slug);
    if (!entry) return;
    entry.poll.closedAt = poll.closedAt;
    this.#save();
  }

  async delete(slug) {
    this.#polls.delete(slug);
    this.#save();
  }

  // Open public polls, newest first or with the most votes first.
  async listPublic({ sort, offset, limit, voter = null, now = Date.now() }) {
    const open = [...this.#polls.values()].filter(
      ({ poll }) => poll.public && !poll.hidden && !isClosed(poll, now) && keepUntil(poll) > now,
    );
    const newest = (a, b) => b.poll.createdAt - a.poll.createdAt;
    open.sort(sort === 'top' ? (a, b) => b.voters.size - a.voters.size || newest(a, b) : newest);

    const page = open.slice(offset, offset + limit);
    return {
      entries: page.map((entry) => view(entry, voter)),
      next: offset + limit < open.length ? offset + limit : null,
    };
  }

  // Each voter id counts once. Enough reports take the poll out of the feed.
  async report(poll, voter, threshold) {
    const entry = this.#live(poll.slug);
    if (!entry) return;
    entry.reports.add(voter);
    if (entry.reports.size >= threshold) entry.poll.hidden = true;
    this.#save();
  }

  // True only the first time it's called, so starter polls are added once.
  async claimSeed() {
    if (this.#seeded) return false;
    this.#seeded = true;
    this.#save();
    return true;
  }

  async sweep(now = Date.now()) {
    let removed = 0;
    for (const [slug, entry] of this.#polls) {
      if (keepUntil(entry.poll) > now) continue;
      this.#polls.delete(slug);
      removed += 1;
    }
    if (removed > 0) this.#save();
    return removed;
  }

  limiter(options) {
    const limiter = new RateLimiter(options);
    return { take: async (key) => limiter.take(key) };
  }

  // Resolves once everything changed so far is on disk.
  async flush() {
    await this.#saving;
  }

  #live(slug, now = Date.now()) {
    const entry = this.#polls.get(slug);
    return entry && keepUntil(entry.poll) > now ? entry : null;
  }

  // Changes that arrive while a save is running are picked up by that same
  // save's next loop, so there is never more than one write at a time.
  #save() {
    if (!this.#file) return;
    this.#dirty = true;
    this.#saving ??= this.#writeLoop();
  }

  async #writeLoop() {
    try {
      while (this.#dirty) {
        this.#dirty = false;
        const data = {
          seeded: this.#seeded,
          polls: [...this.#polls.values()].map(({ poll, counts, voters, reports }) => ({
            poll,
            counts,
            voters: [...voters],
            reports: [...reports],
          })),
        };
        const temp = `${this.#file}.tmp`;
        await fs.writeFile(temp, JSON.stringify(data));
        await fs.rename(temp, this.#file);
      }
    } catch (error) {
      console.error('Could not save polls:', error);
    } finally {
      this.#saving = null;
    }
  }
}

function view(entry, voter) {
  return {
    poll: { ...entry.poll },
    counts: [...entry.counts],
    voters: entry.voters.size,
    myVote: (voter && entry.voters.get(voter)) ?? null,
  };
}
