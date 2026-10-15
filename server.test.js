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
});
