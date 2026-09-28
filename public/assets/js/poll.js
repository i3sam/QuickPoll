import { api } from './api.js';
import { adminKeyFor, forgetPoll, setNotice, updateSavedPoll, voterId } from './device.js';
import { $, LETTERS, confirmAction, copyText, formatRemaining, openDialog, plural, timeAgo, toast } from './ui.js';

const REFRESH_MS = 4000;
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

const slug = decodeURIComponent(location.pathname.slice(1)).toLowerCase();
const voter = voterId();
const shareUrl = `${location.origin}/${slug}`;
const isFresh = new URLSearchParams(location.search).has('new');

const pollCard = $('#poll');
const choicesList = $('#choices');
const resultsList = $('#results-list');
const voteForm = $('#vote-form');
const voteButton = $('#vote-button');
const results = $('#results');

let poll = null;
const adminKey = adminKeyFor(slug);
let view = null;
let selected = new Set();
let voting = false;
let refreshTimer = null;
let refreshing = false;

if (isFresh) history.replaceState(null, '', `/${slug}`);
load();

async function load() {
  try {
    poll = await fetchPoll();
  } catch (error) {
    if (error.status === 404) showMissing();
    else showMissing("Couldn't load this poll", error.message);
    return;
  }

  render();
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  scheduleRefresh();
}

function fetchPoll() {
  return api(`/api/polls/${encodeURIComponent(slug)}?voter=${encodeURIComponent(voter)}`);
}

/* First render */

function render() {
  document.title = `${poll.question} · QuickPoll`;
  $('#question').textContent = poll.question;
  $('#choices-legend').textContent = poll.question;
  pollCard.classList.toggle('is-multiple', poll.multiple);

  choicesList.replaceChildren(...poll.options.map(renderChoice));
  resultsList.replaceChildren(...poll.options.map(renderResult));

  $('#loading').remove();
  pollCard.hidden = false;
  renderShare();
  renderManage();
  tick();
  showView(poll.myVote || poll.closed ? 'results' : 'vote');

  voteForm.addEventListener('change', onChoiceChange);
  voteForm.addEventListener('submit', onVote);
  document.addEventListener('keydown', onShortcut);
  $('#show-results').addEventListener('click', () => showView('results'));
  $('#back-to-vote').addEventListener('click', () => showView('vote'));
}

function renderChoice(option, index) {
  const item = document.createElement('li');
  item.innerHTML = `
    <label class="choice">
      <input type="${poll.multiple ? 'checkbox' : 'radio'}" name="choice" value="${index}">
      <span class="choice-key" aria-hidden="true">${LETTERS[index]}</span>
      <span class="choice-text"></span>
      <span class="choice-check" aria-hidden="true">${CHECK_ICON}</span>
    </label>`;
  item.querySelector('.choice-text').textContent = option.text;
  item.style.animationDelay = `${index * 40}ms`;
  return item;
}

function renderResult(option, index) {
  const item = document.createElement('li');
  item.innerHTML = `
    <div class="result">
      <span class="result-fill" aria-hidden="true"></span>
      <span class="result-text"><span class="result-label"></span><span class="result-mine">${CHECK_ICON}You</span></span>
      <span class="result-numbers">
        <span class="result-pct">0%</span>
        <span class="result-count">0 votes</span>
      </span>
    </div>`;
  item.querySelector('.result-label').textContent = option.text;
  item.style.animationDelay = `${index * 50}ms`;
  return item;
}

/* Views */

function showView(name) {
  const changed = view !== name;
  view = name;
  voteForm.hidden = name !== 'vote';
  results.hidden = name !== 'results';
  renderHint();
  $('#back-to-vote').hidden = name !== 'results' || Boolean(poll.myVote) || poll.closed;

  if (name === 'results') {
    // Start the bars empty so they grow in when the results appear.
    if (changed) resultRows().forEach((row) => row.style.setProperty('--share', '0%'));
    requestAnimationFrame(() => requestAnimationFrame(updateResults));
  }
}

function renderHint() {
  let hint;
  if (poll.closed) hint = 'Final results.';
  else if (view === 'results') hint = 'Results update live.';
  else hint = poll.multiple ? 'Pick as many as you like.' : 'Pick one.';
  $('#poll-hint').textContent = hint;
}

function resultRows() {
  return [...resultsList.querySelectorAll('.result')];
}

function updateResults() {
  const top = Math.max(...poll.options.map((option) => option.votes));

  poll.options.forEach((option, index) => {
    const row = resultRows()[index];
    const share = poll.voters > 0 ? option.votes / poll.voters : 0;
    row.style.setProperty('--share', `${(share * 100).toFixed(2)}%`);
    row.querySelector('.result-pct').textContent = `${Math.round(share * 100)}%`;
    row.querySelector('.result-count').textContent = plural(option.votes, 'vote');
    row.classList.toggle('is-leading', top > 0 && option.votes === top);
    row.classList.toggle('is-mine', poll.myVote?.includes(index) ?? false);
  });

  const total = $('#total');
  const count = poll.voters.toLocaleString();
  const label = poll.multiple
    ? `${count} ${poll.voters === 1 ? 'person' : 'people'} voted`
    : plural(poll.voters, 'vote');
  if (total.dataset.value !== label) {
    total.dataset.value = label;
    total.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = label;
    total.append(strong);
    strong.classList.add('bump');
  }
}

/* Voting */

function onChoiceChange(event) {
  const input = event.target;
  const index = Number(input.value);

  if (poll.multiple) {
    if (input.checked) selected.add(index);
    else selected.delete(index);
  } else {
    selected = new Set([index]);
  }

  for (const choice of choicesList.querySelectorAll('.choice')) {
    choice.classList.toggle('is-selected', choice.querySelector('input').checked);
  }
  voteButton.disabled = selected.size === 0;
  voteButton.textContent = poll.multiple && selected.size > 1 ? `Vote for ${selected.size}` : 'Vote';
  $('#vote-error').hidden = true;
}

async function onVote(event) {
  event.preventDefault();
  if (selected.size === 0 || voting) return;

  voting = true;
  voteButton.classList.add('is-busy');
  try {
    const result = await api(`/api/polls/${encodeURIComponent(slug)}/votes`, {
      method: 'POST',
      body: { voter, choices: [...selected] },
    });
    applyPoll(result);
    showView('results');
    toast(result.alreadyVoted ? 'You already voted on this poll' : 'Vote counted');
  } catch (error) {
    if (error.status === 404) return showMissing();
    const box = $('#vote-error');
    box.textContent = error.message;
    box.hidden = false;
    if (error.status === 409) refresh();
  } finally {
    voting = false;
    voteButton.classList.remove('is-busy');
  }
}

// Letters pick options (A, B, C...) when the vote form is showing.
function onShortcut(event) {
  if (view !== 'vote' || event.metaKey || event.ctrlKey || event.altKey || $('dialog[open]')) return;

  const index = LETTERS.indexOf(event.key.toUpperCase());
  if (event.key.length !== 1 || index < 0 || index >= poll.options.length) return;

  const input = choicesList.querySelectorAll('input')[index];
  input.focus();
  input.click();
}

/* Live updates */

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (poll && !poll.closed) refreshTimer = setTimeout(refresh, REFRESH_MS);
}

async function refresh() {
  if (refreshing || !poll) return;
  if (document.hidden) return scheduleRefresh();

  refreshing = true;
  try {
    applyPoll(await fetchPoll());
  } catch (error) {
    if (error.status === 404) return showMissing();
  } finally {
    refreshing = false;
  }
  scheduleRefresh();
}

function applyPoll(fresh) {
  const wasClosed = poll.closed;
  poll = fresh;
  if (view === 'results') updateResults();
  if (poll.closed && !wasClosed) onClosed();
  tick();
}

function onClosed() {
  clearTimeout(refreshTimer);
  showView('results');
  $('#close-poll').hidden = true;
  updateSavedPoll(slug, { closesAt: poll.closesAt });
}

function tick() {
  if (!poll) return;
  const remaining = poll.closesAt - Date.now();
  if (!poll.closed && remaining <= 0) {
    poll.closed = true;
    onClosed();
    refresh();
  }

  renderHint();
  $('#status').classList.toggle('is-closed', poll.closed);
  $('#status-text').textContent = poll.closed ? 'Closed' : 'Live';
  $('#countdown').textContent = poll.closed
    ? `Voting ended ${timeAgo(poll.closesAt)}`
    : `Closes in ${formatRemaining(remaining)}`;
}

/* Sharing */

function renderShare() {
  const card = $('#share');
  const url = $('#share-url');
  const host = document.createElement('span');
  host.textContent = `${location.host}/`;
  url.replaceChildren(host, slug);

  $('#copy').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!(await copyText(shareUrl))) return toast("Couldn't copy. Select the link and copy it instead.");
    button.textContent = 'Copied';
    toast('Link copied');
    setTimeout(() => (button.textContent = 'Copy'), 1600);
  });

  if (navigator.share) {
    const button = $('#native-share');
    button.hidden = false;
    button.addEventListener('click', () => {
      navigator.share({ title: poll.question, text: `${poll.question}\nVote here:`, url: shareUrl }).catch(() => {});
    });
  }

  $('#whatsapp').href = `https://wa.me/?text=${encodeURIComponent(`${poll.question}\nVote here: ${shareUrl}`)}`;

  $('#qr-button').addEventListener('click', () => {
    const image = $('#qr-image');
    if (!image.src) image.src = `/api/qr?data=${encodeURIComponent(shareUrl)}`;
    $('#qr-url').textContent = shareUrl.replace(/^https?:\/\//, '');
    openDialog($('#qr-dialog'));
  });

  card.hidden = false;
  if (isFresh && adminKey) {
    // Right after making a poll, sharing it is the next thing to do.
    card.classList.add('is-fresh');
    $('#share-note').hidden = false;
    pollCard.before(card);
    $('#copy').focus();
  }
}

/* Managing */

function renderManage() {
  if (!adminKey) return;
  $('#manage').hidden = false;
  $('#close-poll').hidden = poll.closed;

  $('#close-poll').addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Close voting?',
      body: 'No one can vote after this. The results stay up for 30 days.',
      action: 'Close voting',
    });
    if (!confirmed) return;

    try {
      applyPoll(await api(`/api/polls/${encodeURIComponent(slug)}/close`, { method: 'POST', key: adminKey }));
      toast('Voting closed');
    } catch (error) {
      toast(error.message);
    }
  });

  $('#delete-poll').addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Delete this poll?',
      body: "The poll and every vote on it are removed for everyone. This can't be undone.",
      action: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    try {
      await api(`/api/polls/${encodeURIComponent(slug)}`, { method: 'DELETE', key: adminKey });
      forgetPoll(slug);
      setNotice('Poll deleted');
      location.assign('/');
    } catch (error) {
      toast(error.message);
    }
  });
}

/* Missing */

function showMissing(title, text) {
  clearTimeout(refreshTimer);
  poll = null;
  $('#loading')?.remove();
  for (const id of ['#poll', '#share', '#manage']) $(id).hidden = true;
  if (title) $('#missing-title').textContent = title;
  if (text) $('#missing-text').textContent = text;
  $('#missing').hidden = false;
  document.title = 'Poll not found · QuickPoll';
  // Only a real "not found" means the poll is gone; a network hiccup doesn't.
  if (!title) forgetPoll(slug);
}
