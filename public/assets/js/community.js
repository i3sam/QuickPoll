import { api } from './api.js';
import { voterId } from './device.js';
import {
  authorName,
  renderChoices,
  renderResults,
  selectedChoices,
  syncChoices,
  timeLeft,
  updateResults,
  voteSummary,
} from './poll-view.js';
import { $, confirmAction, copyText, toast } from './ui.js';

const voter = voterId();
const feed = $('#feed');
const loadMoreButton = $('#load-more');
const tabs = [...document.querySelectorAll('[role="tab"]')];

let sort = 'new';
let next = 0;
let loading = false;
// Bumped when the tab changes, so a slow response for the old tab is ignored.
let generation = 0;

for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const other = tabs[(tabs.indexOf(tab) + 1) % tabs.length];
    other.focus();
    selectTab(other);
  });
}
loadMoreButton.addEventListener('click', loadPage);
loadPage();

function selectTab(tab) {
  if (tab.dataset.sort === sort) return;
  sort = tab.dataset.sort;
  for (const other of tabs) {
    other.setAttribute('aria-selected', String(other === tab));
    other.tabIndex = other === tab ? 0 : -1;
  }

  generation += 1;
  loading = false;
  next = 0;
  feed.replaceChildren();
  $('#feed-empty').hidden = true;
  loadMoreButton.hidden = true;
  loadPage();
}

async function loadPage() {
  if (loading || next === null) return;
  const current = generation;
  loading = true;
  $('#feed-loading').hidden = feed.children.length > 0;
  loadMoreButton.classList.add('is-busy');

  try {
    const params = new URLSearchParams({ sort, offset: String(next), voter });
    const data = await api(`/api/community?${params}`);
    if (current !== generation) return;

    feed.append(...data.polls.map(renderItem));
    next = data.next;
    $('#feed-error').hidden = true;
  } catch (error) {
    if (current !== generation) return;
    $('#feed-error').textContent = error.message;
    $('#feed-error').hidden = false;
  } finally {
    if (current === generation) {
      loading = false;
      $('#feed-loading').hidden = true;
      loadMoreButton.classList.remove('is-busy');
      loadMoreButton.hidden = next === null;
      $('#feed-empty').hidden = feed.children.length > 0 || !$('#feed-error').hidden;
    }
  }
}

function renderItem(initial) {
  let poll = initial;
  let view = poll.myVote ? 'results' : 'vote';
  let fromPointer = false;
  let voting = false;

  const item = document.createElement('li');
  item.className = 'feed-item';
  item.classList.toggle('is-multiple', poll.multiple);

  const meta = document.createElement('p');
  meta.className = 'feed-meta';

  const link = document.createElement('a');
  link.className = 'feed-question';
  link.href = `/${poll.slug}`;
  link.textContent = poll.question;

  const form = document.createElement('form');
  form.className = 'vote-form';
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = poll.question;
  const choices = renderChoices(poll, `choice-${poll.slug}`);
  fieldset.append(legend, choices);
  form.append(fieldset);

  const results = renderResults(poll);

  const actions = document.createElement('div');
  actions.className = 'feed-actions';
  actions.innerHTML = `
    <button class="primary" type="button" data-action="vote" disabled>Vote</button>
    <button class="text-button" type="button" data-action="toggle"></button>
    <button class="text-button" type="button" data-action="copy">Copy link</button>
    <button class="text-button" type="button" data-action="report">Report</button>`;
  const voteButton = actions.querySelector('[data-action="vote"]');
  const toggleButton = actions.querySelector('[data-action="toggle"]');

  item.append(meta, link, form, results, actions);
  show(view);

  // A tap on a single-choice option votes right away. Keyboard users move
  // between options with the arrow keys, so for them a Vote button appears.
  choices.addEventListener('pointerdown', () => {
    fromPointer = true;
  });
  form.addEventListener('change', () => {
    syncChoices(choices);
    const picked = selectedChoices(choices);
    if (!poll.multiple && fromPointer) {
      fromPointer = false;
      vote(picked);
      return;
    }
    voteButton.hidden = false;
    voteButton.disabled = picked.length === 0;
  });
  form.addEventListener('submit', (event) => event.preventDefault());

  actions.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'vote') vote(selectedChoices(choices));
    if (action === 'toggle') show(view === 'vote' ? 'results' : 'vote');
    if (action === 'copy') {
      const copied = await copyText(`${location.origin}/${poll.slug}`);
      toast(copied ? 'Link copied' : "Couldn't copy the link");
    }
    if (action === 'report') report();
  });

  function show(name) {
    const changed = name !== view || !item.isConnected;
    view = name;
    form.hidden = name !== 'vote';
    results.hidden = name !== 'results';
    voteButton.hidden = name !== 'vote' || !poll.multiple;
    toggleButton.textContent = name === 'vote' ? 'See results' : 'Back to voting';
    toggleButton.hidden = name === 'results' && Boolean(poll.myVote);
    const author = document.createElement('span');
    author.className = 'feed-author';
    author.textContent = authorName(poll);
    meta.replaceChildren(author, ` · ${voteSummary(poll)} · ${timeLeft(poll)}${poll.multiple ? ' · Pick any' : ''}`);
    if (name === 'results') updateResults(results, poll, { fromZero: changed });
  }

  async function vote(picked) {
    if (picked.length === 0 || voting) return;
    voting = true;
    fieldset.disabled = true;
    voteButton.classList.add('is-busy');

    try {
      poll = await api(`/api/polls/${encodeURIComponent(poll.slug)}/votes`, {
        method: 'POST',
        body: { voter, choices: picked },
      });
      show('results');
      toast(poll.alreadyVoted ? 'You already voted on this poll' : 'Vote counted');
    } catch (error) {
      toast(error.message);
      if (error.status === 404 || error.status === 409) item.remove();
    } finally {
      voting = false;
      fieldset.disabled = false;
      voteButton.classList.remove('is-busy');
    }
  }

  async function report() {
    const confirmed = await confirmAction({
      title: 'Report this poll?',
      body: 'Polls that several people report are taken off the Community page.',
      action: 'Report',
      danger: true,
    });
    if (!confirmed) return;

    try {
      await api(`/api/polls/${encodeURIComponent(poll.slug)}/report`, { method: 'POST', body: { voter } });
      item.remove();
      toast('Thanks for reporting');
    } catch (error) {
      toast(error.message);
    }
  }

  return item;
}
