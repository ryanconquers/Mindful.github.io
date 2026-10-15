# Mindful Check-in

A responsive web version of the Integrated Mental Health Screening Questionnaire.
The Node.js backend and optional Cloudflare Worker validate responses,
calculate provisional scale bands, and return transparent, rule-based supportive
guidance and answer summaries. Summaries describe response counts and
provisional questionnaire bands; they are not AI-generated. The services do not
persist responses or collect names, IDs, or contact details. This is not a
trained machine-learning model: the questionnaire has no validated training
data, and fabricating a predictive model would be inappropriate for a
mental-health screening tool.

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
   (a token with permission to edit Workers scripts) and
   `CLOUDFLARE_ACCOUNT_ID`. Never put these values in source files or share them
   in chat.
3. Push the project to the repository's `main` branch, then run the
   **Deploy assessment API** workflow from the Actions tab. Cloudflare's
   dashboard shows the deployed Worker URL.
4. Add a repository **Actions variable** named `API_BASE_URL` with that full
   Worker URL (no trailing slash), for example
   `https://mindful-checkin-api.<account>.workers.dev`.
5. In repository Settings → Pages, select **GitHub Actions** as the build and
   deployment source. Run the **Deploy GitHub Pages site** workflow.

The site workflow supports both root and repository-path Pages URLs. The Worker
accepts browser requests from GitHub Pages origins and returns no-store
responses. Both workflows are manual so the site is not published before its
API endpoint and deployment secrets have been configured. Check both Actions
workflows complete successfully before sharing the Pages URL. Deployment still
requires access to the GitHub repository and Cloudflare account; the repository
must be connected and its Actions secrets configured by its owner.

## Important use limitations

This is a screening and demonstration tool, not a diagnostic or treatment
service. The questionnaire is a new composite, its scoring bands are
provisional, and the draft unusual-experience and personality items are not
validated. The supportive guidance is generated from explicit score and safety
rules; it does not infer diagnoses or replace a clinician. Have the wording,
scoring, privacy practices, and referral resources reviewed by qualified mental
health professionals before any real-world use.

Responses are sent to the backend only to calculate results, are not logged or
saved by this application, and are cleared when the page is closed or reset.
The local app is configured to listen on localhost by default. If deployed, use
HTTPS, review the hosting provider's logs and data policies, and configure
appropriate local emergency resources. The safety message includes India's
Tele-MANAS helpline (14416 / 1-800-891-4416).
