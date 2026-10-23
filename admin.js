const loginForm = document.querySelector("#admin-login");
const loginShell = document.querySelector(".admin-login-shell");
const passwordInput = document.querySelector("#admin-password");
const errorMessage = document.querySelector("#admin-error");
const dashboard = document.querySelector("#admin-dashboard");
const metrics = document.querySelector("#admin-metrics");
const accountRows = document.querySelector("#admin-account-rows");
const bandRows = document.querySelector("#admin-band-rows");
const records = document.querySelector("#admin-records");
let dashboardPassword = "";
let exportedSubmissions = [];

const sectionNames = {
  mood: "Mood",
  anxiety: "Anxiety",
  stress: "Stress",
  experiences: "Unusual experiences",
  personality: "Personality tendencies",
};

function apiUrl(path) {
  const base = (window.MIND_CHECKIN_API_BASE || "").replace(/\/+$/, "");
  return `${base}${path}`;
}

async function adminFetch(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set(
    "Authorization",
    `Basic ${btoa(`admin:${dashboardPassword}`)}`,
  );
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(apiUrl(path), {
    ...options,
    headers,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Dashboard request failed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function renderMetrics(summary) {
  metrics.replaceChildren();
  const definitions = [
    ["Saved submissions", "total"],
    ["Verified participant accounts", "account_count"],
    ["Mood: Moderate / High", "mood_moderate_high"],
    ["Anxiety: Moderate / High", "anxiety_moderate_high"],
    ["Stress: Moderate / High", "stress_moderate_high"],
    ["Unusual experiences: Moderate / High", "experiences_moderate_high"],
    ["Personality tendencies: Moderate / High", "personality_moderate_high"],
    ["Safety-support triggers", "safety_support_count"],
    ["Functioning-support responses", "functioning_support_count"],
  ];
  for (const [label, key] of definitions) {
    const card = document.createElement("article");
    card.className = "admin-metric";
    const value = document.createElement("strong");
    value.textContent = summary[key] ?? 0;
    const caption = document.createElement("span");
    caption.textContent = label;
    card.append(value, caption);
    metrics.append(card);
  }
}

function renderAccounts(accounts) {
  accountRows.replaceChildren();
  if (accounts.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "No verified participant accounts yet.";
    row.append(cell);
    accountRows.append(row);
    return;
  }
  for (const account of accounts) {
    const row = document.createElement("tr");
    const email = document.createElement("td");
    email.textContent = account.email;
    const registered = document.createElement("td");
    registered.textContent = new Date(account.created_at).toLocaleDateString();
    const linked = document.createElement("td");
    linked.textContent = account.linked_submission_count;
    row.append(email, registered, linked);
    accountRows.append(row);
  }
}

function renderBandRows(rows, total) {
  bandRows.replaceChildren();
  const bySection = new Map();
  for (const row of rows) {
    if (!bySection.has(row.category)) bySection.set(row.category, []);
    bySection.get(row.category).push(row);
  }

  for (const [section, name] of Object.entries(sectionNames)) {
    const counts = new Map(
      (bySection.get(name) ?? []).map(({ band, count }) => [band, count]),
    );
    for (const band of ["Low", "Mild", "Moderate", "High"]) {
      const row = document.createElement("tr");
      const sectionCell = document.createElement("td");
      sectionCell.textContent = band === "Low" ? name : "";
      const bandCell = document.createElement("td");
      bandCell.textContent = band;
      const countCell = document.createElement("td");
      countCell.textContent = `${counts.get(band) ?? 0} / ${total}`;
      row.append(sectionCell, bandCell, countCell);
      bandRows.append(row);
    }
  }
}

function renderRecords(submissions) {
  exportedSubmissions = submissions;
  records.replaceChildren();
  if (submissions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-note";
    empty.textContent = "No consented submissions have been saved yet.";
    records.append(empty);
    return;
  }

  for (const submission of submissions) {
    const card = document.createElement("details");
    card.className = "admin-record";
    const summary = document.createElement("summary");
    const scores = Object.fromEntries(
      submission.scores.map(({ key, band }) => [key, band]),
    );
    const accountLabel = submission.accountEmail
      ? ` · Linked account ${submission.accountEmail}`
      : " · Anonymous";
    summary.textContent = `#${submission.id} · ${new Date(
      submission.submittedAt,
    ).toLocaleString()}${accountLabel} · Mood ${scores.mood}, Anxiety ${scores.anxiety}, Stress ${scores.stress}`;
    const details = document.createElement("div");
    details.className = "admin-record-details";
    const scoreList = document.createElement("ul");
    for (const score of submission.scores) {
      const item = document.createElement("li");
      item.textContent = `${score.name}: ${score.score}/${score.max} (${score.band})`;
      scoreList.append(item);
    }
    const answerList = document.createElement("ol");
    for (let question = 1; question <= 25; question += 1) {
      const item = document.createElement("li");
      item.textContent = `Question ${question}: ${submission.answers[question]}`;
      answerList.append(item);
    }
    const flags = document.createElement("p");
    flags.textContent = [
      `Consent: ${submission.researchConsent || submission.consentVersion}`,
      submission.safetySupport ? "Safety support triggered" : "",
      submission.unusualExperienceReferral
        ? "Unusual-experience referral prompt triggered"
        : "",
      `Functioning response: ${submission.functioningScore}/3`,
    ]
      .filter(Boolean)
      .join(" · ");
    details.append(scoreList, flags, answerList);
    card.append(summary, details);
    records.append(card);
  }
}

async function loadDashboard() {
  const [summaryData, accountData, submissionData] = await Promise.all([
    adminFetch("/api/admin/summary"),
    adminFetch("/api/admin/accounts"),
    adminFetch("/api/admin/submissions?limit=500"),
  ]);
  renderMetrics(summaryData.summary);
  renderAccounts(accountData.accounts);
  renderBandRows(summaryData.bands, summaryData.summary.total);
  renderRecords(submissionData.submissions);
  dashboard.hidden = false;
  loginShell.hidden = true;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  dashboardPassword = passwordInput.value;
  try {
    await loadDashboard();
  } catch (error) {
    dashboardPassword = "";
    if (error.status === 401) {
      showError("That password wasn’t accepted. Please try again.");
    } else {
      showError(error.message);
    }
  } finally {
    passwordInput.value = "";
  }
});

document.querySelector("#admin-logout").addEventListener("click", () => {
  dashboardPassword = "";
  dashboard.hidden = true;
  loginShell.hidden = false;
  metrics.replaceChildren();
  accountRows.replaceChildren();
  bandRows.replaceChildren();
  records.replaceChildren();
  exportedSubmissions = [];
  passwordInput.focus();
});

document.querySelector("#admin-export").addEventListener("click", () => {
  const file = new Blob([JSON.stringify(exportedSubmissions, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = "mindful-checkin-submissions.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

document.querySelector("#admin-delete").addEventListener("click", async () => {
  if (!window.confirm("Permanently delete every saved response? This cannot be undone.")) {
    return;
  }
  try {
    const result = await adminFetch("/api/admin/submissions", {
      method: "DELETE",
      body: JSON.stringify({ confirm: "DELETE ALL" }),
    });
    window.alert(`Deleted ${result.deleted} saved response(s).`);
    await loadDashboard();
  } catch (error) {
    showError(error.message);
  }
});
