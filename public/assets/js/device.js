// Everything here lives only in this browser. Storage can be blocked
// (private windows, strict settings), so every read and write may fail.

const VOTER_KEY = 'quickpoll:voter';
const POLLS_KEY = 'quickpoll:polls';
const MAX_SAVED = 20;
const KEEP_AFTER_CLOSE_MS = 30 * 24 * 60 * 60 * 1000;

let fallbackVoter = null;

// A random id that marks this browser's votes, so it can't vote twice.
export function voterId() {
  const stored = read(VOTER_KEY);
  if (stored) return stored;

  fallbackVoter ??= randomId();
  write(VOTER_KEY, fallbackVoter);
  return fallbackVoter;
}

// Polls made on this device, newest first. Each one holds the key that
// lets this browser close or delete it.
export function savedPolls(now = Date.now()) {
  let list;
  try {
    list = JSON.parse(read(POLLS_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.filter((poll) => poll && typeof poll.slug === 'string' && poll.closesAt + KEEP_AFTER_CLOSE_MS > now);
}

export function rememberPoll({ slug, question, closesAt, adminKey }) {
  const others = savedPolls().filter((poll) => poll.slug !== slug);
  write(POLLS_KEY, JSON.stringify([{ slug, question, closesAt, adminKey }, ...others].slice(0, MAX_SAVED)));
}

export function updateSavedPoll(slug, changes) {
  const list = savedPolls();
  const poll = list.find((candidate) => candidate.slug === slug);
  if (!poll) return;
  Object.assign(poll, changes);
  write(POLLS_KEY, JSON.stringify(list));
}

export function forgetPoll(slug) {
  write(POLLS_KEY, JSON.stringify(savedPolls().filter((poll) => poll.slug !== slug)));
}

export function adminKeyFor(slug) {
  return savedPolls().find((poll) => poll.slug === slug)?.adminKey ?? null;
}

// The name last used on a public poll, filled in again next time.
export function savedName() {
  return read('quickpoll:name') ?? '';
}

export function saveName(name) {
  write('quickpoll:name', name);
}

// Used to pass a one-off message to the next page, like "poll deleted".
export function setNotice(value) {
  try {
    sessionStorage.setItem('quickpoll:notice', value);
  } catch {}
}

export function takeNotice() {
  try {
    const value = sessionStorage.getItem('quickpoll:notice');
    sessionStorage.removeItem('quickpoll:notice');
    return value;
  } catch {
    return null;
  }
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_');
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
