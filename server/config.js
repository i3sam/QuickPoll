import path from 'node:path';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export const DURATIONS = [
  { seconds: HOUR, label: '1 hour' },
  { seconds: DAY, label: '1 day' },
  { seconds: 7 * DAY, label: '1 week' },
  { seconds: 30 * DAY, label: '1 month' },
];

export const DEFAULT_DURATION = 7 * DAY;

// Results stay up this long after voting closes, then the poll is removed.
export const KEEP_AFTER_CLOSE_MS = 30 * DAY * 1000;

export const LIMITS = Object.freeze({
  questionLength: 200,
  optionLength: 100,
  minOptions: 2,
  maxOptions: 10,
});

export function loadConfig(env = process.env) {
  return Object.freeze({
    port: readInt(env, 'PORT', 3000),
    host: env.HOST || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR || 'data'),
    trustProxy: Boolean(env.VERCEL) || env.TRUST_PROXY === 'true',
  });
}

function readInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a whole number, got "${raw}"`);
  }
  return value;
}
