import { api } from './api.js';
import { rememberPoll, savedPolls, takeNotice } from './device.js';
import { isValidSlug, normalizeSlug } from './slug.js';
import { $, LETTERS, formatRemaining, toast } from './ui.js';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const QUESTION_MAX = 200;
const EXAMPLES = ['Burgers', 'Sushi', 'Somewhere new'];

const form = $('#create');
const question = $('#question');
const questionCount = $('#question-count');
const optionList = $('#option-list');
const addButton = $('#add-option');
const slugInput = $('#slug');
const slugStatus = $('#slug-status');
const errorBox = $('#form-error');
const submitButton = $('#submit');

let slugCheck = null;
let busy = false;

init();

function init() {
  addOption();
  addOption();

  $('#link-prefix').textContent = `${location.host}/`;
  if (/Mac|iPhone|iPad/.test(navigator.platform)) $('#mod-key').textContent = '⌘';

  question.addEventListener('input', onQuestionInput);
  fitQuestion();
  document.fonts?.ready.then(fitQuestion);
  addEventListener('resize', fitQuestion);
  question.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !isSubmitShortcut(event)) {
      event.preventDefault();
      optionInputs()[0].focus();
    }
  });

  addButton.addEventListener('click', () => addOption().focus());
  optionList.addEventListener('input', onOptionInput);
  optionList.addEventListener('keydown', onOptionKeydown);
  optionList.addEventListener('paste', onOptionPaste);
  optionList.addEventListener('click', onRemoveClick);

  slugInput.addEventListener('input', onSlugInput);
  form.addEventListener('keydown', (event) => {
    if (isSubmitShortcut(event)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', onSubmit);

  renderSavedPolls();
  const notice = takeNotice();
  if (notice) toast(notice);

  // Jump straight into typing on computers; on phones that would pop up the keyboard.
  if (matchMedia('(pointer: fine)').matches) question.focus();
}

/* Question */

function onQuestionInput() {
  fitQuestion();

  const left = QUESTION_MAX - question.value.length;
  questionCount.textContent = left <= 40 ? `${left} left` : '';
  questionCount.classList.toggle('is-near', left <= 40);
  hideError();
}

// Grows the box with the text. While it's empty, the example question sets
// the height, so it never shows up cut in half on a narrow screen.
function fitQuestion() {
  question.style.height = 'auto';
  let height = question.scrollHeight;
  if (question.value === '') {
    question.value = question.placeholder;
    height = question.scrollHeight;
    question.value = '';
  }
  question.style.height = `${height}px`;
}

/* Options */

function optionRows() {
  return [...optionList.children];
}

function optionInputs() {
  return optionRows().map((row) => row.querySelector('input'));
}

function addOption(value = '', after = null) {
  const row = document.createElement('li');
  row.className = 'option-row';
  row.innerHTML = `
    <span class="option-key" aria-hidden="true"></span>
    <input type="text" maxlength="100" autocomplete="off" enterkeyhint="next">
    <button type="button" class="icon-button remove-option">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>`;
  const input = row.querySelector('input');
  input.value = value;

  if (after) after.after(row);
  else optionList.append(row);
  relabel();
  return input;
}

function removeOption(row) {
  const rows = optionRows();
  if (rows.length <= MIN_OPTIONS) return;

  const index = rows.indexOf(row);
  row.remove();
  relabel();
  const inputs = optionInputs();
  const next = inputs[Math.min(index, inputs.length - 1)];
  next.focus();
}

function relabel() {
  const rows = optionRows();
  rows.forEach((row, index) => {
    const letter = LETTERS[index];
    row.querySelector('.option-key').textContent = letter;

    const input = row.querySelector('input');
    input.placeholder = EXAMPLES[index] ?? `Option ${letter}`;
    input.setAttribute('aria-label', `Option ${letter}`);

    const remove = row.querySelector('.remove-option');
    const removable = rows.length > MIN_OPTIONS;
    remove.setAttribute('aria-label', `Remove option ${letter}`);
    remove.setAttribute('aria-hidden', String(!removable));
    remove.tabIndex = removable ? 0 : -1;
  });
  addButton.hidden = rows.length >= MAX_OPTIONS;
}

// Typing in the last option adds a fresh empty one below it, so there's
// always room for one more without pressing anything.
function onOptionInput(event) {
  const rows = optionRows();
  const row = event.target.closest('.option-row');
  if (row === rows.at(-1) && event.target.value.trim() !== '' && rows.length < MAX_OPTIONS) {
    addOption();
  }
  hideError();
}

function onOptionKeydown(event) {
  const row = event.target.closest('.option-row');
  if (!row || event.target.tagName !== 'INPUT' || isSubmitShortcut(event)) return;

  const inputs = optionInputs();
  const index = inputs.indexOf(event.target);

  if (event.key === 'Enter') {
    event.preventDefault();
    if (index < inputs.length - 1) inputs[index + 1].focus();
    else if (inputs.length < MAX_OPTIONS) addOption().focus();
    else submitButton.focus();
  } else if (event.key === 'Backspace' && event.target.value === '' && inputs.length > MIN_OPTIONS && index > 0) {
    event.preventDefault();
    row.remove();
    relabel();
    const previous = optionInputs()[index - 1];
    previous.focus();
    previous.setSelectionRange(previous.value.length, previous.value.length);
  } else if (event.key === 'ArrowDown' && index < inputs.length - 1) {
    event.preventDefault();
    inputs[index + 1].focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (index > 0) inputs[index - 1].focus();
    else question.focus();
  }
}

// Pasting a list (one option per line) fills in several options at once.
function onOptionPaste(event) {
  const input = event.target;
  if (input.tagName !== 'INPUT') return;

  const lines = (event.clipboardData?.getData('text') ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)]|[A-Za-z][.)])\s+/, '').trim())
    .filter(Boolean);
  if (lines.length < 2) return;

  event.preventDefault();
  let row = input.closest('.option-row');
  input.value = lines.shift();

  for (const line of lines) {
    const next = row.nextElementSibling?.querySelector('input');
    if (next && next.value.trim() === '') {
      next.value = line;
      row = next.closest('.option-row');
    } else if (optionRows().length < MAX_OPTIONS) {
      row = addOption(line, row).closest('.option-row');
    }
  }

  const rows = optionRows();
  if (rows.at(-1).querySelector('input').value.trim() !== '' && rows.length < MAX_OPTIONS) addOption();
  row.querySelector('input').focus();
}

function onRemoveClick(event) {
  const button = event.target.closest('.remove-option');
  if (button && button.getAttribute('aria-hidden') !== 'true') removeOption(button.closest('.option-row'));
}

/* Custom link */

function onSlugInput() {
  const cleaned = normalizeSlug(slugInput.value);
  if (cleaned !== slugInput.value) slugInput.value = cleaned;
  clearTimeout(slugCheck);

  const slug = cleaned.replace(/-+$/, '');
  if (slug === '') return showSlugStatus('');
  if (!isValidSlug(slug)) return showSlugStatus('Use 3 to 40 letters, numbers or dashes.', 'bad');

  showSlugStatus('Checking...');
  slugCheck = setTimeout(async () => {
    try {
      const { available } = await api(`/api/slugs/${encodeURIComponent(slug)}`);
      if (normalizeSlug(slugInput.value).replace(/-+$/, '') !== slug) return;
      showSlugStatus(available ? `${location.host}/${slug} is free` : 'That link is taken. Try another.', available ? 'good' : 'bad');
    } catch (error) {
      showSlugStatus(error.message, 'bad');
    }
  }, 350);
}

function showSlugStatus(message, tone = '') {
  slugStatus.textContent = message;
  slugStatus.classList.toggle('is-good', tone === 'good');
  slugStatus.classList.toggle('is-bad', tone === 'bad');
}

/* Submit */

async function onSubmit(event) {
  event.preventDefault();
  if (busy) return;

  const payload = collect();
  const problem = check(payload);
  if (problem) {
    showError(problem.message);
    problem.focus?.focus();
    return;
  }

  setBusy(true);
  try {
    const poll = await api('/api/polls', { method: 'POST', body: payload });
    rememberPoll(poll);
    location.assign(`/${poll.slug}?new`);
  } catch (error) {
    showError(error.message);
    setBusy(false);
  }
}

function collect() {
  const slug = normalizeSlug(slugInput.value).replace(/-+$/, '');
  return {
    question: question.value.trim(),
    options: optionInputs()
      .map((input) => input.value.trim())
      .filter(Boolean),
    multiple: $('#multiple').checked,
    duration: Number(form.elements.duration.value),
    slug: $('#custom-link').open && slug ? slug : null,
  };
}

function check({ question: text, options, slug }) {
  if (text === '') return { message: 'Add a question first.', focus: question };

  const firstEmpty = optionInputs().find((input) => input.value.trim() === '');
  if (options.length < MIN_OPTIONS) return { message: 'Add at least two options.', focus: firstEmpty };

  const seen = new Set();
  for (const input of optionInputs()) {
    const value = input.value.trim().toLowerCase();
    if (value === '') continue;
    if (seen.has(value)) return { message: 'Two of the options are the same.', focus: input };
    seen.add(value);
  }

  if (slug && !isValidSlug(slug)) {
    return { message: 'Custom links use 3 to 40 letters, numbers or dashes.', focus: slugInput };
  }
  return null;
}

function setBusy(value) {
  busy = value;
  submitButton.classList.toggle('is-busy', value);
  submitButton.setAttribute('aria-busy', String(value));
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  // Restart the shake when the same error shows up twice in a row.
  errorBox.style.animation = 'none';
  void errorBox.offsetWidth;
  errorBox.style.animation = '';
}

function hideError() {
  errorBox.hidden = true;
}

function isSubmitShortcut(event) {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey);
}

/* Polls made on this device */

function renderSavedPolls() {
  const polls = savedPolls();
  if (polls.length === 0) return;

  const now = Date.now();
  const items = polls.map((poll) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/${poll.slug}`;

    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'saved-question';
    title.textContent = poll.question;
    const meta = document.createElement('span');
    meta.className = 'saved-meta';
    const state = poll.closesAt > now ? `Closes in ${formatRemaining(poll.closesAt - now)}` : 'Closed';
    meta.textContent = `/${poll.slug} · ${state}`;
    text.append(title, meta);

    link.append(text);
    link.insertAdjacentHTML(
      'beforeend',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    );
    item.append(link);
    return item;
  });

  $('#saved-list').replaceChildren(...items);
  $('#saved').hidden = false;
}
