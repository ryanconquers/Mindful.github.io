import { calculateAssessment, validateAnswers } from "./assessment.js";

const maxBodyBytes = 16 * 1024;
const aiModel = "@cf/google/gemma-4-26b-a4b-it";
const allowedOriginPattern =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.github\.io$/i;

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

  if (url.pathname === "/api/admin/submissions" && request.method === "GET") {
    const requestedLimit = Number(url.searchParams.get("limit") ?? 500);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 5000)
      : 500;
    const result = await env.DB.prepare(`
      SELECT id, submitted_at, answers_json, scores_json, safety_support,
        unusual_experience_referral, functioning_score, consent_version
      FROM submissions
      ORDER BY id DESC
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
    throw new Error("Request body is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes) {
    throw new Error("Request body is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function addAiSummary(assessment, ai) {
  if (assessment.safetySupport) {
    assessment.aiSummaryStatus = "skipped-safety";
    return assessment;
  }
  if (!ai || typeof ai.run !== "function") {
    assessment.aiSummaryStatus = "binding-unavailable";
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

  try {
    const result = await ai.run(aiModel, {
      messages: [
        {
          role: "system",
          content:
            "Write a brief, gentle reflection (at most 60 words) about the aggregate questionnaire data provided. The questionnaire is unvalidated. Do not diagnose, label, infer causes, predict outcomes, or recommend treatment. Do not describe the provisional bands as clinical facts. Use nonjudgmental language and state that this is only a reflection, not a diagnosis. Do not give crisis advice; a separate safety message handles that.",
        },
        {
          role: "user",
          content: JSON.stringify({ sectionSummaries: scoreFacts }),
        },
      ],
      max_completion_tokens: 256,
      temperature: 0.2,
      chat_template_kwargs: { enable_thinking: false },
    });
    const summary =
      typeof result === "string"
        ? result
        : result?.response ?? result?.choices?.[0]?.message?.content;
    if (typeof summary !== "string" || !summary.trim()) {
      assessment.aiSummaryStatus = "empty-response";
      return assessment;
    }
    assessment.aiSummary = summary.trim().slice(0, 800);
    assessment.aiSummaryStatus = "available";
  } catch (error) {
    console.error(
      "Workers AI summary request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    assessment.aiSummaryStatus = "model-error";
  }
  return assessment;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

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
      const assessment = calculateAssessment(body.answers);
      if (body.consentToStore === true) {
        if (!env?.DB) {
          return jsonResponse(
            { error: "Anonymous storage is not configured yet. Your responses were not saved." },
            503,
            origin,
          );
        }
        const byKey = Object.fromEntries(
          assessment.scores.map((score) => [score.key, score]),
        );
        const submittedAt = new Date().toISOString();
        const stored = await env.DB.prepare(`
          INSERT INTO submissions (
            submitted_at, consent_version, answers_json, scores_json,
            mood_score, mood_band, anxiety_score, anxiety_band,
            stress_score, stress_band, experiences_score, experiences_band,
            personality_score, personality_band, functioning_score,
            safety_support, unusual_experience_referral
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            submittedAt,
            "storage-consent-v1",
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
          )
          .run();
        assessment.saved = true;
        assessment.submissionId = stored.meta?.last_row_id ?? null;
      } else {
        assessment.saved = false;
      }
      if (body.aiSummary === true) {
        await addAiSummary(assessment, env?.AI);
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
