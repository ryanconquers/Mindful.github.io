# Mindful Check-in

A responsive web version of the Integrated Mental Health Screening Questionnaire.
The Node.js backend and optional Cloudflare Worker validate responses,
calculate provisional scale bands, and return transparent, rule-based supportive
guidance and answer summaries. Respondents may optionally opt in to a brief
AI-written reflection generated with Cloudflare Workers AI. The model receives
only aggregate Mood, Anxiety, and Stress scores/counts—not raw answers,
safety/unusual-experience/personality responses, or identifiers. AI text may be
inaccurate and is not clinical advice; the AI step is skipped for safety-trigger
responses. Without opt-in, only rule-based summaries are returned. Respondents
may separately consent to save their anonymous individual answers and scores to
Cloudflare D1 for the site operator's private analysis dashboard. This consent
is optional; data is retained until manually deleted. Names and contact details
are not collected.

## Run locally

Requires Node.js 20 or newer. No third-party packages are required.

```sh
npm start
```

Open <http://127.0.0.1:3000>. Run the tests with `npm test`.

## Free public deployment

The site can be hosted on GitHub Pages (`https://<username>.github.io`) and the
API on Cloudflare Workers (`https://mindful-checkin-api.<account>.workers.dev`).
GitHub Pages alone cannot run the backend. A public repository is required for
GitHub Pages on GitHub Free.

1. Create a GitHub repository for this project. For the shortest URL,
   name it `<username>.github.io`; other repository names use
   `https://<username>.github.io/<repository>/`.
2. Add these repository **Actions secrets**: `CLOUDFLARE_API_TOKEN`
   (a token with permission to edit Workers scripts and D1 databases) and
   `CLOUDFLARE_ACCOUNT_ID`. Never put these values in source files or share them
   in chat.
3. In Cloudflare, create a D1 database named `mindful-checkin-data`. Add its ID
   as the repository **Actions variable** `CLOUDFLARE_D1_DATABASE_ID`.
4. Set a strong, unique password of at least 20 ASCII characters as the Worker
   secret `ADMIN_PASSWORD` in Cloudflare's Worker settings. Do not put the
   password in GitHub Pages, source files, or chat.
5. Push the project to the repository's `main` branch, then run the
   **Deploy assessment API** workflow from the Actions tab. Once configured, it
   also deploys automatically when API files change on `main`. Cloudflare's
   dashboard shows the deployed Worker URL.
6. The Pages workflow is configured with this project's deployed Worker URL.
   If you deploy a different Worker, set a repository **Actions variable**
   named `API_BASE_URL` to its full URL (no trailing slash).
7. In repository Settings → Pages, select **GitHub Actions** as the build and
   deployment source. The **Deploy GitHub Pages site** workflow runs on site
   changes to `main`; it can also be run manually from Actions.
8. Share the questionnaire URL. The optional **Administrator dashboard** link
   is at the bottom of the page; sign in with username `admin` and the Worker
   password. The dashboard shows band counts, individual consented submissions,
   a JSON export, and a delete-all control.

The site workflow supports both root and repository-path Pages URLs. The Worker
accepts browser requests from GitHub Pages origins and returns no-store
responses. Both workflows can be run manually and deploy automatically on
relevant `main` changes. Check both Actions workflows complete successfully
before sharing the Pages URL. Deployment still requires access to the GitHub
repository and Cloudflare account; the repository must be connected and its
Actions secrets configured by its owner.

## Important use limitations

This is a screening and demonstration tool, not a diagnostic or treatment
service. The questionnaire is a new composite, its scoring bands are
provisional, and the draft unusual-experience and personality items are not
validated. Rule-based supportive guidance is generated from explicit score and
safety rules. The optional AI reflection is constrained to aggregate scores and
counts, but language models can still be wrong; it does not diagnose or replace
a clinician. Have the wording, scoring, AI behavior, privacy practices, and
referral resources reviewed by qualified mental health professionals before
any real-world use. Workers AI usage may be subject to Cloudflare plan limits
or charges.

Without storage consent, responses are sent only to calculate results and are
not saved by this application. With storage consent, answer records and scores
are retained in the operator's Cloudflare D1 database until manually deleted.
The private dashboard displays sensitive responses; protect its password and
limit access. Review Cloudflare's data policies and logs before collecting real
responses. Local development does not persist consented submissions. Configure
appropriate local emergency resources; the safety message includes India's
Tele-MANAS helpline (14416 / 1-800-891-4416).
