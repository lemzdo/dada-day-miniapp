const crypto = require('crypto');

const SCENE_EVIDENCE_VERSION = 'scene-evidence-v4';

const SEVERITY = Object.freeze({
  HARD_CONFLICT: 'HARD_CONFLICT',
  STRONG_POSITIVE: 'STRONG_POSITIVE',
  MEDIUM_POSITIVE: 'MEDIUM_POSITIVE',
  WEAK_POSITIVE: 'WEAK_POSITIVE',
  NEGATIVE_SIGNAL: 'NEGATIVE_SIGNAL',
});

const SEVERITY_CONTRIBUTION = Object.freeze({
  [SEVERITY.HARD_CONFLICT]: 0,
  [SEVERITY.STRONG_POSITIVE]: 2.6,
  [SEVERITY.MEDIUM_POSITIVE]: 1.5,
  [SEVERITY.WEAK_POSITIVE]: 0.6,
  [SEVERITY.NEGATIVE_SIGNAL]: -1.4,
});

const FAMILY_CAPS = Object.freeze({
  color_coordination: 0.8,
  completeness: 0.7,
  casual_structure: 1.7,
  home_comfort: 2.6,
  work_structure: 2.8,
  date_intent: 2.8,
  sport_structure: 2.8,
  weather_layering: 1.2,
  formality_conflict: 0,
  special_purpose_conflict: 0,
  footwear_conflict: 0,
  home_signal: 1.6,
  casual_penalty: 1.6,
  sport_penalty: 1.6,
  styling_penalty: 2.6,
});

function rule({
  id,
  scene,
  evidenceFamily,
  requiredFacts,
  authorization,
  severity,
  explanationValue,
  rankingContribution,
  hardConflict,
  explanationCodes = [],
  match,
}) {
  return Object.freeze({
    id,
    scene,
    evidenceFamily,
    requiredFacts: Object.freeze(requiredFacts.slice()),
    authorization,
    severity,
    explanationValue,
    rankingContribution,
    hardConflict,
    version: SCENE_EVIDENCE_VERSION,
    explanationCodes: Object.freeze(explanationCodes.slice()),
    match,
  });
}

const SCENE_EVIDENCE_REGISTRY = Object.freeze([
  // HOME: ordinary indoor life plus a short practical trip outside.
  rule({ id: 'HOME_FORMAL_CORE_CONFLICT', scene: 'home', evidenceFamily: 'formality_conflict', requiredFacts: ['formal_core'], authorization: 'controlled_category_style_scene', severity: SEVERITY.HARD_CONFLICT, explanationValue: 0, rankingContribution: 0, hardConflict: true, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isFormalCore)) }),
  rule({ id: 'HOME_FORMAL_SHOE_CONFLICT', scene: 'home', evidenceFamily: 'footwear_conflict', requiredFacts: ['formal_shoe'], authorization: 'controlled_footwear_type', severity: SEVERITY.HARD_CONFLICT, explanationValue: 0, rankingContribution: 0, hardConflict: true, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isFormalShoe || fact.isHighHeel || fact.isDressShoe)) }),
  rule({ id: 'HOME_SPECIAL_PURPOSE_CONFLICT', scene: 'home', evidenceFamily: 'special_purpose_conflict', requiredFacts: ['special_purpose'], authorization: 'controlled_category_style_scene', severity: SEVERITY.HARD_CONFLICT, explanationValue: 0, rankingContribution: 0, hardConflict: true, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isLolita || fact.isCosplay || fact.isPerformance || fact.isFormalDress || fact.isSpecialPurpose || fact.isProfessionalTraining)) }),
  rule({ id: 'HOME_RELAXED_CORE', scene: 'home', evidenceFamily: 'home_comfort', requiredFacts: ['casual_or_loose', 'simple_core'], authorization: 'controlled_fit_style_category', severity: SEVERITY.STRONG_POSITIVE, explanationValue: 9, rankingContribution: 2.6, hardConflict: false, explanationCodes: ['HOME_LOOSE_TWO_PIECE', 'HOME_LOOSE_DRESS'], match: ({ facts }) => {
    const core = apparel(facts);
    return core.length > 0 && core.every((fact) => fact.isLoose || fact.isCasual || fact.isSimple) ? matchedFacts(core) : null;
  } }),
  rule({ id: 'HOME_SIMPLE_ONEPIECE', scene: 'home', evidenceFamily: 'home_comfort', requiredFacts: ['onepiece', 'not_special'], authorization: 'controlled_category_style', severity: SEVERITY.MEDIUM_POSITIVE, explanationValue: 8, rankingContribution: 1.5, hardConflict: false, explanationCodes: ['HOME_LOOSE_DRESS', 'HOME_DRESS_NORMAL_SHOES', 'HOME_V4_EVIDENCE_SUPPORTED'], match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.category === 'onepiece' && !fact.isFormalDress && !fact.isSpecialPurpose)) }),
  rule({ id: 'HOME_SIMPLE_TWO_PIECE', scene: 'home', evidenceFamily: 'casual_structure', requiredFacts: ['top', 'bottom'], authorization: 'canonical_category', severity: SEVERITY.MEDIUM_POSITIVE, explanationValue: 7, rankingContribution: 1.5, hardConflict: false, explanationCodes: ['HOME_TSHIRT_LOOSE_PANTS', 'HOME_SHORT_SLEEVE_LONG_PANTS', 'HOME_TOP_LONG_PANTS', 'HOME_V4_EVIDENCE_SUPPORTED'], match: ({ facts }) => hasRoles(facts, ['top', 'bottom']) ? matchedFacts(byRoles(facts, ['top', 'bottom'])) : null }),
  rule({ id: 'HOME_WEATHER_LENGTH_SUPPORT', scene: 'home', evidenceFamily: 'weather_layering', requiredFacts: ['temperature', 'compatible_sleeve_or_length'], authorization: 'weather_plus_controlled_length', severity: SEVERITY.MEDIUM_POSITIVE, explanationValue: 7, rankingContribution: 1.2, hardConflict: false, explanationCodes: ['HOME_HOT_SLEEVELESS_SHORTS', 'HOME_HOT_SHORT_SLEEVE_SHORTS', 'HOME_COOL_LONG_SLEEVE'], match: ({ facts, weather }) => matchedWeatherLayer(facts, weather, { requireSport: false }) }),
  rule({ id: 'HOME_SHORT_LIGHT_SET', scene: 'home', evidenceFamily: 'casual_structure', requiredFacts: ['short_or_sleeveless_top', 'shorts'], authorization: 'controlled_length_category', severity: SEVERITY.WEAK_POSITIVE, explanationValue: 6, rankingContribution: 0.6, hardConflict: false, explanationCodes: ['HOME_SLEEVELESS_SHORTS', 'HOME_SHORT_SLEEVE_SHORTS'], match: ({ facts }) => {
    const top = facts.find((fact) => fact.category === 'top' && (fact.isTshirtLike
      || fact.visibleFacts?.includes('short_sleeve')
      || fact.visibleFacts?.includes('sleeveless')));
    const bottom = facts.find((fact) => fact.isShorts);
    return top && bottom ? matchedFacts([top, bottom]) : null;
  } }),
  rule({ id: 'HOME_COLOR_SUPPORT', scene: 'home', evidenceFamily: 'color_coordination', requiredFacts: ['canonical_color_relation'], authorization: 'canonical_color_family', severity: SEVERITY.WEAK_POSITIVE, explanationValue: 3, rankingContribution: 0.6, hardConflict: false, match: ({ colorRelations }) => colorRelations.coordinated ? matchedRelation('canonical_color_relation', colorRelations.itemIds) : null }),

  // WORK: ordinary commuting and a normal office, not a formal-business-only mode.
  rule({ id: 'WORK_HOMEWEAR_CONFLICT', scene: 'work', evidenceFamily: 'home_signal', requiredFacts: ['homewear_or_sleepwear'], authorization: 'controlled_category_style_scene', severity: SEVERITY.HARD_CONFLICT, explanationValue: 0, rankingContribution: 0, hardConflict: true, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isHomewear || fact.isSleepwear)) }),
  rule({ id: 'WORK_HOME_SHOE_CONFLICT', scene: 'work', evidenceFamily: 'footwear_conflict', requiredFacts: ['home_shoe'], authorization: 'controlled_footwear_type', severity: SEVERITY.HARD_CONFLICT, explanationValue: 0, rankingContribution: 0, hardConflict: true, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isHomeShoe || fact.isSlipperLike)) }),
  rule({ id: 'WORK_SPECIAL_PURPOSE_CONFLICT', scene: 'work', evidenceFamily: 'special_purpose_conflict', requiredFacts: ['special_purpose'], authorization: 'controlled_category_style_scene', severity: SEVERITY.HARD_CONFLICT, explanationValue: 0, rankingContribution: 0, hardConflict: true, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isCosplay || fact.isPerformance || fact.isSwimwear || fact.isProfessionalTraining || fact.isSpecialPurpose)) }),
  rule({ id: 'WORK_STRUCTURED_SET', scene: 'work', evidenceFamily: 'work_structure', requiredFacts: ['structured_top_or_shirt', 'long_pants', 'outing_shoe'], authorization: 'controlled_category_structure_footwear', severity: SEVERITY.STRONG_POSITIVE, explanationValue: 10, rankingContribution: 2.6, hardConflict: false, explanationCodes: ['WORK_SHIRT_STRAIGHT_PANTS', 'WORK_SIMPLE_TOP_PANTS_SHOES'], match: ({ facts }) => {
    const top = facts.find((fact) => fact.category === 'top' && (fact.isShirt || fact.isStructured || fact.isKnit));
    const bottom = facts.find((fact) => fact.category === 'bottom' && (fact.isLongPants || fact.isStructured));
    const shoe = outingShoe(facts);
    return top && bottom && shoe ? matchedFacts([top, bottom, shoe]) : null;
  } }),
  rule({ id: 'WORK_SIMPLE_ONEPIECE', scene: 'work', evidenceFamily: 'work_structure', requiredFacts: ['simple_onepiece', 'outing_shoe'], authorization: 'controlled_category_style_footwear', severity: SEVERITY.STRONG_POSITIVE, explanationValue: 9, rankingContribution: 2.6, hardConflict: false, explanationCodes: ['WORK_SIMPLE_DRESS_SHOES'], match: ({ facts }) => {
    const dress = facts.find((fact) => fact.category === 'onepiece' && fact.isSimple && !fact.isFormalDress);
    const shoe = outingShoe(facts);
    return dress && shoe ? matchedFacts([dress, shoe]) : null;
  } }),
  rule({ id: 'WORK_DAILY_LONG_PANTS_SET', scene: 'work', evidenceFamily: 'work_structure', requiredFacts: ['daily_top', 'long_pants', 'outing_shoe'], authorization: 'controlled_category_length_footwear', severity: SEVERITY.MEDIUM_POSITIVE, explanationValue: 7, rankingContribution: 1.5, hardConflict: false, explanationCodes: ['WORK_SIMPLE_TOP_PANTS_SHOES'], match: ({ facts }) => {
    const top = facts.find((fact) => fact.category === 'top');
    const bottom = facts.find((fact) => fact.category === 'bottom' && fact.isLongPants);
    const shoe = outingShoe(facts);
    return top && bottom && shoe ? matchedFacts([top, bottom, shoe]) : null;
  } }),
  rule({ id: 'WORK_CLEAN_SNEAKER_SUPPORT', scene: 'work', evidenceFamily: 'work_structure', requiredFacts: ['complete_core', 'clean_sneaker'], authorization: 'controlled_composition_footwear', severity: SEVERITY.MEDIUM_POSITIVE, explanationValue: 6, rankingContribution: 1.5, hardConflict: false, match: ({ facts }) => {
    const shoe = facts.find((fact) => fact.isCleanSneaker);
    return completeCore(facts) && shoe ? matchedFacts([...apparel(facts), shoe]) : null;
  } }),
  rule({ id: 'WORK_COMPLETE_DAILY_SET', scene: 'work', evidenceFamily: 'completeness', requiredFacts: ['complete_core'], authorization: 'canonical_composition', severity: SEVERITY.WEAK_POSITIVE, explanationValue: 4, rankingContribution: 0.6, hardConflict: false, explanationCodes: ['WORK_BASELINE_PRESENTABLE', 'WORK_V4_EVIDENCE_SUPPORTED'], match: ({ facts }) => completeCore(facts) ? matchedFacts(apparelAndShoes(facts)) : null }),
  rule({ id: 'WORK_CASUAL_SHORTS_NEGATIVE', scene: 'work', evidenceFamily: 'casual_penalty', requiredFacts: ['casual_top', 'shorts'], authorization: 'controlled_category_style', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 2, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => facts.some((fact) => fact.category === 'top' && (fact.isTshirtLike || fact.isSweatshirt)) && facts.some((fact) => fact.isShorts) ? matchedFacts(facts.filter((fact) => fact.category === 'top' || fact.isShorts)) : null }),
  rule({ id: 'WORK_SPORT_DOMINANT_NEGATIVE', scene: 'work', evidenceFamily: 'sport_penalty', requiredFacts: ['sport_dominant'], authorization: 'controlled_sport_fact', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => sportCoreCount(facts) >= 2 ? matchedFacts(facts.filter((fact) => fact.isSportApparel || fact.isSportShoe)) : null }),
  rule({ id: 'WORK_HOME_SIGNAL_NEGATIVE', scene: 'work', evidenceFamily: 'home_signal', requiredFacts: ['home_signal'], authorization: 'controlled_scene', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => matchedFacts(facts.filter((fact) => !fact.isHomewear && !fact.isSleepwear && fact.explicitHomeSignals?.length > 0)) }),
  rule({ id: 'WORK_COMPLEX_STYLE_NEGATIVE', scene: 'work', evidenceFamily: 'styling_penalty', requiredFacts: ['complex_style'], authorization: 'controlled_style', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isComplexStyle || fact.isLolita)) }),

  // DATE: normal eating, shopping, cinema and meeting; intent matters more than formality.
  rule({ id: 'DATE_HOME_CONFLICT', scene: 'date', evidenceFamily: 'home_signal', requiredFacts: ['homewear_or_home_shoe'], authorization: 'controlled_category_style_footwear', severity: SEVERITY.HARD_CONFLICT, explanationValue: 0, rankingContribution: 0, hardConflict: true, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isHomewear || fact.isSleepwear || fact.isHomeShoe || fact.isSlipperLike)) }),
  rule({ id: 'DATE_SPECIAL_PURPOSE_CONFLICT', scene: 'date', evidenceFamily: 'special_purpose_conflict', requiredFacts: ['special_purpose'], authorization: 'controlled_category_style_scene', severity: SEVERITY.HARD_CONFLICT, explanationValue: 0, rankingContribution: 0, hardConflict: true, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isCosplay || fact.isPerformance || fact.isSwimwear || fact.isProfessionalTraining || fact.isSpecialPurpose)) }),
  rule({ id: 'DATE_LOLITA_UNPREFERRED_NEGATIVE', scene: 'date', evidenceFamily: 'styling_penalty', requiredFacts: ['lolita', 'missing_matching_preference'], authorization: 'controlled_style_plus_user_preference', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -2.4, hardConflict: false, match: ({ facts, preferredStyles }) => facts.some((fact) => fact.isLolita) && !hasStylePreference(preferredStyles, /lolita|洛丽塔/i) ? matchedFacts(facts.filter((fact) => fact.isLolita)) : null }),
  rule({ id: 'DATE_LOLITA_PREFERRED', scene: 'date', evidenceFamily: 'date_intent', requiredFacts: ['lolita', 'matching_preference'], authorization: 'controlled_style_plus_user_preference', severity: SEVERITY.STRONG_POSITIVE, explanationValue: 8, rankingContribution: 2.6, hardConflict: false, match: ({ facts, preferredStyles }) => facts.some((fact) => fact.isLolita) && hasStylePreference(preferredStyles, /lolita|洛丽塔/i) ? matchedFacts(facts.filter((fact) => fact.isLolita)) : null }),
  rule({ id: 'DATE_PATTERN_FOCAL_SUPPORT', scene: 'date', evidenceFamily: 'date_intent', requiredFacts: ['pattern_focal', 'simple_support'], authorization: 'controlled_pattern_and_style', severity: SEVERITY.STRONG_POSITIVE, explanationValue: 10, rankingContribution: 2.6, hardConflict: false, explanationCodes: ['DATE_PATTERN_TOP_SIMPLE_SUPPORT', 'DATE_PATTERN_DRESS_SIMPLE_SHOES'], match: ({ facts }) => {
    const focal = facts.find((fact) => fact.patternFact && fact.patternFact.canonicalFact !== 'solid');
    const support = facts.find((fact) => fact.itemId !== focal?.itemId && (fact.isSimple || fact.patternFact?.canonicalFact === 'solid'));
    return focal && support ? matchedFacts([focal, support]) : null;
  } }),
  rule({ id: 'DATE_BRIGHT_FOCAL_SUPPORT', scene: 'date', evidenceFamily: 'date_intent', requiredFacts: ['bright_focal', 'neutral_support'], authorization: 'canonical_color_family', severity: SEVERITY.STRONG_POSITIVE, explanationValue: 9, rankingContribution: 2.6, hardConflict: false, explanationCodes: ['DATE_BRIGHT_TOP_BASIC_SUPPORT', 'DATE_BRIGHT_SHOES_BASIC_CLOTHES'], match: ({ facts }) => {
    const focal = facts.find((fact) => fact.colorFacts?.some((color) => color.isBright));
    const support = facts.find((fact) => fact.itemId !== focal?.itemId && fact.colorFacts?.some((color) => color.isNeutral));
    return focal && support ? matchedFacts([focal, support]) : null;
  } }),
  rule({ id: 'DATE_SIMPLE_STYLE_UNITY', scene: 'date', evidenceFamily: 'date_intent', requiredFacts: ['complete_core', 'simple_style_unity'], authorization: 'controlled_style_composition', severity: SEVERITY.STRONG_POSITIVE, explanationValue: 9, rankingContribution: 2.6, hardConflict: false, explanationCodes: ['DATE_SIMPLE_DRESS_SHOES', 'DATE_SIMPLE_COMPLETE'], match: ({ facts }) => {
    const core = apparelAndShoes(facts);
    return completeCore(facts) && core.length >= 2 && core.every((fact) => fact.isSimple)
      ? matchedFacts(core)
      : null;
  } }),
  rule({ id: 'DATE_ONEPIECE_COMPLETE', scene: 'date', evidenceFamily: 'date_intent', requiredFacts: ['onepiece', 'outing_shoe'], authorization: 'controlled_category_footwear', severity: SEVERITY.MEDIUM_POSITIVE, explanationValue: 8, rankingContribution: 1.5, hardConflict: false, explanationCodes: ['DATE_SIMPLE_DRESS_SHOES'], match: ({ facts }) => {
    const dress = facts.find((fact) => fact.category === 'onepiece' && !fact.isSpecialPurpose);
    const shoe = outingShoe(facts);
    return dress && shoe ? matchedFacts([dress, shoe]) : null;
  } }),
  rule({ id: 'DATE_SIMPLE_COMPLETE', scene: 'date', evidenceFamily: 'completeness', requiredFacts: ['simple_complete'], authorization: 'controlled_style_composition', severity: SEVERITY.MEDIUM_POSITIVE, explanationValue: 7, rankingContribution: 1.5, hardConflict: false, explanationCodes: ['DATE_SIMPLE_COMPLETE'], match: ({ facts }) => completeCore(facts) && apparel(facts).some((fact) => fact.isSimple) ? matchedFacts(apparelAndShoes(facts)) : null }),
  rule({ id: 'DATE_COMPLETE_CORE', scene: 'date', evidenceFamily: 'completeness', requiredFacts: ['complete_core'], authorization: 'canonical_composition', severity: SEVERITY.WEAK_POSITIVE, explanationValue: 4, rankingContribution: 0.6, hardConflict: false, explanationCodes: ['DATE_V4_EVIDENCE_SUPPORTED'], match: ({ facts }) => completeCore(facts) ? matchedFacts(apparelAndShoes(facts)) : null }),
  rule({ id: 'DATE_COLOR_COORDINATED', scene: 'date', evidenceFamily: 'color_coordination', requiredFacts: ['canonical_color_relation'], authorization: 'canonical_color_family', severity: SEVERITY.WEAK_POSITIVE, explanationValue: 3, rankingContribution: 0.6, hardConflict: false, explanationCodes: ['DATE_COLOR_COORDINATED'], match: ({ colorRelations }) => colorRelations.coordinated ? matchedRelation('canonical_color_relation', colorRelations.itemIds) : null }),
  rule({ id: 'DATE_HOME_SIGNAL_NEGATIVE', scene: 'date', evidenceFamily: 'home_signal', requiredFacts: ['home_signal'], authorization: 'controlled_style_scene', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isCasual && fact.explicitHomeSignals?.length > 0)) }),
  rule({ id: 'DATE_SPORT_DOMINANT_NEGATIVE', scene: 'date', evidenceFamily: 'sport_penalty', requiredFacts: ['sport_dominant'], authorization: 'controlled_sport_fact', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => sportCoreCount(facts) >= 2 ? matchedFacts(facts.filter((fact) => fact.isSportApparel || fact.isSportShoe)) : null }),
  rule({ id: 'DATE_CASUAL_NO_INTENT_NEGATIVE', scene: 'date', evidenceFamily: 'casual_penalty', requiredFacts: ['casual_top', 'shorts', 'missing_styling_intent'], authorization: 'controlled_category_style_pattern', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => {
    const casualSet = facts.some((fact) => fact.category === 'top' && fact.isTshirtLike) && facts.some((fact) => fact.isShorts);
    const intent = facts.some((fact) => fact.patternFact && fact.patternFact.canonicalFact !== 'solid')
      || facts.some((fact) => fact.colorFacts?.some((color) => color.isBright))
      || facts.some((fact) => fact.isStructured);
    return casualSet && !intent ? matchedFacts(facts.filter((fact) => fact.isTshirtLike || fact.isShorts)) : null;
  } }),
  rule({ id: 'DATE_STYLE_MISMATCH_NEGATIVE', scene: 'date', evidenceFamily: 'styling_penalty', requiredFacts: ['formal_top', 'sport_support'], authorization: 'controlled_style_sport', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => facts.some((fact) => fact.isFormalTop)
    && facts.some((fact) => fact.isSportApparel || fact.isSportShoe)
    ? matchedFacts(facts.filter((fact) => fact.isFormalTop || fact.isSportApparel || fact.isSportShoe))
    : null }),

  // SPORT: daily light activity only; specialist exercise remains a future scene.
  rule({ id: 'SPORT_FOOTWEAR_CONFLICT', scene: 'sport', evidenceFamily: 'footwear_conflict', requiredFacts: ['unsafe_activity_shoe'], authorization: 'controlled_footwear_type', severity: SEVERITY.HARD_CONFLICT, explanationValue: 0, rankingContribution: 0, hardConflict: true, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.category === 'shoes' && (fact.isFormalShoe || fact.isHighHeel || fact.isDressShoe || fact.isHomeShoe || fact.isSlipperLike))) }),
  rule({ id: 'SPORT_FORMAL_SPECIAL_CONFLICT', scene: 'sport', evidenceFamily: 'special_purpose_conflict', requiredFacts: ['formal_or_special_core'], authorization: 'controlled_category_style_scene', severity: SEVERITY.HARD_CONFLICT, explanationValue: 0, rankingContribution: 0, hardConflict: true, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isFormalCore || fact.isFormalDress || fact.isLolita || fact.isCosplay || fact.isPerformance || fact.isSpecialPurpose)) }),
  rule({ id: 'SPORT_EXPLICIT_SET', scene: 'sport', evidenceFamily: 'sport_structure', requiredFacts: ['sport_top', 'sport_bottom', 'sport_shoe'], authorization: 'controlled_sport_fact', severity: SEVERITY.STRONG_POSITIVE, explanationValue: 10, rankingContribution: 2.6, hardConflict: false, explanationCodes: ['SPORT_COMPLETE_SET'], match: ({ facts }) => facts.some((fact) => fact.isExplicitSportTop) && facts.some((fact) => fact.isExplicitSportBottom) && facts.some((fact) => fact.isSportShoe) ? matchedFacts(facts.filter((fact) => fact.isExplicitSportTop || fact.isExplicitSportBottom || fact.isSportShoe)) : null }),
  rule({ id: 'SPORT_EXPLICIT_ONEPIECE', scene: 'sport', evidenceFamily: 'sport_structure', requiredFacts: ['sport_onepiece', 'sport_shoe'], authorization: 'controlled_sport_fact', severity: SEVERITY.STRONG_POSITIVE, explanationValue: 9, rankingContribution: 2.6, hardConflict: false, explanationCodes: ['SPORT_DRESS_SHOES'], match: ({ facts }) => {
    const onepiece = facts.find((fact) => fact.category === 'onepiece' && fact.isSportDress);
    const shoe = facts.find((fact) => fact.isSportShoe);
    return onepiece && shoe ? matchedFacts([onepiece, shoe]) : null;
  } }),
  rule({ id: 'SPORT_WEATHER_LAYER_SUPPORT', scene: 'sport', evidenceFamily: 'weather_layering', requiredFacts: ['temperature', 'sport_layering'], authorization: 'weather_plus_controlled_length_sport', severity: SEVERITY.STRONG_POSITIVE, explanationValue: 8, rankingContribution: 1.2, hardConflict: false, explanationCodes: ['SPORT_HOT_SLEEVELESS_SHORTS', 'SPORT_HOT_SHORT_SLEEVE_SHORTS', 'SPORT_COOL_OUTERWEAR', 'SPORT_COOL_LONG_SET'], match: ({ facts, weather }) => matchedWeatherLayer(facts, weather, { requireSport: true }) }),
  rule({ id: 'SPORT_DAILY_LIGHT_SET', scene: 'sport', evidenceFamily: 'sport_structure', requiredFacts: ['casual_activity_top', 'activity_bottom', 'sport_shoe'], authorization: 'controlled_category_sport_footwear', severity: SEVERITY.MEDIUM_POSITIVE, explanationValue: 8, rankingContribution: 1.5, hardConflict: false, explanationCodes: ['SPORT_LIGHT_ACTIVITY_SET', 'SPORT_HOT_SHORT_SLEEVE_SHORTS'], match: ({ facts }) => {
    const top = facts.find((fact) => fact.category === 'top' && (fact.isTshirtLike || fact.isSweatshirt || fact.isExplicitSportTop));
    const bottom = facts.find((fact) => fact.category === 'bottom' && (fact.isShorts || fact.isSportCompatibleBottom || fact.isExplicitSportBottom));
    const shoe = facts.find((fact) => fact.isSportShoe);
    return top && bottom && shoe ? matchedFacts([top, bottom, shoe]) : null;
  } }),
  rule({ id: 'SPORT_CASUAL_ACTIVITY', scene: 'sport', evidenceFamily: 'casual_structure', requiredFacts: ['simple_activity_structure', 'closed_shoe'], authorization: 'controlled_category_footwear', severity: SEVERITY.WEAK_POSITIVE, explanationValue: 4, rankingContribution: 0.6, hardConflict: false, explanationCodes: ['SPORT_V4_EVIDENCE_SUPPORTED'], match: ({ facts }) => completeCore(facts) && facts.some((fact) => fact.category === 'shoes' && !fact.isOpenOrUnsafeShoe) ? matchedFacts(apparelAndShoes(facts)) : null }),
  rule({ id: 'SPORT_DENIM_NEGATIVE', scene: 'sport', evidenceFamily: 'sport_penalty', requiredFacts: ['denim_bottom'], authorization: 'controlled_subcategory_material', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isDenim)) }),
  rule({ id: 'SPORT_NON_SPORT_DRESS_NEGATIVE', scene: 'sport', evidenceFamily: 'styling_penalty', requiredFacts: ['non_sport_dress'], authorization: 'controlled_category_style', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => matchedFacts(facts.filter((fact) => (fact.category === 'onepiece' || fact.category === 'skirt') && !fact.isSportDress)) }),
  rule({ id: 'SPORT_HEAVY_LAYER_NEGATIVE', scene: 'sport', evidenceFamily: 'sport_penalty', requiredFacts: ['heavy_layer'], authorization: 'wearability_fact', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isWarmOuterwear || fact.warmthLevel >= 4)) }),
  rule({ id: 'SPORT_NON_SPORT_OUTERWEAR_NEGATIVE', scene: 'sport', evidenceFamily: 'sport_penalty', requiredFacts: ['non_sport_outerwear'], authorization: 'controlled_category_sport', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.category === 'outerwear' && !fact.isSportApparel)) }),
  rule({ id: 'SPORT_FORMAL_TOP_NEGATIVE', scene: 'sport', evidenceFamily: 'styling_penalty', requiredFacts: ['formal_top'], authorization: 'controlled_style_category', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isFormalTop)) }),
  rule({ id: 'SPORT_COMPLEX_STYLE_NEGATIVE', scene: 'sport', evidenceFamily: 'styling_penalty', requiredFacts: ['complex_style'], authorization: 'controlled_style', severity: SEVERITY.NEGATIVE_SIGNAL, explanationValue: 1, rankingContribution: -1.4, hardConflict: false, match: ({ facts }) => matchedFacts(facts.filter((fact) => fact.isComplexStyle)) }),
]);

const SCENE_EVIDENCE_FINGERPRINT = fingerprintRegistry(SCENE_EVIDENCE_REGISTRY);

const OPTIONAL_ITEM_POLICY = Object.freeze([
  Object.freeze({ id: 'HOME_SUPPRESS_STYLING_ACCESSORY', scene: 'home', action: 'SUPPRESS', kinds: Object.freeze(['hat', 'sunglasses', 'formal_bag', 'banquet_bag', 'formal_outerwear', 'styling_accessory']), version: SCENE_EVIDENCE_VERSION }),
  Object.freeze({ id: 'SPORT_SUPPRESS_UNNECESSARY_ACCESSORY', scene: 'sport', action: 'SUPPRESS', kinds: Object.freeze(['hat', 'sunglasses', 'formal_bag', 'banquet_bag', 'formal_outerwear', 'styling_accessory']), version: SCENE_EVIDENCE_VERSION }),
  Object.freeze({ id: 'WORK_SUPPRESS_HOME_ACCESSORY', scene: 'work', action: 'SUPPRESS', kinds: Object.freeze(['home_accessory']), version: SCENE_EVIDENCE_VERSION }),
  Object.freeze({ id: 'DATE_SUPPRESS_FUNCTIONAL_SPECIAL_ACCESSORY', scene: 'date', action: 'SUPPRESS', kinds: Object.freeze(['professional_training_accessory', 'special_purpose_accessory']), version: SCENE_EVIDENCE_VERSION }),
]);

function evaluateRegistry({ scene, facts = [], preferredStyles = [], colorRelations = {}, weather = {} } = {}) {
  const matches = [];
  for (const entry of SCENE_EVIDENCE_REGISTRY) {
    if (entry.scene !== scene) continue;
    const match = entry.match({ facts, preferredStyles, colorRelations, weather });
    if (!match) continue;
    matches.push({
      id: entry.id,
      scene: entry.scene,
      evidenceFamily: entry.evidenceFamily,
      requiredFacts: entry.requiredFacts.slice(),
      authorization: entry.authorization,
      severity: entry.severity,
      explanationValue: entry.explanationValue,
      rankingContribution: entry.rankingContribution,
      hardConflict: entry.hardConflict,
      version: entry.version,
      explanationCodes: entry.explanationCodes.slice(),
      subjectItemIds: uniqueStrings(match.subjectItemIds),
      supportingFacts: uniqueStrings(match.supportingFacts),
    });
  }
  return matches;
}

function scoreEvidence(evidence = []) {
  const contributionByFamily = new Map();
  for (const entry of evidence) {
    if (entry.hardConflict) continue;
    const raw = Number.isFinite(Number(entry.rankingContribution))
      ? Number(entry.rankingContribution)
      : SEVERITY_CONTRIBUTION[entry.severity] || 0;
    const cap = Number(FAMILY_CAPS[entry.evidenceFamily]);
    const bounded = raw >= 0
      ? Math.min(raw, Number.isFinite(cap) ? cap : raw)
      : Math.max(raw, Number.isFinite(cap) ? -cap : raw);
    const current = contributionByFamily.get(entry.evidenceFamily);
    if (current === undefined || Math.abs(bounded) > Math.abs(current)) {
      contributionByFamily.set(entry.evidenceFamily, bounded);
    }
  }
  const contribution = [...contributionByFamily.values()].reduce((sum, value) => sum + value, 0);
  return {
    sceneFitScore: round1(clamp(5 + contribution, 0, 10)),
    contribution: round1(contribution),
    contributionByFamily: Object.fromEntries([...contributionByFamily.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

function evaluateOptionalItemPolicy(scene, optionalItems = []) {
  const suppressed = [];
  const kept = [];
  const policies = OPTIONAL_ITEM_POLICY.filter((entry) => entry.scene === scene);
  for (const item of optionalItems) {
    const kind = classifyOptionalKind(item);
    const policy = policies.find((entry) => entry.kinds.includes(kind));
    if (policy) suppressed.push({ item, kind, policyId: policy.id });
    else kept.push(item);
  }
  return { kept, suppressed, version: SCENE_EVIDENCE_VERSION, fingerprint: SCENE_EVIDENCE_FINGERPRINT };
}

function classifyOptionalKind(item = {}) {
  const text = [item.category, item.subcategory, item.subCategory, item.customName, item.name, ...(item.styleTags || []), ...(item.sceneTags || [])].filter(Boolean).join(' ').toLowerCase();
  if ((item.category === 'outerwear' || /外套|大衣|风衣|夹克|coat|jacket|blazer/.test(text))
    && /西装|正式|商务|formal|business|suit|blazer/.test(text)) return 'formal_outerwear';
  if (item.category === 'outerwear' || /外套|大衣|风衣|夹克|coat|jacket|blazer/.test(text)) return 'outerwear';
  if (/太阳镜|墨镜|sunglasses/.test(text)) return 'sunglasses';
  if (/礼帽|帽|hat|cap/.test(text)) return 'hat';
  if (/宴会包|晚宴包|banquet|evening bag/.test(text)) return 'banquet_bag';
  if (/公文包|正式包|商务包|briefcase|formal bag/.test(text)) return 'formal_bag';
  if (/训练|健身|professional training/.test(text)) return 'professional_training_accessory';
  if (/舞台|演出|cosplay|特殊用途/.test(text)) return 'special_purpose_accessory';
  if (/家居|室内/.test(text)) return 'home_accessory';
  return 'styling_accessory';
}

function fingerprintRegistry(registry) {
  const stable = registry.map((entry) => ({
    id: entry.id,
    scene: entry.scene,
    evidenceFamily: entry.evidenceFamily,
    requiredFacts: entry.requiredFacts,
    authorization: entry.authorization,
    severity: entry.severity,
    explanationValue: entry.explanationValue,
    rankingContribution: entry.rankingContribution,
    hardConflict: entry.hardConflict,
    version: entry.version,
  }));
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 20);
}

function matchedFacts(facts) {
  if (!Array.isArray(facts) || facts.length === 0) return null;
  return {
    subjectItemIds: facts.map((fact) => fact.itemId),
    supportingFacts: facts.flatMap((fact) => fact.canonicalFacts || [fact.category]),
  };
}

function matchedRelation(fact, itemIds) {
  return { subjectItemIds: itemIds, supportingFacts: [fact] };
}

function apparel(facts) { return facts.filter((fact) => ['top', 'bottom', 'skirt', 'onepiece', 'outerwear'].includes(fact.category)); }
function apparelAndShoes(facts) { return facts.filter((fact) => ['top', 'bottom', 'skirt', 'onepiece', 'outerwear', 'shoes'].includes(fact.category)); }
function byRoles(facts, roles) { return facts.filter((fact) => roles.includes(fact.category)); }
function hasRoles(facts, roles) { return roles.every((role) => facts.some((fact) => fact.category === role)); }
function completeCore(facts) { return (hasRoles(facts, ['top', 'bottom']) || facts.some((fact) => fact.category === 'onepiece')) && facts.some((fact) => fact.category === 'shoes'); }
function outingShoe(facts) { return facts.find((fact) => fact.category === 'shoes' && !fact.isHomeShoe && !fact.isSlipperLike && !fact.isOpenOrUnsafeShoe); }
function sportCoreCount(facts) { return facts.filter((fact) => fact.isSportApparel || fact.isSportShoe).length; }
function hasStylePreference(preferredStyles, pattern) { return (preferredStyles || []).some((style) => pattern.test(String(style))); }
function matchedWeatherLayer(facts, weather, { requireSport } = {}) {
  const temperature = Number(weather?.temp ?? weather?.temperature);
  if (!Number.isFinite(temperature)) return null;
  const sportShoePresent = facts.some((fact) => fact.isSportShoe);
  if (requireSport && !sportShoePresent) return null;
  if (temperature >= 26) {
    const light = facts.filter((fact) => fact.isTshirtLike || fact.isShorts
      || fact.canonicalFacts?.includes('short_sleeve')
      || fact.canonicalFacts?.includes('sleeveless'));
    return light.length >= 2 ? matchedFacts(light) : null;
  }
  if (temperature <= 18) {
    const warm = facts.filter((fact) => fact.isWarmOuterwear || fact.isSportOuterwear
      || fact.canonicalFacts?.includes('long_sleeve')
      || fact.canonicalFacts?.includes('long_pants'));
    return warm.length >= 2 ? matchedFacts(warm) : null;
  }
  return null;
}
function uniqueStrings(values) { return [...new Set((values || []).filter((value) => typeof value === 'string' && value))]; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function round1(value) { return Math.round((Number(value) || 0) * 10) / 10; }

module.exports = {
  FAMILY_CAPS,
  OPTIONAL_ITEM_POLICY,
  SCENE_EVIDENCE_FINGERPRINT,
  SCENE_EVIDENCE_REGISTRY,
  SCENE_EVIDENCE_VERSION,
  SEVERITY,
  evaluateOptionalItemPolicy,
  evaluateRegistry,
  scoreEvidence,
};
