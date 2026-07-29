const axios = require('axios');
const { query } = require('../config/database');
const { getModel } = require('../config/gemini');
require('dotenv').config();

const BASE_URL = process.env.OPENFOODFACTS_BASE_URL || 'https://world.openfoodfacts.org/api/v2';

/**
 * Extracts and normalizes nutriments object from OpenFoodFacts product JSON
 */
function extractOFFNutriments(nutriments = {}) {
  let calories = Number(
    nutriments['energy-kcal_100g'] ??
    nutriments['energy-kcal_value'] ??
    nutriments['energy-kcal'] ??
    nutriments['energy-kcal_serving'] ??
    0
  );

  if (!calories && (nutriments['energy_100g'] || nutriments['energy_value'] || nutriments['energy'])) {
    const kj = Number(nutriments['energy_100g'] || nutriments['energy_value'] || nutriments['energy']);
    if (kj > 0) calories = Math.round(kj / 4.184);
  }

  const protein = Number(
    nutriments['proteins_100g'] ??
    nutriments['proteins_value'] ??
    nutriments['proteins'] ??
    0
  );

  const carbs = Number(
    nutriments['carbohydrates_100g'] ??
    nutriments['carbohydrates_value'] ??
    nutriments['carbohydrates'] ??
    0
  );

  const sugar = Number(
    nutriments['sugars_100g'] ??
    nutriments['sugars_value'] ??
    nutriments['sugars'] ??
    0
  );

  const fat = Number(
    nutriments['fat_100g'] ??
    nutriments['fat_value'] ??
    nutriments['fat'] ??
    0
  );

  const satFat = Number(
    nutriments['saturated-fat_100g'] ??
    nutriments['saturated-fat_value'] ??
    nutriments['saturated-fat'] ??
    nutriments['saturated_fat_100g'] ??
    0
  );

  const fiber = Number(
    nutriments['fiber_100g'] ??
    nutriments['fiber_value'] ??
    nutriments['fiber'] ??
    0
  );

  let sodiumMg = Math.round(Number(nutriments['sodium_100g'] ?? nutriments['sodium_value'] ?? nutriments['sodium'] ?? 0) * 1000);
  if (!sodiumMg && (nutriments['salt_100g'] || nutriments['salt_value'] || nutriments['salt'])) {
    const saltG = Number(nutriments['salt_100g'] || nutriments['salt_value'] || nutriments['salt']);
    sodiumMg = Math.round(saltG * 400);
  }

  return {
    calories_100g: calories,
    protein_100g: protein,
    carbs_100g: carbs,
    sugar_100g: sugar,
    fat_100g: fat,
    sat_fat_100g: satFat,
    fiber_100g: fiber,
    sodium_mg_100g: sodiumMg
  };
}

/**
 * Checks if a macros object has non-zero valid nutritional values
 */
function hasValidNutriments(macros) {
  if (!macros) return false;
  return (macros.calories_100g > 0 || macros.carbs_100g > 0 || macros.protein_100g > 0 || macros.fat_100g > 0);
}

/**
 * Uses Gemini AI to estimate realistic per-100g macros when a product is missing nutrition data
 */
async function enrichMacrosWithAI(productName, brand = '') {
  try {
    console.log(`[Nutrition Enricher] Product "${productName}" has missing/zero nutriments. Enriching via Gemini AI...`);
    const model = getModel('gemini-2.5-flash');
    const prompt = `You are MayiEat's AI Nutrition Specialist.
Provide accurate, realistic per 100g nutritional values for the commercial food/beverage product "${productName}" (Brand: "${brand || 'Generic'}").

Respond ONLY with a valid raw JSON object (no markdown, no backticks):
{
  "calories_100g": 320,
  "protein_100g": 0.3,
  "carbs_100g": 80.0,
  "sugar_100g": 80.0,
  "fat_100g": 0.0,
  "sat_fat_100g": 0.0,
  "fiber_100g": 0.0,
  "sodium_mg_100g": 12
}`;

    const res = await model.generateContent(prompt);
    const text = res.response.text();
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (parsed && hasValidNutriments(parsed)) {
      console.log(`[Nutrition Enricher] Successfully enriched nutrition for "${productName}":`, parsed);
      return {
        calories_100g: Number(parsed.calories_100g || 0),
        protein_100g: Number(parsed.protein_100g || 0),
        carbs_100g: Number(parsed.carbs_100g || 0),
        sugar_100g: Number(parsed.sugar_100g || 0),
        fat_100g: Number(parsed.fat_100g || 0),
        sat_fat_100g: Number(parsed.sat_fat_100g || 0),
        fiber_100g: Number(parsed.fiber_100g || 0),
        sodium_mg_100g: Number(parsed.sodium_mg_100g || 0)
      };
    }
  } catch (err) {
    console.error(`[Nutrition Enricher] Failed to enrich nutrition for "${productName}":`, err.message);
  }
  return null;
}

/**
 * Fetches product metadata & nutrition details by barcode.
 * Multi-tier resolution strategy:
 * 1. Local Database cache query (foods & nutrition_facts)
 * 2. OpenFoodFacts API lookup (v2, v0, regional)
 * 3. Google Gemini AI Barcode Product Resolver fallback for unlisted barcodes
 * 
 * @param {string} barcode
 */
async function getProductByBarcode(barcode) {
  if (!barcode) return { found: false, barcode: '' };

  const cleanBarcode = barcode.trim();

  // Tier 1: Check local database cache (only if cached record has non-zero valid nutriments)
  try {
    const dbRes = await query(
      `SELECT f.*, nf.calories_100g, nf.protein_100g, nf.carbs_100g, nf.sugar_100g, 
              nf.fat_100g, nf.sat_fat_100g, nf.fiber_100g, nf.sodium_mg_100g
       FROM foods f
       LEFT JOIN nutrition_facts nf ON f.food_id = nf.food_id
       WHERE f.barcode = $1`,
      [cleanBarcode]
    );

    if (dbRes.rows.length > 0) {
      const row = dbRes.rows[0];
      const cachedMacros = {
        calories_100g: Number(row.calories_100g || 0),
        protein_100g: Number(row.protein_100g || 0),
        carbs_100g: Number(row.carbs_100g || 0),
        sugar_100g: Number(row.sugar_100g || 0),
        fat_100g: Number(row.fat_100g || 0),
        sat_fat_100g: Number(row.sat_fat_100g || 0),
        fiber_100g: Number(row.fiber_100g || 0),
        sodium_mg_100g: Number(row.sodium_mg_100g || 0)
      };

      if (hasValidNutriments(cachedMacros)) {
        console.log(`[Product Resolver] Barcode ${cleanBarcode} retrieved from local DB cache with valid nutriments.`);
        return {
          found: true,
          barcode: cleanBarcode,
          product_name: row.product_name,
          brand: row.brand || 'Generic Brand',
          package_size: row.package_size || '1 portion',
          image_url: row.image_url || '',
          ingredients_text: '',
          ingredients: [],
          nova_group: 4,
          allergens: [],
          nutrient_levels: {},
          macros_per_100g: cachedMacros,
          data_source: row.data_source || 'Local Database'
        };
      } else {
        console.log(`[Product Resolver] Cached local DB record for ${cleanBarcode} (${row.product_name}) has empty nutriments. Re-enriching...`);
      }
    }
  } catch (dbErr) {
    console.warn(`[Product Resolver] Local DB cache check error for ${cleanBarcode}:`, dbErr.message);
  }

  // Tier 2: Fetch from OpenFoodFacts API
  const offEndpoints = [
    `${BASE_URL}/product/${cleanBarcode}.json`,
    `https://world.openfoodfacts.org/api/v0/product/${cleanBarcode}.json`,
    `https://in.openfoodfacts.org/api/v2/product/${cleanBarcode}.json`
  ];

  for (const endpoint of offEndpoints) {
    try {
      const response = await axios.get(endpoint, {
        headers: {
          'User-Agent': 'MayiEatApp/1.0 (contact@mayieat.com)'
        },
        timeout: 4000
      });

      if (response.data && response.data.status === 1 && response.data.product) {
        const p = response.data.product;
        let officialImageUrl = p.image_front_url || p.image_url || '';
        if (!officialImageUrl && p.selected_images && p.selected_images.front && p.selected_images.front.display) {
          officialImageUrl = p.selected_images.front.display.en || p.selected_images.front.display.fr || Object.values(p.selected_images.front.display)[0] || '';
        }

        const allergens = Array.isArray(p.allergens_tags)
          ? p.allergens_tags.map(a => a.replace(/^[a-z]+:/, '').replaceAll('-', ' '))
          : (typeof p.allergens === 'string' ? p.allergens.split(',') : []);

        const productName = p.product_name || p.product_name_en || 'Unknown Product';
        const brand = p.brands || 'Generic Brand';

        let macros = extractOFFNutriments(p.nutriments);
        let dataSource = 'OpenFoodFacts';

        // If OpenFoodFacts nutriments are missing or all zero, enrich using Gemini AI
        if (!hasValidNutriments(macros)) {
          const aiEnriched = await enrichMacrosWithAI(productName, brand);
          if (aiEnriched) {
            macros = aiEnriched;
            dataSource = 'OpenFoodFacts + Gemini AI';
          }
        }

        console.log(`[Product Resolver] Barcode ${cleanBarcode} retrieved from OpenFoodFacts (${dataSource}).`);
        return {
          found: true,
          barcode: cleanBarcode,
          product_name: productName,
          brand: brand,
          package_size: p.quantity || '1 portion',
          image_url: officialImageUrl,
          ingredients_text: p.ingredients_text || p.ingredients_text_en || '',
          ingredients: Array.isArray(p.ingredients) ? p.ingredients.map(i => i.text) : [],
          nova_group: p.nova_group || p.nova_groups || null,
          allergens: allergens,
          nutrient_levels: p.nutrient_levels || {},
          macros_per_100g: macros,
          data_source: dataSource
        };
      }
    } catch (error) {
      // Continue to next endpoint or Gemini fallback
    }
  }

  // Tier 3: Gemini AI Barcode Product Resolver Fallback
  try {
    console.log(`[Product Resolver] Barcode ${cleanBarcode} not found in OpenFoodFacts. Triggering Gemini AI Resolver...`);
    const model = getModel('gemini-2.5-flash');

    const prompt = `You are MayiEat's AI Product & Nutrition Specialist.
Identify the commercial packaged food or beverage item associated with barcode "${cleanBarcode}".
Provide accurate product details and nutrition per 100g based on global/regional product databases (such as Indian GTIN 890..., EAN-13, UPC).
If the barcode represents a known product (for example, Patanjali Honey, Balaji Cheese Chilli Nachos, Bingo Yumitos), return its exact product name, brand, package size, ingredients, and nutrition facts.
If the exact product name is unlisted, provide a plausible packaged snack/food profile for this category.

Respond ONLY with a valid raw JSON object (no markdown, no backticks):
{
  "found": true,
  "barcode": "${cleanBarcode}",
  "product_name": "Product Name",
  "brand": "Brand Name",
  "package_size": "Package quantity e.g. 45g",
  "image_url": "",
  "ingredients_text": "Ingredient list",
  "ingredients": ["Ingredient 1", "Ingredient 2"],
  "nova_group": 4,
  "allergens": [],
  "macros_per_100g": {
    "calories_100g": 520,
    "protein_100g": 7.0,
    "carbs_100g": 62.0,
    "sugar_100g": 3.0,
    "fat_100g": 27.0,
    "sat_fat_100g": 12.0,
    "fiber_100g": 4.5,
    "sodium_mg_100g": 780
  }
}`;

    const aiResult = await model.generateContent(prompt);
    const text = aiResult.response.text();
    const cleanedJson = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanedJson);

    if (parsed && parsed.found && parsed.product_name) {
      console.log(`[Product Resolver] Gemini AI successfully resolved barcode ${cleanBarcode} to "${parsed.product_name}".`);
      return {
        found: true,
        barcode: cleanBarcode,
        product_name: parsed.product_name,
        brand: parsed.brand || 'Generic Brand',
        package_size: parsed.package_size || '1 portion',
        image_url: parsed.image_url || '',
        ingredients_text: parsed.ingredients_text || '',
        ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
        nova_group: parsed.nova_group || 4,
        allergens: Array.isArray(parsed.allergens) ? parsed.allergens : [],
        nutrient_levels: {},
        macros_per_100g: {
          calories_100g: Number(parsed.macros_per_100g?.calories_100g || 0),
          protein_100g: Number(parsed.macros_per_100g?.protein_100g || 0),
          carbs_100g: Number(parsed.macros_per_100g?.carbs_100g || 0),
          sugar_100g: Number(parsed.macros_per_100g?.sugar_100g || 0),
          fat_100g: Number(parsed.macros_per_100g?.fat_100g || 0),
          sat_fat_100g: Number(parsed.macros_per_100g?.sat_fat_100g || 0),
          fiber_100g: Number(parsed.macros_per_100g?.fiber_100g || 0),
          sodium_mg_100g: Number(parsed.macros_per_100g?.sodium_mg_100g || 0)
        },
        data_source: 'Gemini AI'
      };
    }
  } catch (aiErr) {
    console.error(`[Product Resolver] Gemini AI fallback lookup failed for barcode ${cleanBarcode}:`, aiErr.message);
  }

  return { found: false, barcode: cleanBarcode };
}

module.exports = {
  getProductByBarcode
};


