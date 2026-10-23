const groups = [
  {
    title: "Mood",
    description: "Thinking about the last 2 weeks, how often did you experience each of these?",
    items: [
      "Had little interest or enjoyment in things you usually like",
      "Felt low, sad, or hopeless",
      "Had trouble falling asleep, staying asleep, or slept more than usual",
      "Felt tired or low on energy",
      "Felt bad about yourself, or felt you had let yourself or your family down",
      "Found it hard to focus, for example while reading or watching TV",
      "Felt you had little to look forward to",
    ],
    choices: ["Not at all", "A few days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Anxiety",
    description: "Thinking about the last 2 weeks, how often did you experience each of these?",
    items: [
      "Felt nervous, anxious, or on edge",
      "Found it hard to stop or control your worries",
      "Worried a lot about different things",
      "Found it hard to relax",
      "Felt afraid that something bad might happen",
      "Felt close to panicking",
    ],
    choices: ["Not at all", "A few days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Stress",
    description: "Thinking about the last 2 weeks, how often did you experience each of these?",
    items: [
      "Found it hard to calm down",
      "Reacted more strongly than you wanted to situations",
      "Felt full of nervous energy",
      "Felt irritated when something stopped you from getting on with what you were doing",
    ],
    choices: ["Not at all", "A few days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Safety",
    description: "Thinking about the last 2 weeks, how often did you experience this?",
    items: ["Had thoughts that you would be better off dead, or thoughts of hurting yourself"],
    choices: ["Not at all", "A few days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Unusual experiences",
    description: "Thinking about the last 2 weeks, how often did you experience each of these?",
    items: [
      "Heard or saw things that people around you did not seem to hear or see",
      "Felt that people were watching, following, or trying to hurt you without a clear reason",
      "Felt emotionally numb, pulled away from people, or lost interest in spending time with others",
    ],
    choices: ["Not at all", "A few days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Personality tendencies",
    description: "Thinking about the past few months, how often have these things been true for you?",
    items: [
      "My mood changes quickly or strongly, or I feel overwhelmed by emotions",
      "I avoid close relationships and prefer to keep some distance from others",
      "I sometimes act without thinking about what might happen next",
    ],
    choices: ["Not at all", "A few days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Functioning",
    description:
      "How difficult have these experiences made it to work or study, manage things at home, or get along with other people?",
    items: ["Overall, these experiences have made daily life difficult for me"],
    choices: ["Not at all difficult", "Somewhat difficult", "Very difficult", "Extremely difficult"],
  },
];

const form = document.querySelector("#assessment-form");
const groupContainer = document.querySelector("#question-groups");
const answeredCount = document.querySelector("#answered-count");
const progressFill = document.querySelector("#progress-fill");
const errorMessage = document.querySelector("#form-error");
const results = document.querySelector("#results");
const storageConsentInput = document.querySelector("#storage-consent");
const accountLinkConsentInput = document.querySelector("#account-link-consent");
let questionNumber = 1;

for (const group of groups) {
  const section = document.createElement("section");
  section.className = "question-section";
  const heading = document.createElement("h3");
  heading.textContent = group.title;
  const description = document.createElement("p");
  description.className = "section-description";
  description.textContent = group.description;
  section.append(heading, description);

  for (const prompt of group.items) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "question-card";
    const legend = document.createElement("legend");
    legend.className = "question-prompt";
    const number = document.createElement("span");
    number.className = "question-number";
    number.textContent = questionNumber;
    const text = document.createElement("span");
    text.textContent = prompt;
    legend.append(number, text);

    const options = document.createElement("div");
    options.className = "options";
    for (let score = 0; score <= 3; score += 1) {
      const label = document.createElement("label");
      label.className = "option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `q${questionNumber}`;
      input.value = score;
      input.required = true;
      const choice = document.createElement("span");
      choice.textContent = score;
      choice.setAttribute("aria-hidden", "true");
      input.setAttribute("aria-label", `${group.choices[score]} (${score})`);
      label.append(input, choice);
      options.append(label);
    }
    fieldset.append(legend, options);
    section.append(fieldset);
    questionNumber += 1;
  }
  groupContainer.append(section);
}

function updateProgress() {
  const answered = form.querySelectorAll("input[type=radio]:checked").length;
  answeredCount.textContent = answered;
  progressFill.style.width = `${(answered / 25) * 100}%`;
}

function updateAccountLinkConsent() {
  accountLinkConsentInput.disabled = !storageConsentInput.checked;
  if (!storageConsentInput.checked) accountLinkConsentInput.checked = false;
}

storageConsentInput.addEventListener("change", updateAccountLinkConsent);
updateAccountLinkConsent();

form.addEventListener("change", updateProgress);

function addAlert(className, title, content) {
  const alert = document.createElement("div");
  alert.className = `result-alert ${className}`;
  const heading = document.createElement("h3");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  alert.append(heading, paragraph);
  results.append(alert);
}

function renderResults(data) {
  results.replaceChildren();
  const topLine = document.createElement("div");
  topLine.className = "results-topline";
  const headingGroup = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "YOUR CHECK-IN";
  const heading = document.createElement("h2");
  heading.textContent = "Your responses, reflected";
  const intro = document.createElement("p");
  intro.className = "results-intro";
  intro.textContent = "These scores are a starting point for reflection, not a diagnosis.";
  headingGroup.append(eyebrow, heading, intro);
  topLine.append(headingGroup);
  results.append(topLine);

  if (data.safetySupport) {
    addAlert(
      "safety",
      "You deserve support right now",
      "Your response suggests you may be going through a difficult time. If you may act on thoughts of harming yourself or are in immediate danger, call your local emergency number or go to the nearest emergency department. In India, you can call Tele-MANAS at 14416 or 1-800-891-4416 for free, confidential mental health support. If you can, reach out to someone you trust and stay with them.",
    );
  }

  if (data.unusualExperienceReferral) {
    addAlert(
      "referral",
      "Consider talking with a mental health professional",
      "You noted an experience that may be worth discussing with a qualified mental health professional. They can listen and help you make sense of what you’re experiencing.",
    );
  }

  if (data.clinicianRecommendation) {
    addAlert(
      "support",
      "You don’t have to figure it out alone",
      "Some responses suggest that speaking with a mental health professional may be helpful. A qualified professional can offer support tailored to you.",
    );
  }

  if (data.aiSummaryStatus === "available" && data.aiSummary) {
    addAlert(
      "ai-summary",
      "Optional AI-generated reflection",
      data.aiSummary,
    );
    const aiDisclaimer = document.createElement("p");
    aiDisclaimer.className = "ai-disclaimer";
    aiDisclaimer.textContent =
      "Generated from combined Mood, Anxiety, and Stress totals and counts only. It may be inaccurate and is not a diagnosis or professional advice.";
    results.append(aiDisclaimer);
  } else if (data.aiSummaryStatus === "unavailable") {
    addAlert(
      "ai-summary-status",
      "Gemini reflection not configured",
      "The optional Gemini reflection is not configured yet. Your scores and summaries are still available.",
    );
  } else if (["empty-response", "model-error"].includes(data.aiSummaryStatus)) {
    addAlert(
      "ai-summary-status",
      "Generated reflection unavailable",
      "The optional generated reflection could not be created right now. Your scores and summaries are still available.",
    );
  } else if (data.aiSummaryStatus === "skipped-safety") {
    addAlert(
      "ai-summary-status",
      "Generated reflection not used",
      "To prioritize your safety, the optional generated reflection was not created. The supportive safety information above is based on your response.",
    );
  }

  const scoreList = document.createElement("div");
  scoreList.className = "score-list";
  for (const score of data.scores) {
    const card = document.createElement("div");
    card.className = "score-card";
    const name = document.createElement("span");
    name.className = "score-name";
    name.textContent = score.name;
    const total = document.createElement("span");
    total.className = "score-number";
    total.textContent = `${score.score} / ${score.max}`;
    const band = document.createElement("span");
    band.className = "score-band";
    band.textContent =
      score.key === "personality" ? `Descriptive · ${score.band}` : score.band;
    const meter = document.createElement("div");
    meter.className = "score-meter";
    meter.setAttribute("aria-label", `${score.name} score: ${score.band}`);
    const fill = document.createElement("span");
    fill.style.width = `${(score.score / score.max) * 100}%`;
    meter.append(fill);
    const summary = document.createElement("p");
    summary.className = "score-summary";
    summary.textContent = score.summary;
    card.append(name, total, band, meter, summary);
    scoreList.append(card);
  }
  results.append(scoreList);

  const functioning = document.createElement("div");
  functioning.className = "functioning-row";
  const functionLabel = document.createElement("span");
  functionLabel.textContent = "Impact on day-to-day life";
  const functionValue = document.createElement("span");
  functionValue.textContent = [
    "Not at all difficult",
    "Somewhat difficult",
    "Very difficult",
    "Extremely difficult",
  ][data.functioning.score];
  functioning.append(functionLabel, functionValue);
  results.append(functioning);

  const disclaimer = document.createElement("p");
  disclaimer.className = "results-disclaimer";
  disclaimer.textContent =
    "These are provisional bands for a new, unvalidated composite questionnaire. They are not clinical cutoffs, and personality tendencies describe responses only—not a clinical label. A screening result cannot diagnose a condition. If you’re concerned, please speak with a qualified professional.";
  results.append(disclaimer);

  const resetRow = document.createElement("div");
  resetRow.className = "submit-row";
  const resetNote = document.createElement("p");
  resetNote.textContent = data.saved
    ? data.accountLinked
      ? "Your response was saved with your research-storage and account-link consent."
      : "Your response was saved with your research-storage consent."
    : "Your responses were used to calculate these results and were not saved.";
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "button button-secondary";
  resetButton.textContent = "Start again";
  resetButton.addEventListener("click", () => {
    form.reset();
    updateAccountLinkConsent();
    updateProgress();
    results.hidden = true;
    form.closest(".form-shell").hidden = false;
    document.querySelector(".form-shell").scrollIntoView({ behavior: "smooth" });
  });
  resetRow.append(resetNote, resetButton);
  const guidance = document.createElement("section");
  guidance.className = "guidance-card";
  const guidanceHeading = document.createElement("h3");
  guidanceHeading.textContent = "A gentle next step";
  const guidanceList = document.createElement("ul");
  for (const suggestion of data.guidance) {
    const item = document.createElement("li");
    item.textContent = suggestion;
    guidanceList.append(item);
  }
  guidance.append(guidanceHeading, guidanceList);
  results.append(guidance);
  results.append(resetRow);
  results.hidden = false;
  form.closest(".form-shell").hidden = true;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  if (!form.reportValidity()) {
    errorMessage.textContent = "Please answer all 25 questions to see your check-in.";
    errorMessage.hidden = false;
    return;
  }

  const answers = {};
  for (let item = 1; item <= 25; item += 1) {
    answers[item] = Number(form.elements[`q${item}`].value);
  }

  const submitButton = form.querySelector('button[type="submit"]');
  const aiSummaryRequested = document.querySelector("#ai-summary-consent").checked;
  const storageConsent = storageConsentInput.checked;
  const linkAccountConsent = accountLinkConsentInput.checked;
  submitButton.disabled = true;
  submitButton.textContent = "Calculating…";
  try {
    const apiBase = (window.MIND_CHECKIN_API_BASE || "").replace(/\/+$/, "");
    const headers = { "Content-Type": "application/json" };
    const accountToken = window.MindfulAccount?.token;
    if (accountToken) {
      headers.Authorization = `Bearer ${accountToken}`;
    }
    const response = await fetch(`${apiBase}/api/assessment`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        answers,
        aiSummary: aiSummaryRequested,
        consentToStore: storageConsent,
        linkAccount:
          storageConsent &&
          linkAccountConsent &&
          Boolean(accountToken) &&
          window.MindfulAccount?.isSignedIn === true,
        researchConsent: storageConsent
          ? linkAccountConsent
            ? "18+ research storage consent and explicit account-link consent v4"
            : "18+ research storage consent; account email not linked v4"
          : undefined,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Your check-in could not be calculated.");
    renderResults(data);
  } catch (error) {
    errorMessage.textContent = `${error.message} Please try again.`;
    errorMessage.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'See my check-in <span aria-hidden="true">→</span>';
  }
});
