import { calculateAssessment, validateAnswers } from "./assessment.js";

const maxBodyBytes = 16 * 1024;
const aiModel = "@cf/google/gemma-4-26b-a4b-it";
const allowedOriginPattern =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.github\.io$/i;

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
    });
    const summary =
      typeof result === "string"
        ? result
        : result?.response ?? result?.choices?.[0]?.message?.content;
    if (typeof summary !== "string" || !summary.trim()) {
      assessment.aiSummaryStatus = "empty-response";
      assessment.aiSummaryDiagnostic = {
        resultType: typeof result,
        resultKeys:
          result && typeof result === "object" ? Object.keys(result) : [],
        responseType: typeof result?.response,
        choicesType: typeof result?.choices,
        choicesLength: Array.isArray(result?.choices)
          ? result.choices.length
          : null,
        finishReason: result?.choices?.[0]?.finish_reason,
        firstChoiceKeys:
          result?.choices?.[0] && typeof result.choices[0] === "object"
            ? Object.keys(result.choices[0])
            : [],
        firstMessageKeys:
          result?.choices?.[0]?.message &&
          typeof result.choices[0].message === "object"
            ? Object.keys(result.choices[0].message)
            : [],
        messageContentType: typeof result?.choices?.[0]?.message?.content,
        messageContentLength:
          typeof result?.choices?.[0]?.message?.content === "string"
            ? result.choices[0].message.content.length
            : null,
        hasRefusal: Boolean(result?.choices?.[0]?.message?.refusal),
      };
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
      const assessment = calculateAssessment(body.answers);
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
