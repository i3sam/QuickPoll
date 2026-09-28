import { api } from './api.js';
import { adminKeyFor, forgetPoll, setNotice, updateSavedPoll, voterId } from './device.js';
import {
  authorName,
  renderChoices,
  renderResults,
  selectedChoices,
  syncChoices,
  updateResults,
  voteSummary,
} from './poll-view.js';
import { $, confirmAction, copyText, formatRemaining, openDialog, timeAgo, toast } from './ui.js';

const REFRESH_MS = 4000;

const slug = decodeURIComponent(location.pathname.slice(1)).toLowerCase();
const voter = voterId();
const adminKey = adminKeyFor(slug);
const shareUrl = `${location.origin}/${slug}`;
const isFresh = new URLSearchParams(location.search).has('new');

const pollArticle = $('#poll');
const voteForm = $('#vote-form');
const voteButton = $('#vote-button');

let poll = null;
let view = null;
let choices = null;
let results = null;
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

function render() {
  document.title = `${poll.question} · QuickPoll`;
  $('#question').textContent = poll.question;
  $('#choices-legend').textContent = poll.question;
  $('#public-tag').hidden = !poll.public;
  $('#author').textContent = authorName(poll);
  pollArticle.classList.toggle('is-multiple', poll.multiple);

  choices = renderChoices(poll, 'choice');
  results = renderResults(poll);
  $('#choices-slot').replaceWith(choices);
  $('#results-slot').replaceWith(results);

  $('#loading').remove();
  pollArticle.hidden = false;
  renderShare();
  renderManage();
  $('#report-row').hidden = !poll.public || Boolean(adminKey);
  tick();
  showView(poll.myVote || poll.closed ? 'results' : 'vote');

  voteForm.addEventListener('change', onChoiceChange);
  voteForm.addEventListener('submit', onVote);
  document.addEventListener('keydown', onShortcut);
  $('#show-results').addEventListener('click', () => showView('results'));
  $('#back-to-vote').addEventListener('click', () => showView('vote'));
  $('#report').addEventListener('click', onReport);
}

/* Views */

function showView(name) {
  const changed = view !== name;
  view = name;
  voteForm.hidden = name !== 'vote';
  $('#results').hidden = name !== 'results';
  $('#back-to-vote').hidden = name !== 'results' || Boolean(poll.myVote) || poll.closed;
  renderHint();
  if (name === 'results') showResults({ fromZero: changed });
}

function renderHint() {
  let hint;
  if (poll.closed) hint = 'Final results.';
  else if (view === 'results') hint = 'Results update live.';
  else hint = poll.multiple ? 'Pick as many as you like.' : 'Pick one.';
  $('#poll-hint').textContent = hint;
}

function showResults(options) {
  updateResults(results, poll, options);
  $('#total').textContent = voteSummary(poll);
}

/* Voting */

function onChoiceChange() {
  syncChoices(choices);
  const count = selectedChoices(choices).length;
  voteButton.disabled = count === 0;
  voteButton.textContent = poll.multiple && count > 1 ? `Vote for ${count}` : 'Vote';
  $('#vote-error').hidden = true;
}

async function onVote(event) {
  event.preventDefault();
  const picked = selectedChoices(choices);
  if (picked.length === 0 || voting) return;

  voting = true;
  voteButton.classList.add('is-busy');
  try {
    const result = await api(`/api/polls/${encodeURIComponent(slug)}/votes`, {
      method: 'POST',
      body: { voter, choices: picked },
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

// Number keys pick options (1 for the first, and so on) while voting.
function onShortcut(event) {
  if (view !== 'vote' || event.metaKey || event.ctrlKey || event.altKey || $('dialog[open]')) return;

  const index = Number(event.key) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= poll.options.length) return;

  const input = choices.querySelectorAll('input')[index];
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
  if (view === 'results') showResults();
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

  $('#status').classList.toggle('is-closed', poll.closed);
  $('#status-text').textContent = poll.closed ? 'Closed' : 'Open';
  $('#countdown').textContent = poll.closed
    ? `ended ${timeAgo(poll.closesAt)}`
    : `closes in ${formatRemaining(remaining)}`;
}

/* Sharing */

function renderShare() {
  const host = document.createElement('span');
  host.textContent = `${location.host}/`;
  $('#share-url').replaceChildren(host, slug);

  $('#copy').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!(await copyText(shareUrl))) return toast("Couldn't copy. Select the link and copy it instead.");
    button.textContent = 'Copied';
    toast('Link copied');
    setTimeout(() => (button.textContent = 'Copy link'), 1600);
  });

  if (navigator.share) {
    const button = $('#native-share');
    button.hidden = false;
    button.addEventListener('click', () => {
      navigator.share({ title: poll.question, text: poll.question, url: shareUrl }).catch(() => {});
    });
  }

  $('#whatsapp').href = `https://wa.me/?text=${encodeURIComponent(`${poll.question}\nVote here: ${shareUrl}`)}`;

  $('#qr-button').addEventListener('click', () => {
    const image = $('#qr-image');
    if (!image.src) image.src = `/api/qr?data=${encodeURIComponent(shareUrl)}`;
    $('#qr-url').textContent = shareUrl.replace(/^https?:\/\//, '');
    openDialog($('#qr-dialog'));
  });

  $('#share').hidden = false;
  if (isFresh && adminKey) {
    // Right after making a poll, sharing it is the next thing to do.
    $('#fresh-note').hidden = false;
    $('#copy').focus();
  }
}

/* Managing and reporting */

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

async function onReport() {
  const confirmed = await confirmAction({
    title: 'Report this poll?',
    body: 'Polls that several people report are taken off the Community page.',
    action: 'Report',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api(`/api/polls/${encodeURIComponent(slug)}/report`, { method: 'POST', body: { voter } });
    $('#report-row').hidden = true;
    toast('Thanks for reporting');
  } catch (error) {
    toast(error.message);
  }
}

/* Missing */

function showMissing(title, text) {
  clearTimeout(refreshTimer);
  poll = null;
  $('#loading')?.remove();
  for (const id of ['#poll', '#share', '#manage', '#report-row', '#fresh-note']) $(id).hidden = true;
  if (title) $('#missing-title').textContent = title;
  if (text) $('#missing-text').textContent = text;
  $('#missing').hidden = false;
  document.title = 'Poll not found · QuickPoll';
  // Only a real "not found" means the poll is gone; a network hiccup doesn't.
  if (!title) forgetPoll(slug);
}
