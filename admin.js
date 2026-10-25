const loginForm = document.querySelector("#admin-login");
const loginShell = document.querySelector(".admin-login-shell");
const passwordInput = document.querySelector("#admin-password");
const errorMessage = document.querySelector("#admin-error");
const dashboard = document.querySelector("#admin-dashboard");
const dashboardStatus = document.querySelector("#admin-dashboard-status");
const refreshButton = document.querySelector("#admin-refresh");
const metrics = document.querySelector("#admin-metrics");
const bandCharts = document.querySelector("#admin-band-charts");
const submissionTrend = document.querySelector("#admin-submission-trend");
const accountRows = document.querySelector("#admin-account-rows");
const bandRows = document.querySelector("#admin-band-rows");
const records = document.querySelector("#admin-records");
let dashboardPassword = "";
let exportedSubmissions = [];
let analyticsData = null;
let analyticsRange = "7";
let analyticsCategory = "all";
let analyticsStatus = "all";
let analyticsTimer = null;
let dashboardLoading = false;

const sectionNames = {
  mood: "Mood",
  anxiety: "Anxiety",
  stress: "Stress",
  experiences: "Unusual experiences",
  personality: "Personality tendencies",
};
const scoreBands = ["Low", "Mild", "Moderate", "High"];

function installAnalyticsStyles() {
  if (document.querySelector("#admin-analytics-styles")) return;
  const style = document.createElement("style");
  style.id = "admin-analytics-styles";
  style.textContent = `
    .admin-analytics { margin-top: 2rem; }
    .admin-analytics-controls { display: flex; flex-wrap: wrap; align-items: end; gap: .75rem; margin: 1rem 0; }
    .admin-analytics-controls label { display: grid; gap: .35rem; color: #53615b; font-size: .85rem; }
    .admin-analytics-controls select, .admin-analytics-controls input { min-height: 2.5rem; padding: .45rem .65rem; border: 1px solid #ccd5ce; border-radius: .5rem; background: #fff; color: #26362f; font: inherit; }
    .admin-analytics-controls [hidden] { display: none; }
    .admin-analytics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr)); gap: 1rem; }
    .admin-analytics-card { min-width: 0; padding: 1.1rem; border: 1px solid #e0e6e1; border-radius: .8rem; background: #fff; }
    .admin-analytics-card h4 { margin: 0 0 .9rem; color: #26362f; }
    .admin-analytics-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: .75rem; margin: 1rem 0; }
    .admin-analytics-kpi { padding: 1rem; border: 1px solid #e0e6e1; border-radius: .8rem; background: #fff; }
    .admin-analytics-kpi strong { display: block; color: #26362f; font-size: 1.5rem; }
    .admin-analytics-kpi span, .admin-analytics-state { color: #68766f; font-size: .86rem; }
    .admin-analytics-bars { display: grid; gap: .65rem; }
    .admin-analytics-bar-row { display: grid; grid-template-columns: minmax(6rem, 9rem) 1fr auto; align-items: center; gap: .6rem; font-size: .85rem; }
    .admin-analytics-track { height: .65rem; overflow: hidden; border-radius: 1rem; background: #edf1ed; }
    .admin-analytics-fill { height: 100%; border-radius: inherit; background: #719c83; }
    .admin-analytics-table { width: 100%; border-collapse: collapse; font-size: .88rem; }
    .admin-analytics-table th, .admin-analytics-table td { padding: .55rem .35rem; border-bottom: 1px solid #e8ece8; text-align: left; overflow-wrap: anywhere; }
    .admin-analytics-table th { color: #68766f; font-weight: 600; }
    .admin-analytics-trend { display: flex; align-items: end; gap: .3rem; height: 12rem; padding-top: .5rem; }
    .admin-analytics-day { display: flex; flex: 1; min-width: 0; height: 100%; flex-direction: column; justify-content: end; align-items: center; gap: .3rem; color: #68766f; font-size: .7rem; }
    .admin-analytics-day-bar { width: min(100%, 1.5rem); min-height: 2px; border-radius: .3rem .3rem 0 0; background: #719c83; }
    @media (max-width: 640px) { .admin-analytics-bar-row { grid-template-columns: 6rem 1fr auto; } .admin-analytics-table { font-size: .78rem; } }
  `;
  document.head.append(style);
}

function mountAnalytics() {
  if (document.querySelector("#admin-analytics")) return;
  installAnalyticsStyles();
  const section = document.createElement("section");
  section.id = "admin-analytics";
  section.className = "admin-analytics";
  section.setAttribute("aria-labelledby", "admin-analytics-title");
  section.innerHTML = `
    <div class="admin-heading-row">
      <div><h3 id="admin-analytics-title" class="admin-subheading">Analytics</h3>
      <p id="admin-analytics-note" class="admin-note">Live analysis of saved responses returned by the dashboard API (up to 5,000 latest submissions and 500 participant accounts).</p></div>
      <button id="admin-analytics-refresh" class="button button-secondary" type="button">Refresh analytics</button>
    </div>
    <div class="admin-analytics-controls">
      <label>Date range <select id="admin-analytics-range"><option value="today">Today</option><option value="7" selected>Last 7 days</option><option value="30">Last 30 days</option><option value="custom">Custom</option></select></label>
      <label id="admin-analytics-from-wrap" hidden>From <input id="admin-analytics-from" type="date"></label>
      <label id="admin-analytics-to-wrap" hidden>To <input id="admin-analytics-to" type="date"></label>
      <label>Question category <select id="admin-analytics-category"><option value="all">All categories</option><option value="mood">Mood</option><option value="anxiety">Anxiety</option><option value="stress">Stress</option><option value="experiences">Unusual experiences</option><option value="personality">Personality tendencies</option></select></label>
      <label>Response status <select id="admin-analytics-status"><option value="all">All responses</option><option value="safety">Safety-support flag</option><option value="referral">Referral flag</option></select></label>
    </div>
    <div id="admin-analytics-kpis" class="admin-analytics-kpis" aria-live="polite"></div>
    <div class="admin-analytics-grid">
      <article class="admin-analytics-card"><h4>Submission trend</h4><div id="admin-analytics-trend"></div></article>
      <article class="admin-analytics-card"><h4>Score-band breakdown</h4><div id="admin-analytics-breakdown"></div></article>
      <article class="admin-analytics-card"><h4>Top participants by linked responses</h4><div id="admin-analytics-top"></div></article>
    </div>`;
  metrics.after(section);
  document.querySelector("#admin-analytics-range").addEventListener("change", (event) => {
    analyticsRange = event.target.value;
    const custom = analyticsRange === "custom";
    document.querySelector("#admin-analytics-from-wrap").hidden = !custom;
    document.querySelector("#admin-analytics-to-wrap").hidden = !custom;
    renderAnalytics();
  });
  for (const [selector, key] of [["#admin-analytics-category", "category"], ["#admin-analytics-status", "status"]]) {
    document.querySelector(selector).addEventListener("change", (event) => {
      if (key === "category") analyticsCategory = event.target.value;
      else analyticsStatus = event.target.value;
      renderAnalytics();
    });
  }
  for (const selector of ["#admin-analytics-from", "#admin-analytics-to"]) {
    document.querySelector(selector).addEventListener("change", renderAnalytics);
  }
  document.querySelector("#admin-analytics-refresh").addEventListener("click", refreshAnalytics);
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function analyticsPeriod() {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  let start = new Date(today);
  if (analyticsRange === "today") start.setHours(0, 0, 0, 0);
  else if (analyticsRange === "custom") {
    const from = document.querySelector("#admin-analytics-from").value;
    const to = document.querySelector("#admin-analytics-to").value;
    if (!from || !to) return null;
    start = new Date(`${from}T00:00:00`);
    today.setTime(new Date(`${to}T23:59:59.999`).getTime());
  } else {
    start.setDate(start.getDate() - (Number(analyticsRange) - 1));
    start.setHours(0, 0, 0, 0);
  }
  if (Number.isNaN(start.getTime()) || start > today) return null;
  const duration = today.getTime() - start.getTime() + 1;
  return { start, end: today, previousStart: new Date(start.getTime() - duration), previousEnd: new Date(start.getTime() - 1) };
}

function aggregateAnalytics(submissions, accounts, period) {
  const inRange = (date, start, end) => date >= start && date <= end;
  const timestamp = (row) => new Date(row.submittedAt);
  const matching = submissions.filter((row) => {
    const date = timestamp(row);
    const statusMatch = analyticsStatus === "all" || (analyticsStatus === "safety" ? row.safetySupport : row.unusualExperienceReferral);
    return !Number.isNaN(date.getTime()) && inRange(date, period.start, period.end) && statusMatch;
  });
  const previousCount = submissions.filter((row) => {
    const date = timestamp(row);
    const statusMatch = analyticsStatus === "all" || (analyticsStatus === "safety" ? row.safetySupport : row.unusualExperienceReferral);
    return !Number.isNaN(date.getTime()) && inRange(date, period.previousStart, period.previousEnd) && statusMatch;
  }).length;
  const monthly = period.end.getTime() - period.start.getTime() > 62 * 24 * 60 * 60 * 1000;
  const bucketKey = (date) => monthly ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : localDateKey(date);
  const countsByDay = new Map();
  if (monthly) {
    const cursor = new Date(period.start.getFullYear(), period.start.getMonth(), 1);
    while (cursor <= period.end) {
      countsByDay.set(bucketKey(cursor), 0);
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    const cursor = new Date(period.start);
    while (cursor <= period.end) {
      countsByDay.set(bucketKey(cursor), 0);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  for (const row of matching) {
    const key = bucketKey(timestamp(row));
    if (countsByDay.has(key)) countsByDay.set(key, countsByDay.get(key) + 1);
  }
  const bands = new Map(scoreBands.map((band) => [band, 0]));
  let categoryTotal = 0;
  for (const row of matching) {
    const score = (row.scores ?? []).find((item) => item.key === analyticsCategory);
    if (analyticsCategory === "all") {
      for (const item of row.scores ?? []) {
        if (bands.has(item.band)) { bands.set(item.band, bands.get(item.band) + 1); categoryTotal += 1; }
      }
    } else if (score && bands.has(score.band)) {
      bands.set(score.band, bands.get(score.band) + 1);
      categoryTotal += 1;
    }
  }
  const linked = new Map();
  for (const row of matching) if (row.accountEmail) linked.set(row.accountEmail, (linked.get(row.accountEmail) ?? 0) + 1);
  const accountCount = accounts.filter((account) => {
    const created = new Date(account.created_at);
    return !Number.isNaN(created.getTime()) && inRange(created, period.start, period.end);
  }).length;
  return { matching, previousCount, countsByDay, bands, categoryTotal, top: [...linked].sort((a, b) => b[1] - a[1]).slice(0, 10), accountCount };
}

function widgetState(element, message) {
  element.replaceChildren();
  const state = document.createElement("p");
  state.className = "admin-analytics-state";
  state.textContent = message;
  element.append(state);
}

function setAnalyticsState(message) {
  for (const selector of ["#admin-analytics-kpis", "#admin-analytics-trend", "#admin-analytics-breakdown", "#admin-analytics-top"]) {
    const element = document.querySelector(selector);
    if (element) widgetState(element, message);
  }
}

function renderAnalytics() {
  if (!analyticsData) return;
  const period = analyticsPeriod();
  const kpis = document.querySelector("#admin-analytics-kpis");
  const trend = document.querySelector("#admin-analytics-trend");
  const breakdown = document.querySelector("#admin-analytics-breakdown");
  const top = document.querySelector("#admin-analytics-top");
  if (!period) {
    for (const element of [kpis, trend, breakdown, top]) widgetState(element, "Choose a valid date range to view analytics.");
    return;
  }
  const data = aggregateAnalytics(analyticsData.submissions, analyticsData.accounts, period);
  const growth = data.previousCount ? ((data.matching.length - data.previousCount) / data.previousCount) * 100 : null;
  kpis.replaceChildren();
  const cards = [
    ["Saved responses", data.matching.length],
    ["Accounts registered in range", data.accountCount],
    ["Change vs previous period", growth === null ? (data.matching.length ? "New" : "—") : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`],
    ["Safety-support flags", data.matching.filter((row) => row.safetySupport).length],
  ];
  for (const [label, value] of cards) {
    const card = document.createElement("article"); card.className = "admin-analytics-kpi";
    const strong = document.createElement("strong"); strong.textContent = value;
    const caption = document.createElement("span"); caption.textContent = label;
    card.append(strong, caption); kpis.append(card);
  }
  trend.replaceChildren();
  if (!data.matching.length) widgetState(trend, "No saved responses in this range.");
  else {
    const chart = document.createElement("div"); chart.className = "admin-analytics-trend";
    const maximum = Math.max(1, ...data.countsByDay.values());
    for (const [date, count] of data.countsByDay) {
      const day = document.createElement("div"); day.className = "admin-analytics-day";
      const bar = document.createElement("span"); bar.className = "admin-analytics-day-bar";
      bar.style.height = `${count ? Math.max(count / maximum * 100, 4) : 0}%`;
      bar.title = `${date}: ${count} responses`; bar.setAttribute("aria-label", `${date}: ${count} responses`);
      if ([...data.countsByDay.keys()].length <= 14 || date.endsWith("-01")) { const label = document.createElement("span"); label.textContent = date.slice(5); day.append(label); }
      day.append(bar); chart.append(day);
    }
    trend.append(chart);
  }
  breakdown.replaceChildren();
  if (!data.categoryTotal) widgetState(breakdown, "No category scores in this range.");
  else {
    const list = document.createElement("div"); list.className = "admin-analytics-bars";
    for (const [band, count] of data.bands) {
      const row = document.createElement("div"); row.className = "admin-analytics-bar-row";
      const label = document.createElement("span"); label.textContent = band;
      const track = document.createElement("div"); track.className = "admin-analytics-track";
      const fill = document.createElement("div"); fill.className = "admin-analytics-fill";
      fill.style.width = `${count / data.categoryTotal * 100}%`; track.append(fill);
      const value = document.createElement("span"); value.textContent = `${count} (${Math.round(count / data.categoryTotal * 100)}%)`;
      row.append(label, track, value); list.append(row);
    }
    breakdown.append(list);
  }
  top.replaceChildren();
  if (!data.top.length) widgetState(top, "No account-linked responses in this range.");
  else {
    const table = document.createElement("table"); table.className = "admin-analytics-table";
    const head = document.createElement("thead"); head.innerHTML = "<tr><th>Participant</th><th>Responses</th></tr>";
    const body = document.createElement("tbody");
    for (const [email, count] of data.top) { const row = document.createElement("tr"); const name = document.createElement("td"); name.textContent = email; const value = document.createElement("td"); value.textContent = count; row.append(name, value); body.append(row); }
    table.append(head, body); top.append(table);
  }
}

async function refreshAnalytics() {
  const button = document.querySelector("#admin-analytics-refresh");
  button.disabled = true;
  for (const selector of ["#admin-analytics-kpis", "#admin-analytics-trend", "#admin-analytics-breakdown", "#admin-analytics-top"]) widgetState(document.querySelector(selector), "Loading live data…");
  try {
    const [submissionData, accountData] = await Promise.all([
      adminFetch("/api/admin/submissions?limit=5000"),
      adminFetch("/api/admin/accounts"),
    ]);
    analyticsData = { submissions: submissionData.submissions, accounts: accountData.accounts };
    renderAnalytics();
    document.querySelector("#admin-analytics-note").textContent = `Live analysis of ${analyticsData.submissions.length} returned submissions (up to 5,000 latest) and ${analyticsData.accounts.length} returned accounts (up to 500).`;
  } catch (error) {
    for (const selector of ["#admin-analytics-kpis", "#admin-analytics-trend", "#admin-analytics-breakdown", "#admin-analytics-top"]) widgetState(document.querySelector(selector), `Could not load analytics: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

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
    ["Registered participant accounts", "account_count"],
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
    cell.textContent = "Patient account identities are hidden in this research dashboard.";
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
    for (const band of scoreBands) {
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

function renderBandCharts(rows) {
  bandCharts.replaceChildren();
  const bySection = new Map();
  for (const { category, band, count } of rows) {
    if (!bySection.has(category)) bySection.set(category, new Map());
    bySection.get(category).set(band, Number(count) || 0);
  }

  for (const name of Object.values(sectionNames)) {
    const counts = bySection.get(name) ?? new Map();
    const total = scoreBands.reduce(
      (sum, band) => sum + (counts.get(band) ?? 0),
      0,
    );
    const row = document.createElement("div");
    row.className = "admin-band-chart-row";
    const label = document.createElement("div");
    label.className = "admin-band-chart-label";
    label.textContent = name;
    const track = document.createElement("div");
    track.className = "admin-stacked-bar";
    track.setAttribute(
      "role",
      "img",
    );
    track.setAttribute(
      "aria-label",
      `${name}: ${scoreBands.map((band) => `${band} ${counts.get(band) ?? 0}`).join(", ")}`,
    );
    for (const band of scoreBands) {
      const count = counts.get(band) ?? 0;
      const segment = document.createElement("span");
      segment.className = `admin-stacked-segment band-${band.toLowerCase()}`;
      segment.style.width = `${total ? (count / total) * 100 : 0}%`;
      if (count) segment.title = `${band}: ${count}`;
      track.append(segment);
    }
    const legend = document.createElement("div");
    legend.className = "admin-chart-legend";
    for (const band of scoreBands) {
      const item = document.createElement("span");
      item.className = "admin-chart-legend-item";
      const swatch = document.createElement("i");
      swatch.className = `admin-chart-swatch band-${band.toLowerCase()}`;
      swatch.setAttribute("aria-hidden", "true");
      const percentage = total
        ? Math.round(((counts.get(band) ?? 0) / total) * 100)
        : 0;
      const text = document.createElement("span");
      text.textContent = `${band} ${counts.get(band) ?? 0} (${percentage}%)`;
      item.append(swatch, text);
      legend.append(item);
    }
    row.append(label, track, legend);
    bandCharts.append(row);
  }
}

function renderSubmissionTrend(submissions) {
  submissionTrend.replaceChildren();
  if (submissions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-chart-empty";
    empty.textContent = "No saved submissions in the latest 500 records.";
    submissionTrend.append(empty);
    return;
  }
  const now = new Date();
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (13 - index));
    return date;
  });
  const formatDateKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const countsByDay = new Map(days.map((date) => [formatDateKey(date), 0]));
  for (const submission of submissions) {
    const date = new Date(submission.submittedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = formatDateKey(date);
    if (countsByDay.has(key)) {
      countsByDay.set(key, countsByDay.get(key) + 1);
    }
  }
  const maximum = Math.max(1, ...countsByDay.values());
  for (const [index, date] of days.entries()) {
    const count = countsByDay.get(formatDateKey(date)) ?? 0;
    const column = document.createElement("div");
    column.className = "admin-trend-column";
    const barArea = document.createElement("div");
    barArea.className = "admin-trend-bar-area";
    const bar = document.createElement("span");
    bar.className = "admin-trend-bar";
    bar.setAttribute("role", "img");
    bar.style.height = `${count ? Math.max((count / maximum) * 100, 4) : 0}%`;
    bar.setAttribute(
      "aria-label",
      `${date.toLocaleDateString()}: ${count} saved ${count === 1 ? "submission" : "submissions"}`,
    );
    bar.title = `${date.toLocaleDateString()}: ${count}`;
    const value = document.createElement("span");
    value.className = "admin-trend-count";
    value.textContent = count || "";
    barArea.append(bar, value);
    const dateLabel = document.createElement("span");
    dateLabel.className = "admin-trend-date";
    dateLabel.textContent =
      index % 2 === 0 || index === days.length - 1
        ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "";
    column.append(barArea, dateLabel);
    submissionTrend.append(column);
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
  if (dashboardLoading) return;
  dashboardLoading = true;
  try {
  if (document.querySelector("#admin-analytics")) setAnalyticsState("Loading live data…");
  const [summaryData, accountData, submissionData] = await Promise.all([
    adminFetch("/api/admin/summary"),
    adminFetch("/api/admin/accounts"),
    adminFetch("/api/admin/submissions?limit=5000"),
  ]);
  renderMetrics(summaryData.summary);
  renderAccounts(accountData.accounts);
  renderBandRows(summaryData.bands, summaryData.summary.total);
  renderBandCharts(summaryData.bands);
  renderSubmissionTrend(submissionData.submissions);
  renderRecords(submissionData.submissions);
  mountAnalytics();
  analyticsData = { submissions: submissionData.submissions, accounts: accountData.accounts };
  renderAnalytics();
  document.querySelector("#admin-analytics-note").textContent = `Live analysis of ${submissionData.submissions.length} returned submissions (up to 5,000 latest) and ${accountData.accounts.length} returned accounts (up to 500).`;
  dashboard.hidden = false;
  loginShell.hidden = true;
  dashboardStatus.textContent = `Dashboard refreshed ${new Date().toLocaleTimeString()}. Showing ${submissionData.submissions.length} of ${summaryData.summary.total} saved submissions.`;
  dashboardStatus.hidden = false;
  if (analyticsTimer) clearInterval(analyticsTimer);
  analyticsTimer = setInterval(() => {
    if (!dashboard.hidden && !document.hidden) {
      loadDashboard().catch((error) => {
        dashboardStatus.textContent = `Automatic refresh failed: ${error.message}`;
        setAnalyticsState(`Could not load analytics: ${error.message}`);
      });
    }
  }, 45000);
  } finally {
    dashboardLoading = false;
  }
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

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  dashboardStatus.textContent = "Refreshing dashboard…";
  dashboardStatus.hidden = false;
  try {
    await loadDashboard();
  } catch (error) {
    dashboardStatus.textContent = `Refresh failed: ${error.message}`;
    setAnalyticsState(`Could not load analytics: ${error.message}`);
  } finally {
    refreshButton.disabled = false;
  }
});

document.querySelector("#admin-logout").addEventListener("click", () => {
  if (analyticsTimer) clearInterval(analyticsTimer);
  analyticsTimer = null;
  analyticsData = null;
  dashboardPassword = "";
  dashboard.hidden = true;
  loginShell.hidden = false;
  dashboardStatus.hidden = true;
  metrics.replaceChildren();
  accountRows.replaceChildren();
  bandRows.replaceChildren();
  bandCharts.replaceChildren();
  submissionTrend.replaceChildren();
  document.querySelector("#admin-analytics")?.remove();
  records.replaceChildren();
  exportedSubmissions = [];
  passwordInput.focus();
});

window.addEventListener("pagehide", () => {
  if (analyticsTimer) clearInterval(analyticsTimer);
  analyticsTimer = null;
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
