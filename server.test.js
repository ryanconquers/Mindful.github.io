import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { calculateAssessment, createAppServer } from "./server.js";
import worker from "./worker.js";

function answersWith(value = 0) {
  return Object.fromEntries(
    Array.from({ length: 25 }, (_, index) => [index + 1, value]),
  );
}

test("calculates scale totals, provisional bands, and descriptive tendencies", () => {
  const answers = answersWith(0);
  for (const item of [1, 2, 3, 4, 5, 6, 7]) answers[item] = 2;
  for (const item of [8, 9, 10, 11, 12, 13]) answers[item] = 2;
  const result = calculateAssessment(answers);
  assert.deepEqual(
    result.scores.slice(0, 2).map(({ score, band }) => ({ score, band })),
    [
      { score: 14, band: "Moderate" },
      { score: 12, band: "Moderate" },
    ],
  );
  assert.equal(result.scores[4].band, "Low");
  assert.match(result.scores[0].summary, /7 of 7 statements/);
  assert.match(result.scores[4].summary, /not a validated personality measure/);
  assert.equal(result.safetySupport, false);
  assert.equal(result.clinicianRecommendation, true);
  assert.match(result.guidance[0], /qualified mental health professional/);
});

test("sets safety, unusual-experience, and functioning referral flags", () => {
  const answers = answersWith(0);
  answers[18] = 1;
  answers[19] = 2;
  answers[25] = 3;
  const result = calculateAssessment(answers);
  assert.equal(result.safetySupport, true);
  assert.equal(result.unusualExperienceReferral, true);
  assert.equal(result.functioningSupport, true);
  assert.equal(result.clinicianRecommendation, true);
  assert.match(result.guidance[0], /immediate safety matters most/);
});

test("Worker API calculates results for GitHub Pages and rejects unknown origins", async () => {
  const request = new Request("https://api.example.workers.dev/api/assessment", {
    method: "POST",
    headers: {
      Origin: "https://example.github.io",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ answers: answersWith() }),
  });
  const response = await worker.fetch(request);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://example.github.io",
  );
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).guidance.length, 1);

  const rejected = await worker.fetch(
    new Request("https://api.example.workers.dev/api/assessment", {
      method: "POST",
      headers: {
        Origin: "https://untrusted.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ answers: answersWith() }),
    }),
  );
  assert.equal(rejected.status, 403);
});

test("Worker AI summary uses only consented aggregate core-scale facts", async () => {
  let model;
  let input;
  const answers = answersWith(1);
  answers[18] = 0;
  const response = await worker.fetch(
    new Request("https://api.example.workers.dev/api/assessment", {
      method: "POST",
      headers: {
        Origin: "https://example.github.io",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        answers,
        aiSummary: true,
      }),
    }),
    {
      AI: {
        async run(selectedModel, parameters) {
          model = selectedModel;
          input = parameters;
          return {
            choices: [
              { message: { content: "A neutral reflection, not a diagnosis." } },
            ],
          };
        },
      },
    },
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.aiSummaryStatus, "available");
  assert.equal(result.aiSummary, "A neutral reflection, not a diagnosis.");
  assert.equal(model, "@cf/google/gemma-4-26b-a4b-it");
  const promptData = JSON.parse(input.messages[1].content);
  assert.deepEqual(
    promptData.sectionSummaries.map(({ section }) => section),
    ["Mood", "Anxiety", "Stress"],
  );
  assert.equal(JSON.stringify(promptData).includes('"18"'), false);
  assert.equal(input.max_completion_tokens, 256);
  assert.deepEqual(input.chat_template_kwargs, { enable_thinking: false });
});

test("Worker skips AI when the safety rule is triggered", async () => {
  let invoked = false;
  const answers = answersWith(0);
  answers[18] = 1;
  const response = await worker.fetch(
    new Request("https://api.example.workers.dev/api/assessment", {
      method: "POST",
      headers: {
        Origin: "https://example.github.io",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ answers, aiSummary: true }),
    }),
    {
      AI: {
        async run() {
          invoked = true;
          return { response: "Summary" };
        },
      },
    },
  );
  const result = await response.json();
  assert.equal(result.safetySupport, true);
  assert.equal(result.aiSummaryStatus, "skipped-safety");
  assert.equal(invoked, false);
});

test("Worker saves only after explicit consent and protects admin records", async () => {
  const inserted = [];
  const database = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              inserted.push({ sql, values });
              return { meta: { last_row_id: 42 } };
            },
            async all() {
              return { results: [] };
            },
          };
        },
        async first() {
          return {
            total: 0,
            mood_moderate_high: 0,
            anxiety_moderate_high: 0,
            stress_moderate_high: 0,
            experiences_moderate_high: 0,
            personality_moderate_high: 0,
            safety_support_count: 0,
            functioning_support_count: 0,
          };
        },
        async all() {
          return { results: [] };
        },
      };
    },
  };
  const answers = answersWith(0);
  answers[18] = 1;
  const notSavedResponse = await worker.fetch(
    new Request("https://api.example.workers.dev/api/assessment", {
      method: "POST",
      headers: {
        Origin: "https://example.github.io",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ answers, consentToStore: false }),
    }),
    { DB: database },
  );
  assert.equal((await notSavedResponse.json()).saved, false);
  assert.equal(inserted.length, 0);

  const savedResponse = await worker.fetch(
    new Request("https://api.example.workers.dev/api/assessment", {
      method: "POST",
      headers: {
        Origin: "https://example.github.io",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        answers,
        consentToStore: true,
        researchConsent:
          "I confirm I am 18 or older and consent to research storage.",
      }),
    }),
    { DB: database },
  );
  const saved = await savedResponse.json();
  assert.equal(savedResponse.status, 200);
  assert.equal(saved.saved, true);
  assert.equal(saved.submissionId, 42);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].values[1], "research-consent-v3");
  assert.equal(
    inserted[0].values[2],
    "I confirm I am 18 or older and consent to research storage.",
  );
  assert.deepEqual(JSON.parse(inserted[0].values[3]), answers);
  assert.equal(inserted[0].values[16], 1);

  const authorization = `Basic ${btoa("admin:correct horse battery staple 2468")}`;
  const withoutPassword = await worker.fetch(
    new Request("https://api.example.workers.dev/api/admin/summary", {
      headers: { Origin: "https://example.github.io" },
    }),
    { DB: database, ADMIN_PASSWORD: "correct horse battery staple 2468" },
  );
  assert.equal(withoutPassword.status, 401);

  const withPassword = await worker.fetch(
    new Request("https://api.example.workers.dev/api/admin/summary", {
      headers: {
        Origin: "https://example.github.io",
        Authorization: authorization,
      },
    }),
    { DB: database, ADMIN_PASSWORD: "correct horse battery staple 2468" },
  );
  assert.equal(withPassword.status, 200);
  assert.equal((await withPassword.json()).summary.total, 0);
});

test("Worker refuses consented storage if the database is not configured", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.workers.dev/api/assessment", {
      method: "POST",
      headers: {
        Origin: "https://example.github.io",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        answers: answersWith(0),
        consentToStore: true,
        researchConsent:
          "I confirm I am 18 or older and consent to research storage.",
      }),
    }),
    {},
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /were not saved/);
});

test("serves the site and validates assessment submissions", async (context) => {
  const server = createAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Mindful Check-in/);

  const invalid = await fetch(`${baseUrl}/api/assessment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: { 1: 4 } }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /all 25 items/);

  const valid = await fetch(`${baseUrl}/api/assessment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: answersWith() }),
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get("cache-control"), "no-store");
  const result = await valid.json();
  assert.equal(result.scores.length, 5);
  assert.match(result.scores[0].summary, /did not mark any/);

  const storageRequest = await fetch(`${baseUrl}/api/assessment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      answers: answersWith(),
      consentToStore: true,
    }),
  });
  assert.equal(storageRequest.status, 503);
  assert.match((await storageRequest.json()).error, /were not saved/);

  const adminPage = await fetch(`${baseUrl}/admin`);
  assert.equal(adminPage.status, 200);
  assert.match(await adminPage.text(), /Administrator sign in/);
});
