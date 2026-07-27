# AI Presentation Reviewer (MVP) — Project Invent - Codeday — Vercel + Groq edition

Upload a slide deck (.pptx or .pdf) → extract slide text → evaluate it against
a quality rubric **and** Project Invent's official Demo Day pitch criteria,
using **Groq** → show scores, a compliance checklist, and written feedback.
No login, no database, nothing persists between requests.

## Architecture

```
GitHub Pages (static site: frontend/)
      │  file upload (multipart/form-data)
      ▼
Vercel serverless function (server/) — Express
   └─ POST /api/evaluate
        1. receive uploaded file
        2. extract slide text (pptx via JSZip+xml2js, pdf via pdf-parse)
        3. send the rubric + compliance prompt to Groq's chat-completions API
           (plain HTTPS request)
        4. parse/validate the JSON response (retry once if malformed;
           don't retry on 429 rate limits)
        5. return { scores, feedback, compliance, slide_count } to the browser
```

## Auth for the Groq call

Set `GROQ_API_KEY` in Vercel's environment variables (get one free at
[console.groq.com/keys](https://console.groq.com/keys) — no card required).
Optionally set `GROQ_MODEL` (defaults to `llama-3.3-70b-versatile`).

## Local setup

```bash
cd server
cp .env.example .env        # fill in GROQ_API_KEY
npm install
npm start                   # listens on http://localhost:3000
```

Open `frontend/index.html` directly in a browser (or serve it with any
static server) — it auto-detects `localhost` and points at your local
server instead of the deployed one.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | Yes | From console.groq.com/keys |
| `GROQ_MODEL` | No | Defaults to `llama-3.3-70b-versatile` |
| `ALLOWED_ORIGIN` | Yes (prod) | Your GitHub Pages origin, e.g. `https://yourname.github.io` — no trailing slash, no path |
| `PORT` | No | Vercel sets its own automatically |

## Deploying

### Backend — Vercel (free / Hobby tier)

1. New Project on [vercel.com](https://vercel.com) → import this GitHub repo
2. **Root Directory**: `presentation-reviewer/server`
3. **Framework Preset**: Other
4. **Build Command** / **Output Directory**: leave default/blank — it's a
   plain Node/Express app, nothing to build
5. Add the environment variables above (Production + Preview)
6. Deploy

**Known limit**: Vercel's free tier enforces a **hard 4.5MB request body
cap** on serverless functions — this cannot be raised without a paid plan.
Uploads larger than that fail with a `413`. Keep decks under ~4MB to be
safe, or trim/compress before uploading.

### Frontend — GitHub Pages

1. Push `frontend/` to your repo
2. Repo → **Settings → Pages** → set the source to the branch/folder
   containing `frontend/` (e.g. `main` branch, `/presentation-reviewer/frontend`
   or a dedicated `gh-pages` branch, depending on your repo layout)
3. Update `API_URL` in `frontend/app.js` to your deployed Vercel URL
   (e.g. `https://your-project.vercel.app`)
4. Push — GitHub Pages rebuilds automatically within about a minute

**CORS note**: `ALLOWED_ORIGIN` on Vercel must exactly match your GitHub
Pages origin (scheme + domain only, e.g. `https://yourname.github.io` —
no trailing slash, no path after it) or uploads will fail with a CORS error
in the browser console.

## Rubric

Two separate things get evaluated:

### 1. Quality rubric (0–10 each)

| Category | Points |
|---|---|
| Organization | 10 |
| Clarity | 10 |
| Content Quality | 10 |
| Professionalism | 10 |
| Overall Impression | 10 |

### 2. Pitch criteria checklist (pass/fail)

Based on Project Invent's official Demo Day requirements — every deck should
include these 8 elements. The AI flags each as present or missing, with a
one-sentence note:

- Team Name (team name, first names + last initials, team photo)
- Problem (community partner + problem being solved)
- Solution (with a quote on why it's desirable to the partner)
- Demo (brief section on the physical product and how it works)
- Product Features (inputs/outputs of the invention)
- User Testing (partner quotes, what was learned, pivots)
- Competitor Matrix (similar products + differentiation)
- Next Steps (what's next to develop the product)

## Branding

Uses Project Invent's official brand palette (Quartz, Perano, Wild Blue
Yonder, Deep Koamaru, Lucky Point, Salmon, Macaroni and Cheese, Slate Gray,
Solitude) and Open Sans typography, in both light and dark mode.

## Explicitly out of scope for MVP

Video upload/speech-to-text, multi-LLM comparison, accounts/login/history,
Slack/Drive integrations.

## Known limitations

- **4.5MB upload cap** (Vercel free tier hard limit — see above).
- Groq's free tier has per-minute rate limits — rapid repeated testing can
  trip a 429; the code doesn't retry on 429 (no point burning quota on a
  guaranteed second failure).
- Compliance-checklist accuracy depends on the model reading slide text
  correctly; it can't evaluate image-only slides or embedded video content,
  since only extracted text is sent to the model.