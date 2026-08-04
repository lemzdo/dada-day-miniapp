const { classifyWearabilityItem } = require('./itemWearabilityFacts');

function evaluateWeatherWearability({ items = [], weather = {}, itemFactsContext, derivedFacts, instrumentation } = {}) {
  const temp = readTemperature(weather);
  const facts = Array.isArray(derivedFacts?.weatherFacts)
    ? derivedFacts.weatherFacts
    : items.map((item) => itemFactsContext
      ? itemFactsContext.resolveItemFacts(item).wearabilityClassification
      : classifyWearabilityItem(item, { instrumentation }));
  const rejectReasons = [];
  const warningReasons = [];
  const evidence = [];
  let penalty = 0;

  if (temp === null) {
    // Weather-disabled recommendations must not use a synthetic temperature.
  } else if (temp >= 29) {
    for (const fact of facts) {
      if (isHotWeatherRejected(fact)) {
        addReason(rejectReasons, 'HOT_WEATHER_WARM_ITEM');
        evidence.push(toEvidence(fact, 'hot_weather_warm_item'));
      }
    }
  } else if (temp >= 26 && temp <= 28) {
    for (const fact of facts) {
      if (isWarmWeatherTopRejected(fact)) {
        addReason(rejectReasons, 'WARM_WEATHER_WARM_TOP');
        evidence.push(toEvidence(fact, 'warm_weather_warm_top'));
      }
    }
    if (hasHeavyWarmCombo(facts)) {
      addReason(warningReasons, 'WARM_WEATHER_HEAVY_COMBO');
      penalty += 2.5;
      for (const fact of facts.filter((entry) => entry.warmthLevel >= 3)) evidence.push(toEvidence(fact, 'warm_weather_heavy_combo'));
    }
    for (const fact of facts) {
      if (fact.isWarmOuterwear && fact.lightnessSignals.length === 0) {
        addReason(rejectReasons, 'WARM_WEATHER_HEAVY_OUTERWEAR');
        evidence.push(toEvidence(fact, 'warm_weather_heavy_outerwear'));
      }
    }
  } else if (temp >= 22 && temp <= 25) {
    for (const fact of facts) {
      if (fact.isWarmOuterwear && /羽绒|大衣|厚外套|down|overcoat/i.test(fact.evidence.join(' '))) {
        addReason(rejectReasons, 'MILD_WEATHER_HEAVY_OUTERWEAR');
        evidence.push(toEvidence(fact, 'mild_weather_heavy_outerwear'));
      }
    }
  }

  return {
    pass: rejectReasons.length === 0,
    penalty: round1(penalty),
    rejectReasons,
    warningReasons,
    evidence,
    itemFacts: facts,
  };
}

function isHotWeatherRejected(fact) {
  if (fact.lightnessSignals.length > 0) return false;
  if (fact.isWarmTop || fact.isWarmOuterwear || fact.isWarmBottom || fact.isBootLike) return true;
  if (fact.isSweaterLike && fact.warmthLevel >= 3) return true;
  return false;
}

function isWarmWeatherTopRejected(fact) {
  if (fact.lightnessSignals.length > 0) return false;
  return fact.isWarmTop || (fact.isSweaterLike && fact.warmthLevel >= 3);
}

function hasHeavyWarmCombo(facts) {
  const hasSweater = facts.some((fact) => fact.isSweaterLike && fact.lightnessSignals.length === 0);
  const hasHoodie = facts.some((fact) => /卫衣|hoodie/i.test(fact.evidence.join(' ')) && fact.lightnessSignals.length === 0);
  const hasLongPants = facts.some((fact) => fact.isLongPants);
  const hasOuterwear = facts.some((fact) => fact.category === 'outerwear' || fact.isWarmOuterwear);
  const hasHeavyBottom = facts.some((fact) => fact.isWarmBottom);
  return (hasSweater && hasLongPants) || (hasHoodie && hasOuterwear) || hasHeavyBottom || facts.some((fact) => fact.isWarmOuterwear);
}

function toEvidence(fact, reason) {
  return {
    itemId: fact.itemId,
    category: fact.category,
    normalizedType: fact.normalizedType,
    reason,
    evidence: fact.evidence,
  };
}

function readTemperature(weather = {}) {
  if (['disabled', 'unavailable'].includes(weather.mode || weather.weatherMode)) return null;
  const temp = Number(weather.temp ?? weather.temperature);
  return Number.isFinite(temp) ? temp : null;
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

module.exports = {
  evaluateWeatherWearability,
};
