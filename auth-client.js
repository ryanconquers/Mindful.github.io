// Shared browser helpers for sign-in state, API calls, the header account
// menu, and rendering a saved check-in. Loaded on every page.
(() => {
  const storageKey = "mindful.session";
  let memorySession = null;

  const questions = [
    "Had little interest or enjoyment in things you usually like",
    "Felt low, sad, or hopeless",
    "Had trouble falling asleep, staying asleep, or slept more than usual",
    "Felt tired or low on energy",
    "Felt bad about yourself, or felt you had let yourself or your family down",
    "Found it hard to focus, for example while reading or watching TV",
    "Felt you had little to look forward to",
    "Felt nervous, anxious, or on edge",
    "Found it hard to stop or control your worries",
    "Worried a lot about different things",
    "Found it hard to relax",
    "Felt afraid that something bad might happen",
    "Felt close to panicking",
    "Found it hard to calm down",
    "Reacted more strongly than you wanted to situations",
    "Felt full of nervous energy",
    "Felt irritated when something stopped you from getting on with what you were doing",
    "Had thoughts that you would be better off dead, or thoughts of hurting yourself",
    "Heard or saw things that people around you did not seem to hear or see",
    "Felt that people were watching, following, or trying to hurt you without a clear reason",
    "Felt emotionally numb, pulled away from people, or lost interest in spending time with others",
    "My mood changes quickly or strongly, or I feel overwhelmed by emotions",
    "I avoid close relationships and prefer to keep some distance from others",
    "I sometimes act without thinking about what might happen next",
    "Overall, these experiences have made daily life difficult for me",
  ];
  const frequencyLabels = ["Not at all", "A few days", "More than half the days", "Nearly every day"];
  const difficultyLabels = ["Not at all difficult", "Somewhat difficult", "Very difficult", "Extremely difficult"];

  function getSession() {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const session = JSON.parse(raw);
        if (session?.token && session?.user && new Date(session.expiresAt) > new Date()) {
          return session;
        }
        sessionStorage.removeItem(storageKey);
      }
    } catch {
      // storage unavailable: fall back to memory below
    }
    if (memorySession && new Date(memorySession.expiresAt) > new Date()) return memorySession;
    return null;
  }

  function setSession(session) {
    memorySession = session;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(session));
    } catch {
      // keep the in-memory copy
    }
  }

  function clearSession() {
    memorySession = null;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // nothing to clear
    }
  }

  function apiUrl(path) {
    const base = (window.MIND_CHECKIN_API_BASE || "").replace(/\/+$/, "");
    return `${base}${path}`;
  }

  async function api(path, { method = "GET", body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const session = getSession();
    if (auth && session) headers.Authorization = `Bearer ${session.token}`;
    let response;
    try {
      response = await fetch(apiUrl(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    let data = {};
    try {
      data = await response.json();
    } catch {
      // non-JSON error body
    }
    if (!response.ok) {
      if (response.status === 401 && auth && session) clearSession();
      const error = new Error(data.error || "Something went wrong. Please try again.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function home(role) {
    return role === "doctor" ? "./doctor.html" : "./index.html";
  }

  // Redirects to sign-in unless the visitor has the given role.
  function requireRole(role) {
    const session = getSession();
    if (!session) {
      window.location.replace("./login.html");
      return null;
    }
    if (session.user.role !== role) {
      window.location.replace(home(session.user.role));
      return null;
    }
    return session;
  }

  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // the local session is cleared either way
    }
    clearSession();
    window.location.href = "./login.html";
  }

  function renderNav() {
    const nav = document.querySelector("#account-nav");
    if (!nav) return;
    nav.replaceChildren();
    const session = getSession();
    const link = (href, text, className = "") => {
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.textContent = text;
      if (className) anchor.className = className;
      return anchor;
    };
    if (!session) {
      nav.append(link("./login.html", "Sign in", "account-nav-link"));
      return;
    }
    if (session.user.role === "patient") {
      nav.append(link("./index.html", "Check-in", "account-nav-link"));
      nav.append(link("./records.html", "My check-ins", "account-nav-link"));
    } else {
      nav.append(link("./doctor.html", "My patients", "account-nav-link"));
    }
    const who = document.createElement("span");
    who.className = "account-nav-name";
    who.textContent = session.user.name;
    const out = document.createElement("button");
    out.type = "button";
    out.className = "account-nav-signout";
    out.textContent = "Sign out";
    out.addEventListener("click", signOut);
    nav.append(who, out);
  }

  function text(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = content;
    return element;
  }

  // One saved check-in as an expandable card (used by patients and doctors).
  function renderSubmission(submission) {
    const card = document.createElement("details");
    card.className = "admin-record";
    const bands = Object.fromEntries(submission.scores.map(({ key, band }) => [key, band]));
    const summary = document.createElement("summary");
    summary.append(
      `${new Date(submission.submittedAt).toLocaleString()} · Mood ${bands.mood}, Anxiety ${bands.anxiety}, Stress ${bands.stress}`,
    );
    if (submission.safetySupport) {
      summary.append(" ", text("span", "badge badge-alert", "Safety flag"));
    }
    const details = document.createElement("div");
    details.className = "admin-record-details";
    const scoreList = document.createElement("ul");
    for (const score of submission.scores) {
      scoreList.append(text("li", "", `${score.name}: ${score.score}/${score.max} (${score.band})`));
    }
    const flags = [];
    if (submission.safetySupport) flags.push("The safety-support message was triggered for this check-in.");
    if (submission.unusualExperienceReferral) flags.push("Unusual-experience referral prompt was triggered.");
    flags.push(`Impact on daily life: ${difficultyLabels[submission.functioningScore] ?? submission.functioningScore}.`);
    const answerList = document.createElement("ol");
    answerList.className = "record-answers";
    questions.forEach((question, index) => {
      const value = submission.answers[index + 1];
      const label = (index === 24 ? difficultyLabels : frequencyLabels)[value];
      answerList.append(text("li", "", `${question} — ${value} (${label})`));
    });
    details.append(scoreList, text("p", "", flags.join(" ")), answerList);
    card.append(summary, details);
    return card;
  }

  window.MindfulAuth = {
    getSession, setSession, clearSession, api, requireRole, home, signOut, renderNav, renderSubmission,
  };
  document.addEventListener("DOMContentLoaded", renderNav);
})();
