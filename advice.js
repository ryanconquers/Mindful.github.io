// AI advice for a patient's check-in. The model only receives section
// scores — never the patient's name, email, or individual answers. A doctor
// later reviews the advice (see accounts.js).

export const adviceModel = "@cf/google/gemma-4-26b-a4b-it";

const difficultyLabels = [
  "Not at all difficult",
  "Somewhat difficult",
  "Very difficult",
  "Extremely difficult",
];

const tips = {
  mood: "Plan one small, enjoyable or meaningful activity each day, even for 10 minutes, and notice how you feel afterwards.",
  anxiety: "When worry builds, try slow breathing (in for 4, out for 6) for two minutes, or set aside a short 'worry time' each day.",
  stress: "Break big tasks into small steps, take short screen-free breaks, and protect time for rest between study or work blocks.",
  experiences: "Stay connected with people you trust and keep a regular routine; consider sharing these experiences with a professional.",
  personality: "Notice strong emotions as they come up and give yourself a pause before acting—writing things down can help.",
};

export function ruleBasedAdvice(assessment) {
  const elevated = assessment.scores.filter(({ band }) => ["Moderate", "High"].includes(band));
  const lines = [
    elevated.length
      ? `Thank you for checking in. Your responses were higher in ${elevated.map((s) => s.name.toLowerCase()).join(", ")}, so here are a few things you could try this week:`
      : "Thank you for checking in. Your responses look fairly settled overall—here are a few habits that can help you stay well:",
  ];
  const chosen = (elevated.length ? elevated : assessment.scores.slice(0, 3)).map(
    ({ key }) => `- ${tips[key]}`,
  );
  chosen.push("- Keep a steady sleep schedule, move your body daily, and talk with someone you trust about how you feel.");
  lines.push(...chosen.slice(0, 5));
  lines.push(
    assessment.clinicianRecommendation
      ? "Because some areas were elevated, speaking with a qualified mental health professional is recommended."
      : "If things start to feel harder or last longer than a couple of weeks, consider speaking with a qualified professional.",
  );
  return lines.join("\n");
}

// Returns { status, source, text }.
//   status: "available" (AI), "fallback" (rule-based), "skipped-safety"
export async function generateAdvice(assessment, ai) {
  if (assessment.safetySupport) {
    return { status: "skipped-safety", source: null, text: null };
  }
  if (!ai || typeof ai.run !== "function") {
    return { status: "fallback", source: "rule-based", text: ruleBasedAdvice(assessment) };
  }
  const facts = {
    sections: assessment.scores.map(({ name, score, max, band, frequentResponses }) => ({
      section: name,
      total: score,
      maximum: max,
      provisionalBand: band,
      oftenReportedCount: frequentResponses,
    })),
    dailyLifeDifficulty: difficultyLabels[assessment.functioning?.score] ?? null,
    professionalSupportSuggested: assessment.clinicianRecommendation,
    unusualExperiencesNoted: assessment.unusualExperienceReferral,
  };
  try {
    const result = await ai.run(adviceModel, {
      messages: [
        {
          role: "system",
          content:
            "You are a supportive wellbeing assistant for a student mental-health check-in in India. " +
            "Using only the section results provided, write practical, compassionate self-care advice for the person. " +
            "Format: one short opening sentence; then 3 to 5 bullet points, each starting with '- ', each a concrete action they can try this week, " +
            "focused on the sections with higher bands; then one closing sentence about when to talk to a qualified mental health professional " +
            "(say it clearly if professionalSupportSuggested or unusualExperiencesNoted is true). " +
            "At most 170 words. Address the person as 'you'. Do not diagnose, name disorders, mention medication, or present the bands as clinical facts—" +
            "the questionnaire is unvalidated. A doctor will review your advice.",
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
      max_completion_tokens: 450,
      temperature: 0.3,
      chat_template_kwargs: { enable_thinking: false },
    });
    const text =
      typeof result === "string"
        ? result
        : result?.response ?? result?.choices?.[0]?.message?.content;
    if (typeof text === "string" && text.trim()) {
      return { status: "available", source: adviceModel, text: text.trim().slice(0, 2000) };
    }
  } catch (error) {
    console.error("AI advice failed", error instanceof Error ? error.name : "UnknownError");
  }
  return { status: "fallback", source: "rule-based", text: ruleBasedAdvice(assessment) };
}
