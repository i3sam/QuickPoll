import { formatRemaining, plural } from './ui.js';

// Builds the vote options and result bars. Used by the poll page and the
// Community feed, so both look and behave the same.

const CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

export function renderChoices(poll, name) {
  const list = document.createElement('ul');
  list.className = 'choices';

  poll.options.forEach((option, index) => {
    const item = document.createElement('li');
    item.innerHTML = `
      <label class="choice">
        <input type="${poll.multiple ? 'checkbox' : 'radio'}" name="${name}" value="${index}">
        <span class="choice-mark" aria-hidden="true">${CHECK}</span>
        <span class="choice-text"></span>
      </label>`;
    item.querySelector('.choice-text').textContent = option.text;
    list.append(item);
  });
  return list;
}

export function selectedChoices(list) {
  return [...list.querySelectorAll('input:checked')].map((input) => Number(input.value));
}

export function syncChoices(list) {
  for (const choice of list.querySelectorAll('.choice')) {
    choice.classList.toggle('is-selected', choice.querySelector('input').checked);
  }
}

export function renderResults(poll) {
  const list = document.createElement('ul');
  list.className = 'results-list';

  for (const option of poll.options) {
    const item = document.createElement('li');
    item.className = 'result';
    item.innerHTML = `
      <div class="result-top">
        <span class="result-text"><span class="result-label"></span><span class="result-mine">${CHECK}Your vote</span></span>
        <span class="result-numbers"><span class="result-count"></span><span class="result-pct"></span></span>
      </div>
      <div class="result-track" aria-hidden="true"><span class="result-fill"></span></div>`;
    item.querySelector('.result-label').textContent = option.text;
    list.append(item);
  }
  return list;
}

// With fromZero the bars start empty and grow, for when results first appear.
export function updateResults(list, poll, { fromZero = false } = {}) {
  const rows = [...list.children];
  const top = Math.max(...poll.options.map((option) => option.votes));

  const apply = () => {
    poll.options.forEach((option, index) => {
      const row = rows[index];
      const share = poll.voters > 0 ? option.votes / poll.voters : 0;
      row.style.setProperty('--share', `${(share * 100).toFixed(2)}%`);
      row.querySelector('.result-count').textContent = plural(option.votes, 'vote');
      row.querySelector('.result-pct').textContent = `${Math.round(share * 100)}%`;
      row.classList.toggle('is-leading', top > 0 && option.votes === top);
      row.classList.toggle('is-mine', poll.myVote?.includes(index) ?? false);
    });
  };

  if (!fromZero) return apply();
  for (const row of rows) row.style.setProperty('--share', '0%');
  requestAnimationFrame(() => requestAnimationFrame(apply));
}

export function voteSummary(poll) {
  if (!poll.multiple) return plural(poll.voters, 'vote');
  return `${poll.voters.toLocaleString()} ${poll.voters === 1 ? 'person' : 'people'} voted`;
}

export function timeLeft(poll, now = Date.now()) {
  return poll.closed ? 'Closed' : `${formatRemaining(poll.closesAt - now)} left`;
}
