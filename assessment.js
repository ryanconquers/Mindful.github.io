const scales = [
  { name: "Mood", key: "mood", items: [1, 2, 3, 4, 5, 6, 7], max: 21 },
  { name: "Anxiety", key: "anxiety", items: [8, 9, 10, 11, 12, 13], max: 18 },
  { name: "Stress", key: "stress", items: [14, 15, 16, 17], max: 12 },
  {
    name: "Unusual experiences",
    key: "experiences",
    items: [19, 20, 21],
    max: 9,
  },
  {
    name: "Personality tendencies",
    key: "personality",
    items: [22, 23, 24],
    max: 9,
  },
];

function bandFor(score, max) {
  if (score / max < 0.25) return "Low";
  if (score / max < 0.5) return "Mild";
  if (score / max < 0.75) return "Moderate";
  return "High";
}

export function validateAnswers(answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return false;
  }
  const keys = Object.keys(answers);
  if (
    keys.length !== 25 ||
    !Array.from({ length: 25 }, (_, index) => String(index + 1)).every((key) =>
      Object.hasOwn(answers, key),
    )
  ) {
    return false;
  }
  return Array.from({ length: 25 }, (_, index) => answers[index + 1]).every(
    (answer) => Number.isInteger(answer) && answer >= 0 && answer <= 3,
  );
}

export function calculateAssessment(answers) {
  const scores = scales.map((scale) => {
    const score = scale.items.reduce((total, item) => total + answers[item], 0);
    const frequentResponses = scale.items.filter(
      (item) => answers[item] >= 2,
    ).length;
    const frequencyDescription =
      frequentResponses === 0
        ? `You did not mark any of these ${scale.items.length} statements as occurring more than half the time.`
        : `You marked ${frequentResponses} of ${scale.items.length} statements as occurring more than half the time.`;
    const summary =
      scale.key === "personality"
        ? `${frequencyDescription} These draft statements are descriptive only; they are not a validated personality measure or a clinical label.`
        : scale.key === "experiences"
          ? `${frequencyDescription} This section is not diagnostic; if any of these experiences concern you, consider discussing them with a qualified professional.`
          : `${frequencyDescription} The provisional ${bandFor(score, scale.max).toLowerCase()} band is only a reflection of this questionnaire's unvalidated scoring.`;
    return {
      name: scale.name,
      key: scale.key,
      score,
      max: scale.max,
      band: bandFor(score, scale.max),
      frequentResponses,
      summary,
    };
  });
  const safetySupport =
    answers[18] > 0 || answers[5] === 3 || answers[7] === 3;
  const unusualExperienceReferral = answers[19] >= 2 || answers[20] >= 2;
  const functioningSupport = answers[25] >= 2;
  const clinicianRecommendation =
    scores.some(
      ({ key, band }) =>
        ["mood", "anxiety", "stress"].includes(key) &&
        ["Moderate", "High"].includes(band),
    ) ||
    functioningSupport ||
    unusualExperienceReferral;

  const guidance = [
    "If it feels manageable, choose one small supportive activity today—perhaps taking a short break, getting some fresh air, or checking in with someone you trust.",
  ];
  if (clinicianRecommendation) {
    guidance.unshift(
      "Consider discussing how you’ve been feeling with a qualified mental health professional; they can help you explore what support may suit you.",
    );
  }
  if (safetySupport) {
    guidance.unshift(
      "Your immediate safety matters most. Please use the support options shown here and connect with someone you trust.",
    );
  }

  return {
    scores,
    safetySupport,
    unusualExperienceReferral,
    functioning: { score: answers[25], max: 3 },
    functioningSupport,
    clinicianRecommendation,
    guidance,
  };
}
