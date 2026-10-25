import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker from "./worker.js";

// Minimal D1-compatible wrapper over node:sqlite so the real migrations and
// SQL run in tests.
function createD1() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  const statement = (sql, values = []) => ({
    bind: (...bound) => statement(sql, bound),
    async run() {
      const info = sqlite.prepare(sql).run(...values);
      return {
        meta: { last_row_id: Number(info.lastInsertRowid), changes: info.changes },
      };
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...values) };
    },
    async first() {
      return sqlite.prepare(sql).get(...values) ?? null;
    },
  });
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      return Promise.all(statements.map((item) => item.run()));
    },
    sqlite,
  };
}

const origin = "https://example.github.io";
const env = () => ({
  DB: createD1(),
  DOCTOR_INVITE_CODE: "doctor-invite-code-123",
});

async function call(environment, method, path, { body, token } = {}) {
  const headers = { Origin: origin };
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await worker.fetch(
    new Request(`https://api.example.workers.dev${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    environment,
  );
  return { status: response.status, data: await response.json() };
}

const answers = (value = 0) =>
  Object.fromEntries(Array.from({ length: 25 }, (_, index) => [index + 1, value]));

const doctorBody = (overrides = {}) => ({
  role: "doctor",
  name: "Dr Asha Rao",
  email: "Asha@Clinic.test",
  password: "a-long-password",
  inviteCode: "doctor-invite-code-123",
  ...overrides,
});
const patientBody = (overrides = {}) => ({
  role: "patient",
  name: "Priya Shah",
  email: "priya@example.com",
  password: "another-long-password",
  confirmAdult: true,
  consentToShare: true,
  ...overrides,
});

test("doctor registration needs the operator's access code", async () => {
  const e = env();
  const wrong = await call(e, "POST", "/api/auth/register", {
    body: doctorBody({ inviteCode: "guess" }),
  });
  assert.equal(wrong.status, 403);
  const disabled = await call({ DB: e.DB }, "POST", "/api/auth/register", {
    body: doctorBody({ inviteCode: "" }),
  });
  assert.equal(disabled.status, 403);
  const ok = await call(e, "POST", "/api/auth/register", { body: doctorBody() });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.role, "doctor");
  assert.match(ok.data.user.doctorCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(ok.data.user.email, "asha@clinic.test");
  // passwords are never stored in plain text
  const row = e.DB.sqlite.prepare("SELECT * FROM users").get();
  assert.notEqual(row.password_hash, "a-long-password");
});

test("patient registers, signs in, takes the test, and the record is stored", async () => {
  const e = env();
  const missingConsent = await call(e, "POST", "/api/auth/register", {
    body: patientBody({ consentToShare: false }),
  });
  assert.equal(missingConsent.status, 400);
  const weak = await call(e, "POST", "/api/auth/register", {
    body: patientBody({ password: "short" }),
  });
  assert.equal(weak.status, 400);

  const registered = await call(e, "POST", "/api/auth/register", { body: patientBody() });
  assert.equal(registered.status, 201);
  const duplicate = await call(e, "POST", "/api/auth/register", { body: patientBody() });
  assert.equal(duplicate.status, 409);

  const bad = await call(e, "POST", "/api/auth/login", {
    body: { email: "priya@example.com", password: "wrong-password" },
  });
  assert.equal(bad.status, 401);
  const login = await call(e, "POST", "/api/auth/login", {
    body: { email: "PRIYA@example.com", password: "another-long-password" },
  });
  assert.equal(login.status, 200);
  const token = login.data.token;

  assert.equal((await call(e, "GET", "/api/auth/me")).status, 401);
  assert.equal((await call(e, "GET", "/api/auth/me", { token })).data.user.name, "Priya Shah");

  const a = answers(1);
  const result = await call(e, "POST", "/api/assessment", { body: { answers: a }, token });
  assert.equal(result.status, 200);
  assert.equal(result.data.saved, true);

  const mine = await call(e, "GET", "/api/patient/submissions", { token });
  assert.equal(mine.data.submissions.length, 1);
  assert.deepEqual(mine.data.submissions[0].answers, a);

  const expired = await call(e, "POST", "/api/assessment", {
    body: { answers: a },
    token: "not-a-real-token",
  });
  assert.equal(expired.status, 401);

  await call(e, "POST", "/api/auth/logout", { token });
  assert.equal((await call(e, "GET", "/api/auth/me", { token })).status, 401);
});

test("doctors see only their own linked patients", async () => {
  const e = env();
  const d1 = (await call(e, "POST", "/api/auth/register", { body: doctorBody() })).data;
  const d2 = (
    await call(e, "POST", "/api/auth/register", {
      body: doctorBody({ name: "Dr Other", email: "other@clinic.test" }),
    })
  ).data;

  const badCode = await call(e, "POST", "/api/auth/register", {
    body: patientBody({ doctorCode: "ZZZZ-ZZZZ" }),
  });
  assert.equal(badCode.status, 400);

  const p1 = (
    await call(e, "POST", "/api/auth/register", {
      body: patientBody({ doctorCode: d1.user.doctorCode.toLowerCase() }),
    })
  ).data;
  const p2 = (
    await call(e, "POST", "/api/auth/register", {
      body: patientBody({ name: "Unlinked", email: "u@example.com" }),
    })
  ).data;
  assert.equal(p1.user.doctor.name, "Dr Asha Rao");

  const safety = answers(0);
  safety[18] = 2;
  await call(e, "POST", "/api/assessment", { body: { answers: safety }, token: p1.token });
  await call(e, "POST", "/api/assessment", { body: { answers: answers(2) }, token: p2.token });

  const list = await call(e, "GET", "/api/doctor/patients", { token: d1.token });
  assert.equal(list.data.patients.length, 1);
  assert.equal(list.data.patients[0].name, "Priya Shah");
  assert.equal(list.data.patients[0].checkInCount, 1);
  assert.equal(list.data.patients[0].latestSafetySupport, true);

  const records = await call(e, "GET", `/api/doctor/patients/${p1.user.id}/submissions`, {
    token: d1.token,
  });
  assert.equal(records.data.submissions.length, 1);

  // another doctor, an unlinked patient, and a patient's own token are all refused
  assert.equal(
    (await call(e, "GET", `/api/doctor/patients/${p1.user.id}/submissions`, { token: d2.token })).status,
    404,
  );
  assert.equal(
    (await call(e, "GET", `/api/doctor/patients/${p2.user.id}/submissions`, { token: d1.token })).status,
    404,
  );
  assert.equal((await call(e, "GET", "/api/doctor/patients", { token: p1.token })).status, 403);
  assert.equal((await call(e, "GET", "/api/patient/submissions", { token: d1.token })).status, 403);
  assert.equal(
    (await call(e, "POST", "/api/assessment", { body: { answers: answers() }, token: d1.token })).status,
    403,
  );

  // patient can unlink; doctor loses access
  const unlink = await call(e, "PUT", "/api/patient/doctor", {
    body: { doctorCode: "" },
    token: p1.token,
  });
  assert.equal(unlink.data.doctor, null);
  assert.equal(
    (await call(e, "GET", `/api/doctor/patients/${p1.user.id}/submissions`, { token: d1.token })).status,
    404,
  );
});

test("sign-in locks out after repeated failures; patients can delete their account", async () => {
  const e = env();
  const p = (await call(e, "POST", "/api/auth/register", { body: patientBody() })).data;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await call(e, "POST", "/api/auth/login", {
      body: { email: "priya@example.com", password: "wrong-wrong-wrong" },
    });
  }
  const locked = await call(e, "POST", "/api/auth/login", {
    body: { email: "priya@example.com", password: "another-long-password" },
  });
  assert.equal(locked.status, 429);

  await call(e, "POST", "/api/assessment", { body: { answers: answers() }, token: p.token });
  assert.equal(
    (await call(e, "DELETE", "/api/patient/account", { body: { confirm: "no" }, token: p.token })).status,
    400,
  );
  const deleted = await call(e, "DELETE", "/api/patient/account", {
    body: { confirm: "DELETE MY ACCOUNT" },
    token: p.token,
  });
  assert.equal(deleted.data.deleted, true);
  assert.equal(e.DB.sqlite.prepare("SELECT COUNT(*) n FROM submissions").get().n, 0);
  assert.equal(e.DB.sqlite.prepare("SELECT COUNT(*) n FROM users").get().n, 0);
});
