import { calculateAssessment, validateAnswers } from "./assessment.js";

const maxBodyBytes = 16 * 1024;
const geminiModel = "gemini-3.5-flash-lite";
const geminiEndpoint =
  `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const resetLifetimeMs = 60 * 60 * 1000;
const allowedOriginPattern =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.github\.io$/i;

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (
    origin &&
    (allowedOriginPattern.test(origin) || origin === "http://127.0.0.1:3000")
  ) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(payload, status, origin) {
  return Response.json(payload, {
    status,
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function unauthorized(origin) {
  const response = jsonResponse({ error: "Dashboard password required." }, 401, origin);
  response.headers.set("WWW-Authenticate", 'Basic realm="Mindful Check-in admin"');
  return response;
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    (character) => character.charCodeAt(0),
  );
}

function constantTimeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function passwordHash(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    key,
    256,
  );
  return { salt: base64Url(salt), hash: base64Url(new Uint8Array(hash)) };
}

function createToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function expiresAt(durationMs) {
  return new Date(Date.now() + durationMs).toISOString();
}

function authError(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

async function accountForRequest(request, env) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || !env?.DB) return null;
  const token = authorization.slice(7);
  if (!token || token.length > 100) return null;
  const tokenHash = await hashToken(token);
  return env.DB.prepare(`
    SELECT accounts.id, accounts.email
    FROM account_sessions
    JOIN accounts ON accounts.id = account_sessions.account_id
    WHERE account_sessions.token_hash = ?
      AND account_sessions.expires_at > ?
      AND accounts.email_verified = 1
  `)
    .bind(tokenHash, new Date().toISOString())
    .first();
}

async function sendAccountEmail(env, email, token) {
  const siteUrl = accountEmailSiteUrl(env);
  siteUrl.searchParams.set("reset", token);
  const subject = "Reset your Mindful Check-in password";
  const linkLabel = "Choose a new password";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email],
      subject,
      text: `${linkLabel}: ${siteUrl.toString()}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`,
      html: `<p>${linkLabel}:</p><p><a href="${siteUrl.toString()}">${linkLabel}</a></p><p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>`,
    }),
  });
  if (!response.ok) {
    throw authError("The account email could not be sent. Please try again later.", 502);
  }
}

function accountEmailSiteUrl(env) {
  if (
    typeof env?.RESEND_API_KEY !== "string" ||
    !env.RESEND_API_KEY ||
    typeof env?.EMAIL_FROM !== "string" ||
    !env.EMAIL_FROM.trim() ||
    typeof env?.SITE_URL !== "string"
  ) {
    throw authError(
      "Password recovery email is not configured. Ask the site operator to configure Resend.",
      503,
    );
  }

  let siteUrl;
  try {
    siteUrl = new URL(env.SITE_URL);
  } catch {
    throw authError("The account email link is not configured correctly.", 503);
  }
  if (siteUrl.protocol !== "https:") {
    throw authError("The account email link must use HTTPS.", 503);
  }
  siteUrl.search = "";
  siteUrl.hash = "";
  return siteUrl;
}

async function issuePasswordResetToken(env, accountId, email) {
  const token = createToken();
  const tokenHash = await hashToken(token);
  await env.DB.prepare("DELETE FROM account_tokens WHERE account_id = ? AND purpose = 'reset'")
    .bind(accountId)
    .run();
  await env.DB.prepare(`
    INSERT INTO account_tokens (account_id, purpose, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `)
    .bind(accountId, "reset", tokenHash, expiresAt(resetLifetimeMs))
    .run();
  await sendAccountEmail(env, email, token);
}

async function handleAuth(request, env, url, origin) {
  if (!env?.DB) {
    return jsonResponse({ error: "Accounts are not configured yet." }, 503, origin);
  }
  const body = ["POST"].includes(request.method) ? await readJson(request) : {};

  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body.password;
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    ) {
      throw authError("Enter a valid email and a password of 12–128 characters.");
    }
    let account = await env.DB.prepare(
      "SELECT id, email, email_verified FROM accounts WHERE email = ?",
    )
      .bind(email)
      .first();
    if (account) {
      throw authError("An account with this email already exists. Please sign in.", 409);
    }
    const credential = await passwordHash(password);
    const inserted = await env.DB.prepare(`
      INSERT INTO accounts (email, password_salt, password_hash, email_verified, created_at)
      VALUES (?, ?, ?, 1, ?)
    `)
      .bind(email, credential.salt, credential.hash, new Date().toISOString())
      .run();
    if (!inserted.meta?.last_row_id) {
      throw authError("The account could not be created. Please try again.", 503);
    }
    return jsonResponse(
      { message: "Account created. Sign in with your email and password." },
      201,
      origin,
    );
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (typeof body.password !== "string" || body.password.length > 128) {
      throw authError("Email or password was not accepted.", 401);
    }
    const account = await env.DB.prepare(`
      SELECT id, email, password_salt, password_hash, email_verified
      FROM accounts WHERE email = ?
    `)
      .bind(email)
      .first();
    let matches = false;
    if (account) {
      const salt = fromBase64Url(account.password_salt);
      const candidate = await passwordHash(body.password, salt);
      matches = constantTimeEqual(candidate.hash, account.password_hash);
    } else {
      await passwordHash(body.password, new Uint8Array(16));
    }
    if (!account || !matches) {
      throw authError("Email or password was not accepted.", 401);
    }
    if (!account.email_verified) {
      throw authError("This account is inactive. Please contact the site operator.", 403);
    }
    const sessionToken = createToken();
    const sessionExpiresAt = expiresAt(sessionLifetimeMs);
    await env.DB.prepare(`
      INSERT INTO account_sessions (account_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `)
      .bind(
        account.id,
        await hashToken(sessionToken),
        sessionExpiresAt,
        new Date().toISOString(),
      )
      .run();
    return jsonResponse(
      {
        token: sessionToken,
        expiresAt: sessionExpiresAt,
        account: { email: account.email },
      },
      200,
      origin,
    );
  }

  if (url.pathname === "/api/auth/forgot-password" && request.method === "POST") {
    accountEmailSiteUrl(env);
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length <= 254) {
      const account = await env.DB.prepare(
        "SELECT id, email FROM accounts WHERE email = ? AND email_verified = 1",
      )
        .bind(email)
        .first();
      if (account) {
        await issuePasswordResetToken(env, account.id, account.email);
      }
    }
    return jsonResponse(
      { message: "If an account matches, a password-reset link will be sent." },
      202,
      origin,
    );
  }

  if (url.pathname === "/api/auth/reset-password" && request.method === "POST") {
    if (
      typeof body.token !== "string" ||
      body.token.length > 100 ||
      typeof body.password !== "string" ||
      body.password.length < 12 ||
      body.password.length > 128
    ) {
      throw authError("Use a valid reset link and a password of 12–128 characters.");
    }
    const tokenHash = await hashToken(body.token);
    const token = await env.DB.prepare(`
      SELECT id, account_id FROM account_tokens
      WHERE token_hash = ? AND purpose = 'reset' AND expires_at > ?
    `)
      .bind(tokenHash, new Date().toISOString())
      .first();
    if (!token) throw authError("This reset link is invalid or has expired.", 400);
    const credential = await passwordHash(body.password);
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE accounts SET password_salt = ?, password_hash = ? WHERE id = ?
      `).bind(credential.salt, credential.hash, token.account_id),
      env.DB.prepare("DELETE FROM account_tokens WHERE id = ?").bind(token.id),
      env.DB.prepare("DELETE FROM account_sessions WHERE account_id = ?").bind(token.account_id),
    ]);
    return jsonResponse({ message: "Password updated. You can now sign in." }, 200, origin);
  }

  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    const account = await accountForRequest(request, env);
    if (!account) throw authError("Please sign in again.", 401);
    return jsonResponse({ account: { email: account.email } }, 200, origin);
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    if (token && token.length <= 100) {
      await env.DB.prepare("DELETE FROM account_sessions WHERE token_hash = ?")
        .bind(await hashToken(token))
        .run();
    }
    return jsonResponse({ message: "Signed out." }, 200, origin);
  }

  return jsonResponse({ error: "Not found." }, 404, origin);
}

function hasAdminAccess(request, env) {
  const expected = env?.ADMIN_PASSWORD;
  const authorization = request.headers.get("Authorization");
  if (typeof expected !== "string" || expected.length < 20 || !authorization) {
    return false;
  }
  if (!authorization.startsWith("Basic ")) return false;
  let credentials;
  try {
    credentials = atob(authorization.slice(6));
  } catch {
    return false;
  }
  const separator = credentials.indexOf(":");
  if (separator < 0 || credentials.slice(0, separator) !== "admin") {
    return false;
  }
  const supplied = new TextEncoder().encode(credentials.slice(separator + 1));
  const expectedBytes = new TextEncoder().encode(expected);
  if (supplied.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= supplied[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function handleAdmin(request, env, url, origin) {
  if (!hasAdminAccess(request, env)) return unauthorized(origin);
  if (!env?.DB) {
    return jsonResponse(
      { error: "The response database is not configured yet." },
      503,
      origin,
    );
  }

  if (url.pathname === "/api/admin/summary" && request.method === "GET") {
    const summary = await env.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        (SELECT COUNT(*) FROM accounts WHERE email_verified = 1) AS account_count,
        SUM(CASE WHEN mood_band IN ('Moderate', 'High') THEN 1 ELSE 0 END) AS mood_moderate_high,
        SUM(CASE WHEN anxiety_band IN ('Moderate', 'High') THEN 1 ELSE 0 END) AS anxiety_moderate_high,
        SUM(CASE WHEN stress_band IN ('Moderate', 'High') THEN 1 ELSE 0 END) AS stress_moderate_high,
        SUM(CASE WHEN experiences_band IN ('Moderate', 'High') THEN 1 ELSE 0 END) AS experiences_moderate_high,
        SUM(CASE WHEN personality_band IN ('Moderate', 'High') THEN 1 ELSE 0 END) AS personality_moderate_high,
        SUM(CASE WHEN safety_support = 1 THEN 1 ELSE 0 END) AS safety_support_count,
        SUM(CASE WHEN functioning_score >= 2 THEN 1 ELSE 0 END) AS functioning_support_count
      FROM submissions
    `).first();
    const bands = await env.DB.prepare(`
      SELECT category, band, COUNT(*) AS count
      FROM (
        SELECT 'Mood' AS category, mood_band AS band FROM submissions
        UNION ALL SELECT 'Anxiety', anxiety_band FROM submissions
        UNION ALL SELECT 'Stress', stress_band FROM submissions
        UNION ALL SELECT 'Unusual experiences', experiences_band FROM submissions
        UNION ALL SELECT 'Personality tendencies', personality_band FROM submissions
      )
      GROUP BY category, band
      ORDER BY category, band
    `).all();
    return jsonResponse(
      {
        summary: Object.fromEntries(
          Object.entries(summary ?? {}).map(([key, value]) => [
            key,
            value ?? 0,
          ]),
        ),
        bands: bands.results ?? [],
      },
      200,
      origin,
    );
  }

  if (url.pathname === "/api/admin/accounts" && request.method === "GET") {
    const result = await env.DB.prepare(`
      SELECT accounts.email, accounts.created_at,
        COUNT(submissions.id) AS linked_submission_count
      FROM accounts
      LEFT JOIN submissions ON submissions.account_id = accounts.id
      WHERE accounts.email_verified = 1
      GROUP BY accounts.id
      ORDER BY accounts.created_at DESC
      LIMIT 500
    `).all();
    return jsonResponse(
      { accounts: result.results ?? [] },
      200,
      origin,
    );
  }

  if (url.pathname === "/api/admin/submissions" && request.method === "GET") {
    const requestedLimit = Number(url.searchParams.get("limit") ?? 500);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 5000)
      : 500;
    const result = await env.DB.prepare(`
      SELECT submissions.id, submissions.submitted_at, submissions.answers_json,
        submissions.scores_json, submissions.safety_support,
        submissions.unusual_experience_referral, submissions.functioning_score,
        submissions.consent_version, submissions.research_consent, accounts.email
      FROM submissions
      LEFT JOIN accounts ON accounts.id = submissions.account_id
      ORDER BY submissions.id DESC
      LIMIT ?
    `)
      .bind(limit)
      .all();
    return jsonResponse(
      {
        submissions: (result.results ?? []).map((row) => ({
          id: row.id,
          submittedAt: row.submitted_at,
          answers: JSON.parse(row.answers_json),
          scores: JSON.parse(row.scores_json),
          safetySupport: Boolean(row.safety_support),
          unusualExperienceReferral: Boolean(row.unusual_experience_referral),
          functioningScore: row.functioning_score,
          consentVersion: row.consent_version,
          researchConsent: row.research_consent,
          accountEmail: row.email,
        })),
      },
      200,
      origin,
    );
  }

  if (url.pathname === "/api/admin/submissions" && request.method === "DELETE") {
    let body;
    try {
      body = await readJson(request);
    } catch {
      return jsonResponse({ error: "Confirm deletion to continue." }, 400, origin);
    }
    if (body?.confirm !== "DELETE ALL") {
      return jsonResponse({ error: "Confirm deletion to continue." }, 400, origin);
    }
    const result = await env.DB.prepare("DELETE FROM submissions").run();
    return jsonResponse(
      { deleted: result.meta?.changes ?? 0 },
      200,
      origin,
    );
  }

  return jsonResponse({ error: "Not found." }, 404, origin);
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBodyBytes) {
    throw authError("Request body is too large.", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes) {
    throw authError("Request body is too large.", 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw authError("Request body must be valid JSON.", 400);
  }
}

async function addAiSummary(assessment, apiKey) {
  if (assessment.safetySupport) {
    assessment.aiSummaryStatus = "skipped-safety";
    return assessment;
  }
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    assessment.aiSummaryStatus = "unavailable";
    return assessment;
  }

  const scoreFacts = assessment.scores
    .filter(({ key }) => ["mood", "anxiety", "stress"].includes(key))
    .map(({ name, score, max, band, frequentResponses }) => ({
      section: name,
      total: score,
      maximum: max,
      provisionalBand: band,
      oftenReportedCount: frequentResponses,
    }));

  let response;
  try {
    response = await fetch(geminiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "Write a specific, gentle reflection in 2 or 3 sentences and at most 55 words. Use the actual Mood, Anxiety, and Stress section names and the supplied provisional bands and often-reported counts. Describe which section stands out or, if the pattern is similar across sections, say that clearly. Tie each observation to the supplied facts; never invent symptoms, causes, changes over time, or personal circumstances. End with one brief, open reflection question or a low-risk everyday activity relevant to the pattern. Do not diagnose, label, predict outcomes, recommend treatment, present provisional bands as clinical facts, or give crisis advice. The page already displays the non-diagnostic disclaimer, so do not add generic disclaimer or filler text.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({ sectionSummaries: scoreFacts }),
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 128,
          temperature: 0.2,
        },
      }),
    });
    if (!response.ok) {
      const statusMessages = {
        400: "provider-request-error",
        401: "provider-key-error",
        403: "provider-access-error",
        404: "provider-model-error",
        429: "provider-quota-error",
      };
      assessment.aiSummaryStatus =
        statusMessages[response.status] ?? "provider-error";
      return assessment;
    }
    const result = await response.json();
    const summary = result?.candidates?.[0]?.content?.parts
      ?.map(({ text }) => text)
      .filter((text) => typeof text === "string")
      .join("");
    if (typeof summary !== "string" || !summary.trim()) {
      assessment.aiSummaryStatus = "empty-response";
      return assessment;
    }
    assessment.aiSummary = summary.trim().slice(0, 800);
    assessment.aiSummaryStatus = "available";
  } catch (error) {
    console.error(
      "Gemini AI summary request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    assessment.aiSummaryStatus = response ? "provider-error" : "network-error";
  }
  return assessment;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (url.pathname.startsWith("/api/auth/")) {
      if (origin && !corsHeaders(origin)["Access-Control-Allow-Origin"]) {
        return jsonResponse({ error: "Origin not allowed." }, 403, origin);
      }
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      try {
        return await handleAuth(request, env, url, origin);
      } catch (error) {
        const status = error.statusCode ?? 500;
        return jsonResponse(
          {
            error:
              error.statusCode
                ? error.message
                : "The account request could not be completed.",
          },
          status,
          origin,
        );
      }
    }

    if (url.pathname.startsWith("/api/admin/")) {
      if (origin && !corsHeaders(origin)["Access-Control-Allow-Origin"]) {
        return jsonResponse({ error: "Origin not allowed." }, 403, origin);
      }
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      try {
        return await handleAdmin(request, env, url, origin);
      } catch {
        return jsonResponse(
          { error: "The dashboard request could not be completed." },
          500,
          origin,
        );
      }
    }

    if (url.pathname === "/api/ai-demo") {
      if (origin && !corsHeaders(origin)["Access-Control-Allow-Origin"]) {
        return jsonResponse({ error: "Origin not allowed." }, 403, origin);
      }
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed." }, 405, origin);
      }
      const account = await accountForRequest(request, env);
      if (!account) {
        return jsonResponse(
          { error: "Please sign in with a registered account to continue." },
          401,
          origin,
        );
      }
      const demoAnswers = Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => [index + 1, 0]),
      );
      demoAnswers[1] = 1;
      demoAnswers[8] = 1;
      demoAnswers[14] = 1;
      const assessment = calculateAssessment(demoAnswers);
      await addAiSummary(assessment, env?.GEMINI_API_KEY);
      return jsonResponse(
        {
          aiSummary: assessment.aiSummary,
          aiSummaryStatus: assessment.aiSummaryStatus,
          demo: true,
        },
        200,
        origin,
      );
    }

    if (url.pathname !== "/api/assessment") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }
    if (origin && !corsHeaders(origin)["Access-Control-Allow-Origin"]) {
      return jsonResponse({ error: "Origin not allowed." }, 403, origin);
    }

    try {
      const body = await readJson(request);
      if (!validateAnswers(body?.answers)) {
        return jsonResponse(
          { error: "Please provide an answer from 0 to 3 for all 25 items." },
          400,
          origin,
        );
      }
      if (body.aiSummary !== undefined && typeof body.aiSummary !== "boolean") {
        return jsonResponse(
          { error: "The AI-summary opt-in must be true or false." },
          400,
          origin,
        );
      }
      if (
        body.consentToStore !== undefined &&
        typeof body.consentToStore !== "boolean"
      ) {
        return jsonResponse(
          { error: "The response-storage consent must be true or false." },
          400,
          origin,
        );
      }
      if (
        body.linkAccount !== undefined &&
        typeof body.linkAccount !== "boolean"
      ) {
        return jsonResponse(
          { error: "The account-link consent must be true or false." },
          400,
          origin,
        );
      }
      if (body.linkAccount === true && body.consentToStore !== true) {
        return jsonResponse(
          { error: "Account linking requires explicit response-storage consent." },
          400,
          origin,
        );
      }
      if (body.consentToStore === true && !env?.DB) {
        return jsonResponse(
          { error: "Anonymous storage is not configured yet. Your responses were not saved." },
          503,
          origin,
        );
      }
      const account = await accountForRequest(request, env);
      if (!account) {
        return jsonResponse(
          { error: "Please sign in with a registered account to continue." },
          401,
          origin,
        );
      }
      const assessment = calculateAssessment(body.answers);
      if (body.consentToStore === true) {
        if (
          typeof body.researchConsent !== "string" ||
          body.researchConsent.length > 150 ||
          body.researchConsent.trim().length < 8
        ) {
          return jsonResponse(
            {
              error:
                "Please confirm that you are 18 or older and consent to research storage.",
            },
            400,
            origin,
          );
        }
        const byKey = Object.fromEntries(
          assessment.scores.map((score) => [score.key, score]),
        );
        const submittedAt = new Date().toISOString();
        const stored = await env.DB.prepare(`
          INSERT INTO submissions (
            submitted_at, consent_version, research_consent,
            answers_json, scores_json,
            mood_score, mood_band, anxiety_score, anxiety_band,
            stress_score, stress_band, experiences_score, experiences_band,
            personality_score, personality_band, functioning_score,
            safety_support, unusual_experience_referral, account_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            submittedAt,
            "research-consent-v4",
            body.researchConsent.trim(),
            JSON.stringify(body.answers),
            JSON.stringify(assessment.scores),
            byKey.mood.score,
            byKey.mood.band,
            byKey.anxiety.score,
            byKey.anxiety.band,
            byKey.stress.score,
            byKey.stress.band,
            byKey.experiences.score,
            byKey.experiences.band,
            byKey.personality.score,
            byKey.personality.band,
            body.answers[25],
            assessment.safetySupport ? 1 : 0,
            assessment.unusualExperienceReferral ? 1 : 0,
            body.linkAccount === true ? account.id : null,
          )
          .run();
        assessment.saved = true;
        assessment.submissionId = stored.meta?.last_row_id ?? null;
        assessment.accountLinked = body.linkAccount === true;
      } else {
        assessment.saved = false;
      }
      if (body.aiSummary === true) {
        await addAiSummary(assessment, env?.GEMINI_API_KEY);
      }
      return jsonResponse(assessment, 200, origin);
    } catch (error) {
      const status = error.message === "Request body is too large." ? 413 : 400;
      return jsonResponse(
        { error: error.message || "Unable to process this assessment." },
        status,
        origin,
      );
    }
  },
};
