import { calculateAssessment, validateAnswers } from "./assessment.js";

const maxBodyBytes = 16 * 1024;
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

export default {
  async fetch(request) {
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
      return jsonResponse(calculateAssessment(body.answers), 200, origin);
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
