<p align="center">
  <img src="public/assets/favicon.svg" width="64" height="64" alt="QuickPoll logo">
</p>

<h1 align="center">QuickPoll</h1>

<p align="center">
  Make a poll in seconds, share the link, and watch the votes come in live.<br>
  No sign up. Free and open source.
</p>

<p align="center">
  <a href="https://quickpoll.essam.biz"><strong>quickpoll.essam.biz</strong></a>
</p>

---

## What it does

- **Fast to make.** Type a question and a few options. Paste a list and each line becomes an option.
- **Short links.** Every poll gets a one-word link like `quickpoll.essam.biz/maple`, or pick your own.
- **Live results.** Bars grow as votes arrive, with no refreshing.
- **One or many answers.** Single choice by default. Switch on multiple choice when you need it.
- **Closes on time.** Voting stays open for an hour, a day, a week or a month, with a live countdown.
- **Easy to share.** Copy the link, open the share sheet, send it on WhatsApp, or show a QR code.
- **You stay in control.** The browser that made a poll can close voting early or delete it.
- **Built for phones first.** Big tap targets, bottom sheets, light and dark mode, and full keyboard support (press A, B, C to pick).

## How voting works

Each browser gets a random id the first time it votes, and the server records one vote per id. That stops double taps and casual repeat votes, not someone who is determined to cheat. QuickPoll is made for quick questions between people, not elections.

Nothing personal is stored: no accounts and no names. IP addresses are only used for rate limits that reset within minutes. After voting closes, results stay up for 30 days, then the poll is deleted.

## Run it locally

You need Node.js 22 or newer.

```bash
git clone https://github.com/i3sam/QuickPoll.git
cd QuickPoll
npm install
npm run dev
```

Open http://localhost:3000. Polls are saved to `data/polls.json`.

Run the tests with `npm test`.

## Deploy to Vercel

1. Import this repo in Vercel. There is no build step.
2. In the project, go to **Storage** and connect an **Upstash Redis** database. Vercel adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` variables for you.
3. Redeploy, and add your domain under **Settings > Domains**.

Polls expire on their own in Redis, so there are no cleanup jobs to set up.

## Host it anywhere else

```bash
docker build -t quickpoll .
docker run -p 3000:3000 -v quickpoll-data:/app/data quickpoll
```

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `data` | Where polls are saved when Redis isn't set up |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy, so rate limits see real client IPs |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | | Use Redis instead of the local file |

## API

| Method | Path | |
| --- | --- | --- |
| `POST` | `/api/polls` | Create a poll. Returns the poll and an `adminKey` |
| `GET` | `/api/polls/:slug?voter=` | Read a poll and its results |
| `POST` | `/api/polls/:slug/votes` | Vote with `{ voter, choices }` |
| `POST` | `/api/polls/:slug/close` | Close voting (needs `Authorization: Bearer <adminKey>`) |
| `DELETE` | `/api/polls/:slug` | Delete a poll (same header) |
| `GET` | `/api/slugs/:slug` | Check if a custom link is free |
| `GET` | `/api/qr?data=` | QR code as SVG |

## Project layout

```
api/            Vercel function entry
server/         Routes, validation and storage (no framework)
  stores/       Local JSON file or Upstash Redis
public/         The site: plain HTML, CSS and JavaScript modules
test/           node:test suites
```

## License

MIT. Made by [essam.biz](https://essam.biz).
