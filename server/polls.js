import { DEFAULT_DURATION, DURATIONS, KEEP_AFTER_CLOSE_MS, LIMITS } from './config.js';
import { HttpError } from './http.js';
import { isValidSlug } from './slug.js';

const VOTER_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function parsePollInput(body) {
  if (!isPlainObject(body)) throw invalid('Send the poll as a JSON object.');

  const question = cleanText(body.question);
  if (question === '') throw invalid('Add a question.');
  if (question.length > LIMITS.questionLength) {
    throw invalid(`Keep the question under ${LIMITS.questionLength} characters.`);
  }

  // Empty rows are normal (the form always keeps a blank one at the end).
  const options = Array.isArray(body.options) ? body.options.map(cleanText).filter(Boolean) : [];
  if (options.length < LIMITS.minOptions) throw invalid('Add at least two options.');
  if (options.length > LIMITS.maxOptions) throw invalid(`A poll can have up to ${LIMITS.maxOptions} options.`);
  if (options.some((option) => option.length > LIMITS.optionLength)) {
    throw invalid(`Keep each option under ${LIMITS.optionLength} characters.`);
  }
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    throw invalid('Two of the options are the same.');
  }

  const duration = body.duration ?? DEFAULT_DURATION;
  if (!DURATIONS.some((choice) => choice.seconds === duration)) {
    throw invalid('Pick how long voting stays open.');
  }

  // A name only means something on public polls; empty means Anonymous.
  const isPublic = body.public === true;
  const author = isPublic ? cleanText(body.author) : '';
  if (author.length > LIMITS.authorLength) {
    throw invalid(`Keep your name under ${LIMITS.authorLength} characters.`);
  }

  const hasSlug = body.slug !== undefined && body.slug !== null && body.slug !== '';
  if (hasSlug && !isValidSlug(body.slug)) {
    throw invalid('Links use 3 to 40 lowercase letters, numbers and dashes.');
  }

  return {
    question,
    options,
    multiple: body.multiple === true,
    public: isPublic,
    author: author || null,
    duration,
    slug: hasSlug ? body.slug : null,
  };
}

export function parseVote(body, poll) {
  if (!isPlainObject(body)) throw invalid('Send the vote as a JSON object.');
  if (!isVoterId(body.voter)) throw invalid('Missing voter id.');

  const { choices } = body;
  if (!Array.isArray(choices) || choices.length === 0) throw invalid('Pick an option first.');

  const unique = [...new Set(choices)];
  const inRange = unique.every((choice) => Number.isInteger(choice) && choice >= 0 && choice < poll.options.length);
  if (!inRange || unique.length !== choices.length) throw invalid('That option does not exist.');
  if (!poll.multiple && unique.length > 1) throw invalid('This poll takes one answer.');

  return { voter: body.voter, choices: unique.sort((a, b) => a - b) };
}

export function isVoterId(value) {
  return typeof value === 'string' && VOTER_PATTERN.test(value);
}

export function isClosed(poll, now = Date.now()) {
  return poll.closedAt !== null || poll.closesAt <= now;
}

export function keepUntil(poll) {
  return (poll.closedAt ?? poll.closesAt) + KEEP_AFTER_CLOSE_MS;
}

// What anyone with the link may see. Never includes the admin key hash.
export function toPublicPoll({ poll, counts, voters, myVote }, now = Date.now()) {
  return {
    slug: poll.slug,
    question: poll.question,
    multiple: poll.multiple,
    public: poll.public === true,
    author: poll.public ? (poll.author ?? null) : null,
    createdAt: poll.createdAt,
    closesAt: poll.closedAt ?? poll.closesAt,
    closed: isClosed(poll, now),
    options: poll.options.map((text, index) => ({ text, votes: counts[index] ?? 0 })),
    voters,
    myVote: myVote ?? null,
  };
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message) {
  return new HttpError(400, message);
}
