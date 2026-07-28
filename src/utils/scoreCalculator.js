/**
 * MayiEat Nutrition & Personalized Health Score Engine
 * Computes Base Nutri-Score (0-100) and Personalized Health Score based on User Health Profile.
 */

// Helper to determine Grade A-E from 0-100 Score
function getGrade(score) {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'E';
}

/**
 * Calculates Base Nutri-Score (0-100)
 * @param {Object} macros - { calories_100g, protein_100g, carbs_100g, sugar_100g, fat_100g, sat_fat_100g, fiber_100g, sodium_mg_100g }
 * @param {Array} ingredients - Array of ingredient strings or objects
 */
function calculateBaseScore(macros = {}, ingredients = []) {
  const calories = Number(macros.calories_100g || 0);
  const sugar = Number(macros.sugar_100g || 0);
  const satFat = Number(macros.sat_fat_100g || 0);
  const sodiumMg = Number(macros.sodium_mg_100g || 0);
  const fiber = Number(macros.fiber_100g || 0);
  const protein = Number(macros.protein_100g || 0);

  // Negative Points (N)
  let nPoints = 0;
  // Energy (kJ): 1 kcal = 4.184 kJ
  const energyKj = calories * 4.184;
  nPoints += Math.min(10, Math.floor(energyKj / 335));
  // Sugar (g)
  nPoints += Math.min(10, Math.floor(sugar / 4.5));
  // Saturated Fat (g)
  nPoints += Math.min(10, Math.floor(satFat / 1.0));
  // Sodium (mg)
  nPoints += Math.min(10, Math.floor(sodiumMg / 90));

  // Positive Points (P)
  let pPoints = 0;
  // Fiber (g)
  pPoints += Math.min(5, Math.floor(fiber / 0.9));
  // Protein (g)
  pPoints += Math.min(5, Math.floor(protein / 1.6));

  // Raw Nutri-Score (-15 to +40, where lower is healthier)
  const rawScore = nPoints - pPoints;

  // Convert raw score to 0-100 scale (where 100 is healthiest, 0 is unhealthiest)
  // Mapping raw [-15, 40] -> [100, 0]
  let baseScore = Math.round(100 - ((rawScore + 15) / 55) * 100);
  baseScore = Math.max(0, Math.min(100, baseScore));

  // Check ingredient additives for extra deductions
  if (Array.isArray(ingredients)) {
    const ingrStr = ingredients.map(i => (typeof i === 'string' ? i : i.chemical_name || '')).join(' ').toLowerCase();
    
    // High risk additives
    if (/e250|nitrite|nitrate|e129|red 40|bha|bht|trans fat|partially hydrogenated/.test(ingrStr)) {
      baseScore = Math.max(0, baseScore - 15);
    }
    // Moderate risk additives
    if (/e951|aspartame|e133|carrageenan|mono- and diglycerides/.test(ingrStr)) {
      baseScore = Math.max(0, baseScore - 5);
    }
  }

  return {
    base_nutri_score: baseScore,
    base_grade: getGrade(baseScore)
  };
}

/**
 * Applies Personalized Health Adjustments based on User Profile
 * @param {number} baseScore - 0-100 Base Nutri-Score
 * @param {Object} macros - Nutri-facts object
 * @param {Object} profile - User Health Profile (conditions, allergies, goals)
 * @param {Array} ingredients - Ingredients list
 */
function calculatePersonalizedScore(baseScore, macros = {}, profile = {}, ingredients = []) {
  let score = baseScore;
  const warningChips = [];
  
  const conditions = Array.isArray(profile.medical_conditions) ? profile.medical_conditions : [];
  const allergies = Array.isArray(profile.allergies) ? profile.allergies : [];
  const goal = profile.goal || 'Maintenance';

  const sugar = Number(macros.sugar_100g || 0);
  const sodiumMg = Number(macros.sodium_mg_100g || 0);
  const calories = Number(macros.calories_100g || 0);
  const satFat = Number(macros.sat_fat_100g || 0);

  const ingrText = Array.isArray(ingredients) 
    ? ingredients.map(i => (typeof i === 'string' ? i : i.chemical_name || '')).join(' ').toLowerCase() 
    : '';

  // 1. ALLERGEN HARD LOCK (Score = 0 if direct match)
  for (const allergen of allergies) {
    if (allergen && ingrText.includes(allergen.toLowerCase())) {
      return {
        personalized_health_score: 0,
        personalized_grade: 'E',
        verdict: `CRITICAL HAZARD: Contains ${allergen}! Do not consume.`,
        warning_chips: [`⚠ CRITICAL ALLERGEN: ${allergen.toUpperCase()}`, 'Avoid Immediately'],
        is_allergen_hazard: true
      };
    }
  }

  // 2. DIABETES ADJUSTMENTS
  if (conditions.includes('Diabetes')) {
    warningChips.push('✓ Diabetes-Aware Applied');
    if (sugar > 10) {
      score -= Math.round((sugar - 10) * 2.5);
      warningChips.push('⚠ High Sugar for Diabetics');
    }
    // High sugar + low fiber GI penalty
    if (sugar > 15 && Number(macros.fiber_100g || 0) < 2) {
      score -= 20;
      warningChips.push('⚠ High Glucose Spike Risk');
    }
  }

  // 3. HYPERTENSION / HEART DISEASE ADJUSTMENTS
  if (conditions.includes('Hypertension / Heart Disease') || conditions.includes('Hypertension')) {
    warningChips.push('✓ Heart-Aware Applied');
    if (sodiumMg > 400) {
      score -= Math.round(((sodiumMg - 400) / 100) * 12);
      warningChips.push('⚠ Watch Sodium');
    }
    if (ingrText.includes('trans fat') || ingrText.includes('hydrogenated') || satFat > 10) {
      score = Math.min(29, score); // Cap maximum score at Grade E
      warningChips.push('⚠ High Trans/Sat Fat');
    }
  }

  // 4. KIDNEY DISEASE (CKD) ADJUSTMENTS
  if (conditions.includes('Chronic Kidney Disease (CKD)')) {
    warningChips.push('✓ Kidney-Aware Applied');
    if (sodiumMg > 300 || ingrText.includes('potassium') || ingrText.includes('phosphate')) {
      score -= 35;
      warningChips.push('⚠ High Mineral Load (CKD Warning)');
    }
  }

  // 5. FITNESS GOAL ADJUSTMENTS
  if (goal === 'Weight Loss' && calories > 350) {
    score -= 15;
    warningChips.push('⚠ High Calorie Density');
  } else if (goal === 'Muscle Building' && Number(macros.protein_100g || 0) >= 12) {
    score += 10;
    warningChips.push('✓ High Protein');
  }

  // Clamp final score 0-100
  const finalScore = Math.max(0, Math.min(100, Math.round(score)));

  // Generate short 1-line verdict
  let verdict = 'Balanced nutritional option for your profile.';
  if (finalScore < 40) {
    verdict = 'High in sugar or processed fats. Limit for your goals.';
  } else if (finalScore < 70) {
    verdict = 'Moderate nutritional profile. Enjoy in sensible portions.';
  } else {
    verdict = 'Great nutritional choice! Aligns well with your health goals.';
  }

  return {
    personalized_health_score: finalScore,
    personalized_grade: getGrade(finalScore),
    verdict,
    warning_chips: warningChips.length > 0 ? warningChips : ['✓ Balanced Choice'],
    is_allergen_hazard: false
  };
}

module.exports = {
  getGrade,
  calculateBaseScore,
  calculatePersonalizedScore
};
