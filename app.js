const groups = [
  {
    title: "Mood",
    description: "Over the last 2 weeks, how often have you been bothered by:",
    items: [
      "Little interest or pleasure in doing things",
      "Feeling down, depressed, or hopeless",
      "Trouble falling or staying asleep, or sleeping too much",
      "Feeling tired or having little energy",
      "Feeling bad about yourself, or that you are a failure or have let yourself or your family down",
      "Trouble concentrating on things, such as reading or watching TV",
      "Feeling that you had nothing to look forward to",
    ],
    choices: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Anxiety",
    description: "Over the last 2 weeks, how often have you been bothered by:",
    items: [
      "Feeling nervous, anxious, or on edge",
      "Not being able to stop or control worrying",
      "Worrying too much about different things",
      "Trouble relaxing",
      "Feeling afraid as if something awful might happen",
      "Feeling close to panic",
    ],
    choices: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Stress",
    description: "Over the last 2 weeks, how often have you been bothered by:",
    items: [
      "Finding it hard to wind down",
      "Tending to over-react to situations",
      "Feeling that you were using a lot of nervous energy",
      "Being intolerant of anything that kept you from getting on with what you were doing",
    ],
    choices: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Safety",
    description: "Over the last 2 weeks, how often have you been bothered by:",
    items: ["Thoughts that you would be better off dead, or of hurting yourself in some way"],
    choices: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Unusual experiences",
    description: "Over the last 2 weeks, how often have you been bothered by:",
    items: [
      "Hearing or seeing things that other people around you could not",
      "Feeling that people were watching you, following you, or trying to harm you without a clear reason",
      "Feeling emotionally flat, or pulling away from people and losing interest in being around others",
    ],
    choices: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Personality tendencies",
    description: "Thinking about the past few months, how often is each of these true for you?",
    items: [
      "My mood changes quickly and strongly, or I get easily overwhelmed by emotions",
      "I avoid close relationships and prefer to keep people at a distance",
      "I act on impulse without thinking about the consequences",
    ],
    choices: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
  },
  {
    title: "Functioning",
    description:
      "How difficult have these problems made it to do your work, take care of things at home, or get along with other people?",
    items: ["Overall, these problems have made things difficult for me"],
    choices: ["Not at all difficult", "Somewhat difficult", "Very difficult", "Extremely difficult"],
  },
];

const form = document.querySelector("#assessment-form");
const groupContainer = document.querySelector("#question-groups");
const answeredCount = document.querySelector("#answered-count");
const progressFill = document.querySelector("#progress-fill");
const errorMessage = document.querySelector("#form-error");
const results = document.querySelector("#results");
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
      "Optional AI-written reflection",
      data.aiSummary,
    );
    const aiDisclaimer = document.createElement("p");
    aiDisclaimer.className = "ai-disclaimer";
    aiDisclaimer.textContent =
      "Generated from Mood, Anxiety, and Stress totals and counts only. AI can be inaccurate; this is not a diagnosis or clinical advice.";
    results.append(aiDisclaimer);
  } else if (data.aiSummaryStatus === "unavailable") {
    addAlert(
      "ai-summary-status",
      "AI reflection unavailable",
      "The optional AI reflection could not be generated right now. Your rule-based scores and summaries are still available.",
    );
  } else if (data.aiSummaryStatus === "skipped-safety") {
    addAlert(
      "ai-summary-status",
      "AI reflection not used",
      "To prioritize your safety, the optional AI reflection was not generated. The supportive safety information above is based on your response.",
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
  resetNote.textContent = "Your responses have not been saved.";
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "button button-secondary";
  resetButton.textContent = "Start again";
  resetButton.addEventListener("click", () => {
    form.reset();
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
  submitButton.disabled = true;
  submitButton.textContent = "Calculating…";
  try {
    const apiBase = (window.MIND_CHECKIN_API_BASE || "").replace(/\/+$/, "");
    const response = await fetch(`${apiBase}/api/assessment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, aiSummary: aiSummaryRequested }),
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
