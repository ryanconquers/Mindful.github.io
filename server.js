import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateAssessment, validateAnswers } from "./assessment.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const maxBodyBytes = 16 * 1024;
export { calculateAssessment } from "./assessment.js";

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/api-config.js", ["api-config.js", "text/javascript; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
]);

export function createAppServer() {
  return createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/api/assessment" && request.method === "POST") {
      try {
        const body = await readJson(request);
        if (!validateAnswers(body?.answers)) {
          sendJson(response, 400, {
            error: "Please provide an answer from 0 to 3 for all 25 items.",
          });
          return;
        }
        const assessment = calculateAssessment(body.answers);
        if (body.aiSummary === true && !assessment.safetySupport) {
          assessment.aiSummaryStatus = "unavailable";
        } else if (body.aiSummary === true) {
          assessment.aiSummaryStatus = "skipped-safety";
        }
        sendJson(response, 200, assessment);
      } catch (error) {
        sendJson(response, error.statusCode ?? 400, {
          error: error.message || "Unable to process this assessment.",
        });
      }
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD, POST" });
      response.end();
      return;
    }

    const file = staticFiles.get(pathname);
    if (!file) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const [filename, contentType] = file;
    response.writeHead(200, {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "Cache-Control": "no-cache",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(join(root, filename)).pipe(response);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`Mindful Check-in is running at http://${host}:${port}`);
  });
}
