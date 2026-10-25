// Patient / doctor accounts: registration, sign-in, sessions, and the
// role-protected record endpoints. Imported by worker.js.

import {
  cleanName,
  failureWindowMs,
  hashPassword,
  hashToken,
  isValidEmail,
  maxFailedLogins,
  newDoctorCode,
  newSessionToken,
  normalizeDoctorCode,
  normalizeEmail,
  passwordProblem,
  randomSalt,
  safeEqual,
  sessionLifetimeMs,
} from "./auth.js";

const dummySalt = randomSalt();

export async function authenticate(request, env) {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ") || !env?.DB) return null;
  const token = header.slice(7).trim();
  if (!token || token.length > 200) return null;
  const row = await env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.doctor_code, u.doctor_id,
      s.expires_at, s.token_hash
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `)
    .bind(await hashToken(token))
    .first();
  if (!row || row.expires_at <= new Date().toISOString()) return null;
  return row;
}

async function describeUser(env, user) {
  const description = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
  if (user.role === "doctor") description.doctorCode = user.doctor_code;
  if (user.role === "patient") {
    description.doctor = null;
    if (user.doctor_id) {
      const doctor = await env.DB.prepare(
        "SELECT name FROM users WHERE id = ? AND role = 'doctor'",
      )
        .bind(user.doctor_id)
        .first();
      if (doctor) description.doctor = { name: doctor.name };
    }
  }
  return description;
}

async function createSession(env, userId) {
  const token = newSessionToken();
  const now = new Date();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(
      now.toISOString(),
    ),
    env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).bind(
      await hashToken(token),
      userId,
      now.toISOString(),
      new Date(now.getTime() + sessionLifetimeMs).toISOString(),
    ),
  ]);
  return { token, expiresAt: new Date(now.getTime() + sessionLifetimeMs).toISOString() };
}

export function mapSubmission(row) {
  return {
    id: row.id,
    submittedAt: row.submitted_at,
    answers: JSON.parse(row.answers_json),
    scores: JSON.parse(row.scores_json),
    safetySupport: Boolean(row.safety_support),
    unusualExperienceReferral: Boolean(row.unusual_experience_referral),
    functioningScore: row.functioning_score,
    advice: row.ai_status
      ? { status: row.ai_status, source: row.ai_source, text: row.ai_advice }
      : null,
    review: row.review_verdict
      ? {
          verdict: row.review_verdict,
          notes: row.review_notes,
          reviewedAt: row.reviewed_at,
          reviewerName: row.reviewer_name ?? null,
        }
      : null,
  };
}

const submissionColumns = `id, submitted_at, answers_json, scores_json,
  safety_support, unusual_experience_referral, functioning_score,
  ai_advice, ai_status, ai_source, review_verdict, review_notes, reviewed_at,
  (SELECT name FROM users r WHERE r.id = submissions.reviewed_by) AS reviewer_name`;

async function findDoctorByCode(env, rawCode) {
  const code = normalizeDoctorCode(rawCode);
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return null;
  return env.DB.prepare(
    "SELECT id, name FROM users WHERE doctor_code = ? AND role = 'doctor'",
  )
    .bind(code)
    .first();
}

async function register(body, env, { json, origin }) {
  const role = body?.role;
  if (role !== "patient" && role !== "doctor") {
    return json({ error: "Please choose whether you are a patient or a doctor." }, 400, origin);
  }
  const name = cleanName(body.name);
  const email = normalizeEmail(body.email);
  if (name.length < 2 || name.length > 80) {
    return json({ error: "Please enter your name (2–80 characters)." }, 400, origin);
  }
  if (!isValidEmail(email)) {
    return json({ error: "Please enter a valid email address." }, 400, origin);
  }
  const problem = passwordProblem(body.password);
  if (problem) return json({ error: problem }, 400, origin);

  let doctorId = null;
  if (role === "patient") {
    if (body.confirmAdult !== true || body.consentToShare !== true) {
      return json(
        {
          error:
            "Please confirm that you are 18 or older and agree to save your check-ins to your account.",
        },
        400,
        origin,
      );
    }
    if (body.doctorCode) {
      const doctor = await findDoctorByCode(env, body.doctorCode);
      if (!doctor) {
        return json(
          { error: "That doctor code was not recognised. Check it, or leave it blank." },
          400,
          origin,
        );
      }
      doctorId = doctor.id;
    }
  } else {
    const expected = env.DOCTOR_INVITE_CODE;
    if (typeof expected !== "string" || expected.length < 12) {
      return json({ error: "Doctor registration is not enabled yet." }, 403, origin);
    }
    if (typeof body.inviteCode !== "string" || !safeEqual(body.inviteCode.trim(), expected)) {
      return json({ error: "That doctor access code was not accepted." }, 403, origin);
    }
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first();
  if (existing) {
    return json({ error: "An account with this email already exists. Please sign in." }, 409, origin);
  }

  const salt = randomSalt();
  const hash = await hashPassword(body.password, salt);
  const createdAt = new Date().toISOString();
  let userId = null;
  for (let attempt = 0; attempt < 5 && userId === null; attempt += 1) {
    try {
      const result = await env.DB.prepare(`
        INSERT INTO users (email, name, role, password_hash, password_salt,
          doctor_code, doctor_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          email,
          name,
          role,
          hash,
          salt,
          role === "doctor" ? newDoctorCode() : null,
          doctorId,
          createdAt,
        )
        .run();
      userId = result.meta?.last_row_id ?? null;
    } catch (error) {
      const message = String(error?.message ?? error);
      if (/users\.email/i.test(message)) {
        return json({ error: "An account with this email already exists. Please sign in." }, 409, origin);
      }
      if (!/UNIQUE/i.test(message)) throw error;
      // doctor_code collision: loop and draw a new code
    }
  }
  if (userId === null) throw new Error("Could not create the account.");

  const user = await env.DB.prepare(
    "SELECT id, email, name, role, doctor_code, doctor_id FROM users WHERE id = ?",
  )
    .bind(userId)
    .first();
  const session = await createSession(env, userId);
  return json({ ...session, user: await describeUser(env, user) }, 201, origin);
}

async function login(body, env, { json, origin }) {
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password || password.length > 128) {
    return json({ error: "Please enter your email and password." }, 400, origin);
  }
  const windowStart = new Date(Date.now() - failureWindowMs).toISOString();
  const failures = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND failed_at > ?",
  )
    .bind(email, windowStart)
    .first();
  if ((failures?.n ?? 0) >= maxFailedLogins) {
    return json(
      { error: "Too many unsuccessful attempts. Please wait 15 minutes and try again." },
      429,
      origin,
    );
  }

  const user = await env.DB.prepare(
    `SELECT id, email, name, role, doctor_code, doctor_id, password_hash, password_salt
     FROM users WHERE email = ?`,
  )
    .bind(email)
    .first();
  // Hash even for unknown emails so response time does not reveal accounts.
  const attempted = await hashPassword(password, user?.password_salt ?? dummySalt);
  if (!user || !safeEqual(attempted, user.password_hash)) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM login_failures WHERE failed_at <= ?").bind(windowStart),
      env.DB.prepare("INSERT INTO login_failures (email, failed_at) VALUES (?, ?)").bind(
        email,
        new Date().toISOString(),
      ),
    ]);
    return json({ error: "That email and password did not match." }, 401, origin);
  }
  await env.DB.prepare("DELETE FROM login_failures WHERE email = ?").bind(email).run();
  // The sign-in form sends the role picked with the Patient/Doctor radio button.
  if ((body?.role === "patient" || body?.role === "doctor") && body.role !== user.role) {
    const actual = user.role === "doctor" ? "Doctor" : "Patient";
    return json(
      { error: `This account is registered as a ${actual.toLowerCase()}. Select "${actual}" above to sign in.` },
      403,
      origin,
    );
  }
  const session = await createSession(env, user.id);
  return json({ ...session, user: await describeUser(env, user) }, 200, origin);
}

export async function handleAccounts(request, env, url, origin, { json, readJson }) {
  if (!env?.DB) {
    return json({ error: "Accounts are not configured yet." }, 503, origin);
  }
  const helpers = { json, origin };
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/auth/register" && method === "POST") {
    return register(await readJson(request), env, helpers);
  }
  if (path === "/api/auth/login" && method === "POST") {
    return login(await readJson(request), env, helpers);
  }

  const user = await authenticate(request, env);
  if (!user) {
    return json({ error: "Please sign in to continue." }, 401, origin);
  }

  if (path === "/api/auth/me" && method === "GET") {
    return json({ user: await describeUser(env, user) }, 200, origin);
  }
  if (path === "/api/auth/logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(user.token_hash)
      .run();
    return json({ ok: true }, 200, origin);
  }

  if (path.startsWith("/api/patient/")) {
    if (user.role !== "patient") {
      return json({ error: "This area is for patient accounts." }, 403, origin);
    }
    if (path === "/api/patient/submissions" && method === "GET") {
      const result = await env.DB.prepare(
        `SELECT ${submissionColumns} FROM submissions
         WHERE user_id = ? ORDER BY id DESC LIMIT 200`,
      )
        .bind(user.id)
        .all();
      return json({ submissions: (result.results ?? []).map(mapSubmission) }, 200, origin);
    }
    if (path === "/api/patient/doctor" && method === "PUT") {
      const body = await readJson(request);
      let doctor = null;
      if (body?.doctorCode) {
        doctor = await findDoctorByCode(env, body.doctorCode);
        if (!doctor) {
          return json({ error: "That doctor code was not recognised." }, 400, origin);
        }
      }
      await env.DB.prepare("UPDATE users SET doctor_id = ? WHERE id = ?")
        .bind(doctor?.id ?? null, user.id)
        .run();
      return json({ doctor: doctor ? { name: doctor.name } : null }, 200, origin);
    }
    if (path === "/api/patient/account" && method === "DELETE") {
      const body = await readJson(request);
      if (body?.confirm !== "DELETE MY ACCOUNT") {
        return json({ error: "Confirm deletion to continue." }, 400, origin);
      }
      await env.DB.batch([
        env.DB.prepare("DELETE FROM submissions WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
      ]);
      return json({ deleted: true }, 200, origin);
    }
  }

  if (path.startsWith("/api/doctor/")) {
    if (user.role !== "doctor") {
      return json({ error: "This area is for doctor accounts." }, 403, origin);
    }
    if (path === "/api/doctor/patients" && method === "GET") {
      const result = await env.DB.prepare(`
        SELECT u.id, u.name, u.email, u.created_at,
          (SELECT COUNT(*) FROM submissions s WHERE s.user_id = u.id) AS check_in_count,
          (SELECT MAX(s.safety_support) FROM submissions s WHERE s.user_id = u.id) AS ever_safety,
          (SELECT COUNT(*) FROM submissions s WHERE s.user_id = u.id
             AND s.ai_status IS NOT NULL AND s.review_verdict IS NULL) AS pending_reviews,
          l.submitted_at AS last_at, l.mood_band, l.anxiety_band, l.stress_band,
          l.safety_support AS last_safety
        FROM users u
        LEFT JOIN submissions l
          ON l.id = (SELECT MAX(id) FROM submissions WHERE user_id = u.id)
        WHERE u.doctor_id = ? AND u.role = 'patient'
        ORDER BY (l.submitted_at IS NULL), l.submitted_at DESC, u.name
      `)
        .bind(user.id)
        .all();
      return json(
        {
          patients: (result.results ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            email: row.email,
            joinedAt: row.created_at,
            checkInCount: row.check_in_count,
            lastCheckInAt: row.last_at,
            latestBands: row.last_at
              ? { mood: row.mood_band, anxiety: row.anxiety_band, stress: row.stress_band }
              : null,
            latestSafetySupport: Boolean(row.last_safety),
            everSafetySupport: Boolean(row.ever_safety),
            pendingReviews: row.pending_reviews ?? 0,
          })),
        },
        200,
        origin,
      );
    }
    const match = path.match(/^\/api\/doctor\/patients\/(\d+)\/submissions$/);
    if (match && method === "GET") {
      // Only patients linked to this doctor are visible; anything else is a 404.
      const patient = await env.DB.prepare(
        "SELECT id, name, email FROM users WHERE id = ? AND role = 'patient' AND doctor_id = ?",
      )
        .bind(Number(match[1]), user.id)
        .first();
      if (!patient) return json({ error: "Patient not found." }, 404, origin);
      const result = await env.DB.prepare(
        `SELECT ${submissionColumns} FROM submissions
         WHERE user_id = ? ORDER BY id DESC LIMIT 200`,
      )
        .bind(patient.id)
        .all();
      return json(
        {
          patient: { id: patient.id, name: patient.name, email: patient.email },
          submissions: (result.results ?? []).map(mapSubmission),
        },
        200,
        origin,
      );
    }
    // The doctor marks whether the AI's advice for a check-in was right.
    const reviewMatch = path.match(/^\/api\/doctor\/submissions\/(\d+)\/review$/);
    if (reviewMatch && method === "POST") {
      const body = await readJson(request);
      const verdict = body?.verdict;
      const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
      if (verdict !== "appropriate" && verdict !== "needs_changes") {
        return json({ error: "Choose whether the AI advice was appropriate or needs changes." }, 400, origin);
      }
      if (notes.length > 1500) {
        return json({ error: "Notes must be 1500 characters or fewer." }, 400, origin);
      }
      if (verdict === "needs_changes" && notes.length < 10) {
        return json(
          { error: "Please explain what should change (at least 10 characters) so the patient gets the right advice." },
          400,
          origin,
        );
      }
      // Only check-ins from this doctor's own linked patients can be reviewed.
      const owned = await env.DB.prepare(`
        SELECT s.id FROM submissions s JOIN users p ON p.id = s.user_id
        WHERE s.id = ? AND p.role = 'patient' AND p.doctor_id = ?
      `)
        .bind(Number(reviewMatch[1]), user.id)
        .first();
      if (!owned) return json({ error: "Check-in not found." }, 404, origin);
      await env.DB.prepare(`
        UPDATE submissions SET review_verdict = ?, review_notes = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ?
      `)
        .bind(verdict, notes || null, user.id, new Date().toISOString(), owned.id)
        .run();
      const row = await env.DB.prepare(`SELECT ${submissionColumns} FROM submissions WHERE id = ?`)
        .bind(owned.id)
        .first();
      return json({ submission: mapSubmission(row) }, 200, origin);
    }
  }

  return json({ error: "Not found." }, 404, origin);
}
