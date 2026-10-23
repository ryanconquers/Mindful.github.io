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

function createSessionDatabase() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return { id: 7, email: "participant@example.com" };
            },
          };
        },
      };
    },
  };
}

function createAccountDatabase() {
  const accounts = [];
  const tokens = [];
  const sessions = [];
  const submissions = [];
  let nextAccountId = 1;
  let nextTokenId = 1;

  function prepare(sql) {
    let values = [];
    const statement = {
      bind(...boundValues) {
        values = boundValues;
        return statement;
      },
      async first() {
        const query = sql.replace(/\s+/g, " ").trim();
        if (query.includes("FROM accounts WHERE email = ?")) {
          const account = accounts.find(
            (candidate) => candidate.email === values[0],
          );
          return account ? { ...account } : null;
        }
        if (query.includes("FROM account_tokens")) {
          return (
            tokens.find(
              (token) =>
                token.token_hash === values[0] &&
                token.purpose === (query.includes("purpose = 'verify'") ? "verify" : "reset") &&
                token.expires_at > values[1],
            ) ?? null
          );
        }
        if (query.includes("FROM account_sessions")) {
          const session = sessions.find(
            (candidate) =>
              candidate.token_hash === values[0] &&
              candidate.expires_at > values[1],
          );
          const account = accounts.find(
            (candidate) => candidate.id === session?.account_id,
          );
          return account?.email_verified ? { id: account.id, email: account.email } : null;
        }
        throw new Error(`Unexpected first() query: ${query}`);
      },
      async run() {
        const query = sql.replace(/\s+/g, " ").trim();
        if (query.startsWith("INSERT INTO accounts")) {
          const [email, password_salt, password_hash, created_at] = values;
          const account = {
            id: nextAccountId++,
            email,
            password_salt,
            password_hash,
            created_at,
            email_verified: 0,
          };
          accounts.push(account);
          return { meta: { last_row_id: account.id } };
        }
        if (query.startsWith("UPDATE accounts SET password_salt")) {
          const account = accounts.find((candidate) => candidate.id === values[2]);
          Object.assign(account, { password_salt: values[0], password_hash: values[1] });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("UPDATE accounts SET email_verified")) {
          const account = accounts.find((candidate) => candidate.id === values[0]);
          account.email_verified = 1;
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("DELETE FROM account_tokens WHERE account_id")) {
          const [accountId, purpose] = values;
          for (let index = tokens.length - 1; index >= 0; index -= 1) {
            if (tokens[index].account_id === accountId && tokens[index].purpose === purpose) {
              tokens.splice(index, 1);
            }
          }
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("INSERT INTO account_tokens")) {
          const [account_id, purpose, token_hash, expires_at] = values;
          tokens.push({ id: nextTokenId++, account_id, purpose, token_hash, expires_at });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("DELETE FROM account_tokens WHERE id")) {
          const index = tokens.findIndex((token) => token.id === values[0]);
          if (index >= 0) tokens.splice(index, 1);
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("INSERT INTO account_sessions")) {
          const [account_id, token_hash, expires_at, created_at] = values;
          sessions.push({ account_id, token_hash, expires_at, created_at });
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("DELETE FROM account_sessions WHERE account_id")) {
          for (let index = sessions.length - 1; index >= 0; index -= 1) {
            if (sessions[index].account_id === values[0]) sessions.splice(index, 1);
          }
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("DELETE FROM account_sessions WHERE token_hash")) {
          const index = sessions.findIndex((session) => session.token_hash === values[0]);
          if (index >= 0) sessions.splice(index, 1);
          return { meta: { changes: 1 } };
        }
        if (query.startsWith("INSERT INTO submissions")) {
          submissions.push({ sql: query, values });
          return { meta: { last_row_id: submissions.length } };
        }
        throw new Error(`Unexpected run() query: ${query}`);
      },
    };
    return statement;
  }

  return {
    accounts,
    sessions,
    submissions,
    prepare,
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
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
  assert.equal(response.status, 401);

  const authenticatedResponse = await worker.fetch(
    new Request("https://api.example.workers.dev/api/assessment", {
      method: "POST",
      headers: {
        Origin: "https://example.github.io",
        "Content-Type": "application/json",
        Authorization: "Bearer valid-session",
      },
      body: JSON.stringify({ answers: answersWith() }),
    }),
    { DB: createSessionDatabase() },
  );
  assert.equal(authenticatedResponse.status, 200);
  assert.equal(
    authenticatedResponse.headers.get("Access-Control-Allow-Origin"),
    "https://example.github.io",
  );
  assert.equal(authenticatedResponse.headers.get("Cache-Control"), "no-store");
  assert.equal((await authenticatedResponse.json()).guidance.length, 1);

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
        Authorization: "Bearer valid-session",
      },
      body: JSON.stringify({
        answers,
        aiSummary: true,
      }),
    }),
    {
      DB: createSessionDatabase(),
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
        Authorization: "Bearer valid-session",
      },
      body: JSON.stringify({ answers, aiSummary: true }),
    }),
    {
      DB: createSessionDatabase(),
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
            async first() {
              return { id: 42, email: "participant@example.com" };
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
        Authorization: "Bearer valid-session",
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
        Authorization: "Bearer valid-session",
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
  assert.equal(inserted[0].values[1], "research-consent-v4");
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

  const accountList = await worker.fetch(
    new Request("https://api.example.workers.dev/api/admin/accounts", {
      headers: {
        Origin: "https://example.github.io",
        Authorization: authorization,
      },
    }),
    { DB: database, ADMIN_PASSWORD: "correct horse battery staple 2468" },
  );
  assert.equal(accountList.status, 200);
  assert.deepEqual((await accountList.json()).accounts, []);
});

test("Worker refuses consented storage if the database is not configured", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.workers.dev/api/assessment", {
      method: "POST",
      headers: {
        Origin: "https://example.github.io",
        "Content-Type": "application/json",
        Authorization: "Bearer valid-session",
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

test("participant registration, verification, login, consented linking, and password reset", async () => {
  const database = createAccountDatabase();
  const environment = {
    DB: database,
    RESEND_API_KEY: "test-resend-key",
    EMAIL_FROM: "Mindful Check-in <noreply@example.com>",
    SITE_URL: "https://example.github.io/",
  };
  const sentEmails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(options.headers.Authorization, "Bearer test-resend-key");
    sentEmails.push(JSON.parse(options.body));
    return new Response(null, { status: 200 });
  };
  const call = (path, body, headers = {}) =>
    worker.fetch(
      new Request(`https://api.example.workers.dev${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: "https://example.github.io",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      environment,
    );
  const emailToken = (message, key) => {
    const link = message.text.match(/https:\/\/\S+/)?.[0];
    assert.ok(link, "email contains a secure account link");
    return new URL(link).searchParams.get(key);
  };

  try {
    const missingEmailSetup = await worker.fetch(
      new Request("https://api.example.workers.dev/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "person@example.com", password: "a-long-password" }),
      }),
      { DB: database },
    );
    assert.equal(missingEmailSetup.status, 503);
    assert.equal(database.accounts.length, 0);

    const invalidRegistration = await call("/api/auth/register", {
      email: "person@example.com",
      password: "short",
    });
    assert.equal(invalidRegistration.status, 400);

    const registration = await call("/api/auth/register", {
      email: "Person@example.com",
      password: "initial-long-password",
    });
    assert.equal(registration.status, 202);
    assert.equal(database.accounts[0].email, "person@example.com");
    assert.notEqual(database.accounts[0].password_hash, "initial-long-password");
    assert.equal((await registration.json()).token, undefined);
    const verificationToken = emailToken(sentEmails[0], "verify");
    assert.ok(verificationToken);

    const unverifiedLogin = await call("/api/auth/login", {
      email: "person@example.com",
      password: "initial-long-password",
    });
    assert.equal(unverifiedLogin.status, 403);

    const verified = await call("/api/auth/verify", { token: verificationToken });
    assert.equal(verified.status, 200);
    const login = await call("/api/auth/login", {
      email: "PERSON@example.com",
      password: "initial-long-password",
    });
    assert.equal(login.status, 200);
    const session = await login.json();
    assert.equal(session.account.email, "person@example.com");
    assert.notEqual(database.sessions[0].token_hash, session.token);

    const me = await call("/api/auth/me", undefined, {
      Authorization: `Bearer ${session.token}`,
    });
    assert.deepEqual((await me.json()).account, { email: "person@example.com" });

    const linkWithoutStorage = await call(
      "/api/assessment",
      { answers: answersWith(), linkAccount: true, consentToStore: false },
      { Authorization: `Bearer ${session.token}` },
    );
    assert.equal(linkWithoutStorage.status, 400);

    const unlinkedAssessment = await call(
      "/api/assessment",
      {
        answers: answersWith(),
        consentToStore: true,
        linkAccount: false,
        researchConsent: "18+ research storage consent v4",
      },
      { Authorization: `Bearer ${session.token}` },
    );
    assert.equal((await unlinkedAssessment.json()).accountLinked, false);
    assert.equal(database.submissions[0].values.at(-1), null);

    const assessment = await call(
      "/api/assessment",
      {
        answers: answersWith(),
        consentToStore: true,
        linkAccount: true,
        researchConsent: "18+ research storage and account-link consent v4",
      },
      { Authorization: `Bearer ${session.token}` },
    );
    const saved = await assessment.json();
    assert.equal(assessment.status, 200);
    assert.equal(saved.accountLinked, true);
    assert.equal(database.submissions[1].values.at(-1), database.accounts[0].id);

    const recovery = await call("/api/auth/forgot-password", {
      email: "person@example.com",
    });
    assert.equal(recovery.status, 202);
    const resetToken = emailToken(sentEmails[1], "reset");
    assert.ok(resetToken);
    const reset = await call("/api/auth/reset-password", {
      token: resetToken,
      password: "replacement-long-password",
    });
    assert.equal(reset.status, 200);
    const expiredSession = await call("/api/auth/me", undefined, {
      Authorization: `Bearer ${session.token}`,
    });
    assert.equal(expiredSession.status, 401);
    const oldPassword = await call("/api/auth/login", {
      email: "person@example.com",
      password: "initial-long-password",
    });
    assert.equal(oldPassword.status, 401);
    const newPassword = await call("/api/auth/login", {
      email: "person@example.com",
      password: "replacement-long-password",
    });
    assert.equal(newPassword.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

  const accountScript = await fetch(`${baseUrl}/account.js`);
  assert.equal(accountScript.status, 200);
  assert.match(await accountScript.text(), /show-register/);

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
