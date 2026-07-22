# AI Presentation Reviewer (MVP) — Project Invent - Codeday — GitHub Copilot edition

Upload a slide deck (.pptx or .pdf) → extract slide text → evaluate it against
a fixed rubric using **GitHub Copilot** → show a score + written feedback.
No login, no database, nothing persists between requests.

## Architecture

```
GitHub Pages (static site: frontend/)
      │  file upload (multipart/form-data)
      ▼
Node.js backend (server/)  — Express + Copilot SDK
   └─ POST /api/evaluate
        1. receive uploaded file
        2. extract slide text (pptx via JSZip+xml2js, pdf via pdf-parse)
        3. spin up a GitHub Copilot CLI session (via @github/copilot-sdk)
           and send the rubric prompt
        4. parse/validate the JSON response (retry once if malformed)
        5. return { scores, feedback } to the browser
```

### Why this isn't Cloudflare Workers / a stock serverless function

The original plan called for Cloudflare Workers or Vercel Functions, on the
assumption the AI call is a stateless HTTPS request (that's how the Claude
API and GitHub Models work). GitHub Copilot doesn't expose that today:

- The **GitHub Copilot SDK** (`@github/copilot-sdk`) works by spawning a
  local **Copilot CLI** process and talking to it over JSON-RPC. That needs
  a real Node process that's allowed to launch a subprocess — Workers can't
  do this at all, and it's an awkward fit for short-lived serverless
  functions (each cold start would need to boot the CLI binary).
- **GitHub Models** — the free, stateless `models.github.ai` chat-completions
  API that *would* have worked in a Worker — is being **fully retired by
  GitHub on July 30, 2026**, so it's not a safe foundation to build on right
  now.

So this MVP uses a small **always-on Node.js server** instead (Render,
Fly.io, Railway, or any VPS — anywhere that runs a persistent Node process).
GitHub Pages still serves the static frontend exactly as in the original plan.

### Auth for the Copilot call

Pick one:
- **GitHub Copilot subscription** (simplest): set `COPILOT_GITHUB_TOKEN` in
  the server's environment. It's passed to the SDK as its `gitHubToken` option.
  The account needs an active Copilot subscription (the free tier works but
  has a limited monthly request allowance — fine for an MVP demo, not for real
  traffic).
- **Logged-in user**: leave `COPILOT_GITHUB_TOKEN` blank and the SDK falls back
  to your machine's stored Copilot/`gh` auth (run `copilot` once to log in).

> Full **BYOK** (your own OpenAI/Anthropic/Azure key via a custom SDK provider)
> is _not_ wired into this MVP — it needs extra provider config. See the
> [BYOK docs](https://github.com/github/copilot-sdk/blob/main/docs/auth/byok.md)
> if you want to add it.

Every evaluation call counts against Copilot's usage allowance the same way
a Copilot CLI prompt does — worth knowing before pointing this at real
traffic (see [Copilot billing docs](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)).

## Local setup

```bash
cd server
cp .env.example .env        # fill in COPILOT_GITHUB_TOKEN or BYOK vars
npm install
npm start                   # listens on http://localhost:3000
```

Open `frontend/index.html` directly in a browser (or serve it with any
static server) — it's pre-wired to `http://localhost:3000`.

## Deploying

1. **Backend**: deploy `server/` to any host that runs a persistent Node
   process (Render, Fly.io, Railway, a small VPS). Set the same env vars
   from `.env.example` there. Set `ALLOWED_ORIGIN` to your GitHub Pages URL.
2. **Frontend**: push `frontend/` to a `gh-pages` branch (or enable GitHub
   Pages on a `/docs` or `/frontend` folder). Update `API_BASE_URL` in
   `frontend/app.js` to your deployed backend's URL first.

## Rubric

| Category | Points |
|---|---|
| Organization | 10 |
| Clarity | 10 |
| Content Quality | 10 |
| Professionalism | 10 |
| Overall Impression | 10 |

## Explicitly out of scope for MVP

Video upload/speech-to-text, multi-LLM comparison, accounts/login/history,
color-coded UI or PDF report export, Slack/Drive integrations — same as the
original plan.

## Known limitations of this swap

- Response times are slower than a typical API call — you're paying the
  cost of booting a CLI-backed session per request. For an MVP this is
  acceptable; for production, keep a long-lived `CopilotClient` warm and
  create a fresh session per request instead of restarting the whole client
  each time (see comment in `server/evaluate.js`).
- Copilot's exact structured-output behavior (how reliably it returns bare
  JSON vs. wrapping it in prose) is less proven than Claude's/OpenAI's
  `response_format` support, which is why `evaluate.js` strips code fences
  and retries once on malformed output.
- Model availability (`gpt-5` here) depends on what your Copilot plan
  exposes — check `client.listModels()` if you hit a "model not found" error.
