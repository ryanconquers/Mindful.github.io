# Mindful Check-in

Mindful Check-in is a responsive website for the **Integrated Mental Health
Screening Questionnaire**. A respondent can answer 25 questions, see provisional
section scores and supportive guidance, and optionally request an AI-written
reflection. Adults who explicitly consent may also save an anonymous response
for the site operator's research dashboard.

> **Important:** This is a demonstration and research-support project, not a
> diagnostic or treatment service. The questionnaire is a new composite; its
> scoring bands are provisional and its draft unusual-experience and personality
> items have not been validated. Results must not be presented as diagnoses or
> as the number of people who clinically “have” a condition.

## Live project

- **Questionnaire:** <https://ryanconquers.github.io/Mindful.github.io/>
- **Private operator dashboard:** <https://ryanconquers.github.io/Mindful.github.io/admin.html>
- **Source repository:** <https://github.com/ryanconquers/Mindful.github.io>

The dashboard requires the username `admin` and the password configured as the
Cloudflare Worker secret `ADMIN_PASSWORD`. Do not publish or share the password.

## Technology stack

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Respondent frontend | HTML5, CSS3, vanilla JavaScript | Responsive questionnaire, accessible controls, consent choices, progress indicator, and rendering results |
| Static website hosting | GitHub Pages | Publishes the questionnaire and private dashboard as static files over HTTPS |
| Local web server | Node.js 20+, built-in HTTP and file-stream APIs | Serves the same frontend locally and provides a development assessment endpoint |
| Production API | Cloudflare Workers, JavaScript ES modules | Validates requests, computes scores, applies safety rules, optionally invokes AI, writes consented records, and serves protected admin API routes |
| Database | Cloudflare D1 (SQLite-compatible) | Stores individual submissions only when respondents opt in |
| Optional generative AI | Cloudflare Workers AI, `@cf/google/gemma-4-26b-a4b-it` | Writes a short reflection from aggregate Mood, Anxiety, and Stress scores/counts only |
| Deployment | GitHub Actions, Wrangler | Publishes the static site and deploys the Worker and D1 migrations |
| Tests | Node.js built-in test runner (`node:test`) | Tests scoring, validation, consented storage, dashboard authorization, and AI input boundaries |

There are no npm runtime dependencies. The frontend is not React-based, and the
backend does not use Express. The AI reflection is generative AI, not a
diagnostic machine-learning classifier trained on participant records.

## Architecture and request flow

```text
Respondent's browser
  ├── GitHub Pages: index.html, styles.css, app.js
  └── HTTPS POST /api/assessment
        └── Cloudflare Worker
              ├── assessment.js: validation, scoring, rules, summaries
              ├── optional Workers AI: aggregate core-scale facts only
              └── optional D1 INSERT: only after explicit storage consent

Operator's browser
  └── GitHub Pages: admin.html, admin.js
        └── HTTPS /api/admin/* + dashboard password
              └── Cloudflare Worker → D1 summary, submissions, export, delete
```

1. The browser renders the questionnaire and gathers 25 values from `0` to `3`.
   Names and contact details are not requested.
2. On submission, the browser sends the answers, optional AI preference, and
   separate optional storage consent to the API.
3. The API validates that every item is an integer from `0` to `3`, calculates
   scores, and returns the result with `Cache-Control: no-store`.
4. If storage consent is absent, the Worker does not insert a record. If
   selected, it validates the participant's stated age/storage consent and
   inserts the answers and results into D1.
5. If AI consent is selected and no safety trigger is active, the Worker sends
   the AI provider aggregate facts for Mood, Anxiety, and Stress. Raw answers
   and safety, unusual-experience, and personality responses are not sent to the
   model. The AI response is optional and may be unavailable.
6. The operator dashboard authenticates each admin API request and can show
   aggregate band counts, inspect the latest 500 saved submissions, download
   those submissions as JSON, or delete all saved records.

The questionnaire remains usable without either consent. AI consent and
response-storage consent are independent and both unchecked by default.

## Questionnaire and scoring

| Section | Items | Maximum | Provisional bands (Low / Mild / Moderate / High) |
| --- | --- | ---: | --- |
| Mood | 1–7 | 21 | 0–5 / 6–10 / 11–15 / 16–21 |
| Anxiety | 8–13 | 18 | 0–4 / 5–8 / 9–13 / 14–18 |
| Stress | 14–17 | 12 | 0–2 / 3–5 / 6–8 / 9–12 |
| Unusual experiences | 19–21 | 9 | 0–2 / 3–4 / 5–6 / 7–9 |
| Personality tendencies | 22–24 | 9 | 0–2 / 3–4 / 5–6 / 7–9 |

The Worker adds item values within each section. The band cutoffs are percentage
bands of the scale maximum: under 25% is Low, 25–49% Mild, 50–74% Moderate,
and 75% or more High. These are implementation cutoffs supplied with the draft
questionnaire; they are **not validated clinical cutoffs**.

Item 18 is a separate safety flag; it is not included in a scale score. Item 25
is a separate functioning indicator. Personality results are descriptive only,
not a severity rating or clinical label.

### Safety and referral rules

- Item 18 above zero, or item 5 or 7 equal to 3: show a supportive safety
  message before results; the AI reflection is skipped.
- Item 19 or 20 equal to 2 or 3: recommend discussing the experience with a
  qualified professional.
- Moderate or High provisional Mood, Anxiety, or Stress band: recommend
  considering professional support.
- Item 25 equal to 2 or 3: show the functioning indicator and recommend
  support.
- Every result states that screening is not diagnosis. The safety screen
  includes India's Tele-MANAS contact, 14416 / 1-800-891-4416. Deployments
  serving other regions should review and add suitable local resources.

## Privacy, consent, and storage

- **No storage consent:** answers are sent to the backend to calculate results,
  but are not inserted into the application's D1 database.
- **Storage consent:** an adult respondent explicitly agrees to save anonymous
  item responses, scores, support flags, and submission timestamp for research.
  No name or contact field is stored. The dashboard records the consent text
  and consent version with the submission.
- **Retention:** stored rows have no automatic expiry. The operator must
  periodically review, export if appropriate, and delete data when no longer
  needed. The dashboard's delete-all action permanently removes all submission
  rows.
- **AI consent:** checked separately. If selected, only aggregate Mood, Anxiety,
  and Stress facts go to Workers AI; this request is not sent if the safety rule
  is triggered. Review Cloudflare's current service/data terms before collecting
  real responses; the application cannot promise the provider retains no
  request metadata.
- **Hosting operations:** GitHub, Cloudflare, browsers, and network providers
  may process operational metadata under their own terms. “Anonymous” means
  this app does not ask for or store direct identity fields; it is not a
  guarantee that data can never be linked to a person.
- **Access:** the dashboard is not made private by its obscure URL or
  `noindex` tag. Its API routes require the Worker password. Keep that password
  secret, use a long unique value, and only share it with authorized operators.

Collecting mental-health data from real participants requires appropriate
institutional/ethics approval, informed-consent language, privacy and retention
policies, professional review, and compliance with applicable laws and
Cloudflare/GitHub service terms. The “18+” statement is a product safeguard, not
a substitute for legal or research-ethics review.

## Project structure

```text
.
├── index.html                       # Public questionnaire page
├── styles.css                       # Shared responsive styles
├── app.js                           # Questionnaire UI and results rendering
├── assessment.js                    # Shared validation, scores, bands, guidance
├── server.js                        # Local Node.js development server/API
├── worker.js                        # Production Worker API, AI, D1, admin auth
├── admin.html                       # Operator dashboard sign-in and layout
├── admin.js                         # Dashboard, exports, and deletion UI
├── api-config.js                    # Local API base URL; deployment generates it
├── wrangler.toml                    # Worker, Workers AI, and D1 bindings
├── migrations/
│   ├── 0001_create_submissions.sql   # Initial D1 table and index
│   └── 0002_add_research_consent.sql # Consent record column
├── .github/workflows/
│   ├── deploy-site.yml               # GitHub Pages build/deployment
│   └── deploy-api.yml                # Worker deployment and D1 migrations
└── server.test.js                   # Unit and API integration tests
```

## API overview

All production API routes are served by the Cloudflare Worker:

| Method and path | Purpose | Access |
| --- | --- | --- |
| `POST /api/assessment` | Validate answers, calculate results, optionally request AI and/or save | Public; storage separately requires participant consent |
| `GET /api/admin/summary` | Total submissions, band counts, and support-trigger counts | Dashboard password |
| `GET /api/admin/submissions?limit=500` | Retrieve saved individual submissions (limit capped at 5,000) | Dashboard password |
| `DELETE /api/admin/submissions` | Delete every saved submission; requires body `{"confirm":"DELETE ALL"}` | Dashboard password |

The dashboard sends HTTP Basic authentication with username `admin` and the
password held as the Worker secret `ADMIN_PASSWORD`. The API validates it on
each admin request; the password is not stored in the static website or
browser local storage.

## Run locally

Requires Node.js 20 or newer; no package installation is needed.

```sh
npm start
```

Open <http://127.0.0.1:3000>. Run the test suite:

```sh
npm test
```

The local Node server calculates scores, but it does not connect to the
production D1 database or Cloudflare Workers AI. A local request attempting to
save a response receives an explicit error rather than silently pretending it
was stored.

## Deployment

Production hosting is split because GitHub Pages serves static files and cannot
run a Node backend:

- GitHub Pages: <https://ryanconquers.github.io/Mindful.github.io/>
- Cloudflare Worker API: `https://mindful-checkin-api.<account>.workers.dev`
- Cloudflare D1 database: `mindful-checkin-data`

The current GitHub Actions workflows deploy on relevant changes to `main`. The
API workflow binds the D1 ID from the repository variable and applies pending
SQL migrations before completing deployment.

Required configuration (never put secret values in Git or chat):

| Location | Name | Purpose |
| --- | --- | --- |
| GitHub Actions secret | `CLOUDFLARE_API_TOKEN` | Deploy Worker and apply D1 migrations; must have appropriate Workers and D1 permissions |
| GitHub Actions secret | `CLOUDFLARE_ACCOUNT_ID` | Selects the Cloudflare account |
| GitHub Actions variable | `CLOUDFLARE_D1_DATABASE_ID` | Selects the D1 database |
| Cloudflare Worker secret | `ADMIN_PASSWORD` | Dashboard password; unique and at least 20 characters |
| Optional GitHub Actions variable | `API_BASE_URL` | Overrides the default Worker URL when deploying elsewhere |

## Viva / project presentation notes

### Short project explanation

> “Mindful Check-in is a responsive mental-wellness questionnaire and research
> demonstration. The frontend is plain HTML, CSS, and JavaScript hosted on
> GitHub Pages. A Cloudflare Worker validates answers and calculates transparent
> provisional scores. With separate explicit consent, anonymous answers may be
> stored in Cloudflare D1 and reviewed in a password-protected dashboard. A
> separate optional Workers AI feature generates a short reflection from
> aggregate core-scale scores only. This is not a diagnostic tool, and the
> instrument and cutoffs need validation before clinical or research use.”

### Common viva questions

**Why did you choose this stack?**

Vanilla HTML/CSS/JavaScript keeps the static frontend lightweight and works well
on GitHub Pages. A Cloudflare Worker supplies server-side validation and
production API routes without maintaining a traditional server. D1 provides
SQLite-compatible relational storage for consented submissions. GitHub Actions
automates deployments.

**Why does the project have both `server.js` and `worker.js`?**

`server.js` is a small local development server using Node's built-in modules.
`worker.js` is the production Cloudflare runtime and supports Cloudflare
bindings such as D1 and Workers AI. Both use `assessment.js` so the core scoring
rules are shared. The local server intentionally cannot claim to persist data
when D1 is unavailable.

**What does the backend do?**

It checks that all 25 answers exist and each is an integer from 0 to 3; sums
items into their configured scales; assigns the supplied provisional bands;
applies safety/referral rules; optionally calls AI or stores a submission after
separate consent; and serves authenticated dashboard queries.

**How are the scores calculated?**

Each scale is the sum of its item values. The Worker compares the resulting
fraction of the scale maximum against 25%, 50%, and 75% boundaries. Item 18 and
item 25 are reported separately. The exact cutoffs are specified in the
questionnaire, but have not been clinically validated for this new composite.

**Is this a machine-learning diagnostic model?**

No. The scores and standard summaries are deterministic rules. The optional
Gemma language model writes a short reflection from aggregate Mood, Anxiety,
and Stress totals/counts after opt-in. It is not trained or fine-tuned on
participant data, does not diagnose, and is skipped for a safety trigger.

**How is participant privacy handled?**

Names and contact details are not collected. Storage and AI are separate,
unchecked-by-default choices. A submission is inserted only after storage
consent, including an 18+ confirmation. AI receives only three aggregate scale
summaries. Saved individual responses are sensitive, so only authorized
operators should access the password-protected dashboard.

**How is the dashboard protected?**

Static HTML alone is not secret, so the Worker also protects every admin API
route. It checks HTTP Basic credentials against the server-side Worker secret
using a constant-time comparison for equal-length values. The password is never
embedded in the static frontend.

**What would you improve before a real study?**

Obtain ethics and professional review; validate question wording and scale
properties against established full instruments; predefine retention and access
policies; add a fixed retention/deletion schedule and stronger managed
authentication/MFA; add abuse controls and operational monitoring; evaluate AI
output with human review or disable it; and verify regional crisis resources,
legal obligations, and provider data policies.

**How is it tested?**

`node:test` exercises band calculation, support flags, invalid requests, Worker
CORS, consented/declined storage, dashboard authentication, AI input boundaries,
and the local HTTP API. The deployed consent and dashboard flow should also be
retested after infrastructure or policy changes.

## Limitations and responsible use

The composite questionnaire is not a validated instrument. Published PHQ-9,
GAD-7, or DASS-21 reliability statistics and clinical thresholds cannot simply
be transferred to selected or reworded items. Items 19–24 are draft items;
personality tendencies are not a clinical label. The website supports
reflection and prototyping only. Qualified mental-health and research
professionals should review it before use with participants.
