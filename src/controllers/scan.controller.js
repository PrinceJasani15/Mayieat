const path = require('path');
const { query } = require('../config/database');
const { getProductByBarcode } = require('../services/openFoodFacts.service');
const { analyzeMealPhoto } = require('../services/geminiVision.service');
const { detectBarcodeFromImage } = require('../services/barcodeDetector.service');
const { calculateBaseScore, calculatePersonalizedScore } = require('../utils/scoreCalculator');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

/**
 * Scan Food Barcode Endpoint
 * GET /api/v1/scan/barcode/:code
 */
async function scanBarcode(req, res) {
  try {
    const barcode = req.params.code;
    const userId = req.user ? req.user.user_id : null;

    console.log(`OpenFoodFacts API URL: https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);

    // Fetch product details from OpenFoodFacts
    const product = await getProductByBarcode(barcode);

    if (!product.found) {
      console.log(`API Status: 404 - Product barcode ${barcode} not found.`);
      return res.status(404).json({
        success: false,
        message: `Barcode ${barcode} not found in OpenFoodFacts database.`
      });
    }

    console.log(`API Status: 200`);
    console.log(`Product Found: ${product.product_name}`);
    console.log(`Product Image URL: ${product.image_url}`);

    // Fetch User Health Profile if authenticated
    let userProfile = {};
    if (userId) {
      const profileRes = await query('SELECT * FROM health_profiles WHERE user_id = $1', [userId]);
      if (profileRes.rows.length > 0) {
        userProfile = profileRes.rows[0];
      }
    }

    // Calculate Base Nutri-Score & Personalized Health Score
    const base = calculateBaseScore(product.macros_per_100g, product.ingredients);
    const personalized = calculatePersonalizedScore(
      base.base_nutri_score,
      product.macros_per_100g,
      userProfile,
      product.ingredients
    );

    // Save or upsert food record in database for historical reference
    const foodUpsert = await query(
      `INSERT INTO foods (barcode, product_name, brand, package_size, image_url, base_nutri_score, nutri_grade, data_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (barcode) DO UPDATE SET
         product_name = EXCLUDED.product_name,
         brand = EXCLUDED.brand,
         base_nutri_score = EXCLUDED.base_nutri_score,
         nutri_grade = EXCLUDED.nutri_grade,
         data_source = EXCLUDED.data_source,
         updated_at = CURRENT_TIMESTAMP
       RETURNING food_id`,
      [
        product.barcode,
        product.product_name,
        product.brand,
        product.package_size,
        product.image_url,
        base.base_nutri_score,
        base.base_grade,
        product.data_source || 'OpenFoodFacts'
      ]
    );

    const foodId = foodUpsert.rows[0].food_id;

    // Save or upsert nutrition facts table
    if (product.macros_per_100g) {
      await query(
        `INSERT INTO nutrition_facts (
           food_id, calories_100g, protein_100g, carbs_100g, sugar_100g, fat_100g, sat_fat_100g, fiber_100g, sodium_mg_100g
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (food_id) DO UPDATE SET
           calories_100g = EXCLUDED.calories_100g,
           protein_100g = EXCLUDED.protein_100g,
           carbs_100g = EXCLUDED.carbs_100g,
           sugar_100g = EXCLUDED.sugar_100g,
           fat_100g = EXCLUDED.fat_100g,
           sat_fat_100g = EXCLUDED.sat_fat_100g,
           fiber_100g = EXCLUDED.fiber_100g,
           sodium_mg_100g = EXCLUDED.sodium_mg_100g`,
        [
          foodId,
          product.macros_per_100g.calories_100g || 0,
          product.macros_per_100g.protein_100g || 0,
          product.macros_per_100g.carbs_100g || 0,
          product.macros_per_100g.sugar_100g || 0,
          product.macros_per_100g.fat_100g || 0,
          product.macros_per_100g.sat_fat_100g || 0,
          product.macros_per_100g.fiber_100g || 0,
          product.macros_per_100g.sodium_mg_100g || 0
        ]
      );
    }

    // Save barcode scan history if user is authenticated
    if (userId) {
      await query(
        `INSERT INTO barcode_scans (user_id, barcode, food_id) VALUES ($1, $2, $3)`,
        [userId, barcode, foodId]
      );
    }

    console.log(`Nutrition Loaded Successfully`);

    const attributionText = product.data_source === 'Gemini AI'
      ? 'Nutrition data & AI resolution by Google Gemini'
      : (product.data_source === 'Local Database' ? 'Nutrition data from Local Database Cache' : 'Nutrition data by OpenFoodFacts · AI by Google Gemini');

    // Return Scan Result Card payload
    return res.status(200).json({
      success: true,
      data: {
        food_id: foodId,
        product: {
          barcode: product.barcode,
          product_name: product.product_name,
          brand: product.brand,
          package_size: product.package_size,
          image_url: product.image_url,
          nova_group: product.nova_group,
          allergens: product.allergens,
          ingredients_text: product.ingredients_text
        },
        scoring: {
          base_nutri_score: base.base_nutri_score,
          base_grade: base.base_grade,
          personalized_health_score: personalized.personalized_health_score,
          personalized_grade: personalized.personalized_grade,
          verdict: personalized.verdict,
          warning_chips: personalized.warning_chips,
          is_allergen_hazard: personalized.is_allergen_hazard
        },
        macros_per_100g: product.macros_per_100g,
        ai_insight: {
          provider: 'Google Gemini',
          explanation: `This product has ${product.macros_per_100g.sugar_100g}g of sugar and ${product.macros_per_100g.sat_fat_100g}g of saturated fat per 100g. ${personalized.verdict}`,
          practical_tip: 'Consider pairing with high-fiber foods to stabilize digestion!'
        },
        attribution: attributionText
      }
    });
  } catch (error) {
    console.error('Scan Barcode Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error analyzing barcode: ' + error.message
    });
  }
}

/**
 * Detect Barcode from Uploaded Barcode Image File Endpoint
 * POST /api/v1/scan/detect-barcode
 * (Used when analyzing barcode photos uploaded via camera or file upload)
 */
async function detectBarcode(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file uploaded. Please attach a barcode image.'
      });
    }

    console.log(`Gallery Image Selected: ${req.file.originalname || req.file.filename}`);
    console.log(`Image Size: ${req.file.size} bytes`);
    console.log(`Barcode Detection Started`);

    const imageInput = req.file.path || req.file.buffer;
    const barcodeResult = await detectBarcodeFromImage(imageInput);

    if (barcodeResult && barcodeResult.found && barcodeResult.barcode) {
      console.log(`Detected Barcode: ${barcodeResult.barcode}`);
      console.log(`Barcode Format: ${barcodeResult.format}`);

      // Forward directly to scanBarcode logic using the extracted barcode
      req.params.code = barcodeResult.barcode;
      return await scanBarcode(req, res);
    }

    console.log(`Barcode Detection Failed: Couldn't detect a barcode.`);
    return res.status(404).json({
      success: false,
      message: "Couldn't detect a barcode. Please capture a clearer image.",
      code: 'NO_BARCODE_DETECTED'
    });
  } catch (error) {
    console.error('Detect Barcode Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error processing barcode image: ' + error.message
    });
  }
}

/**
 * Scan Plate Meal Photo via Gemini Vision API
 * POST /api/v1/scan/photo
 */
async function scanPhoto(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No photo uploaded. Please attach an image file.'
      });
    }

    // First attempt server-side barcode detection
    const imageInput = req.file.path || req.file.buffer;
    const barcodeResult = await detectBarcodeFromImage(imageInput);

    if (barcodeResult && barcodeResult.found && barcodeResult.barcode) {
      console.log(`ScanPhoto found barcode ${barcodeResult.barcode}! Bypassing Gemini Vision and using OpenFoodFacts.`);
      req.params.code = barcodeResult.barcode;
      return await scanBarcode(req, res);
    }

    // If no barcode detected and request came to photo endpoint, run Gemini Vision for Meal Plate analysis
    const userId = req.user ? req.user.user_id : null;
    const imageUrl = req.file.path || req.file.secure_url;

    // Analyze photo using Google Gemini Vision AI
    const visionResult = await analyzeMealPhoto(imageUrl);

    // Fetch User Health Profile if authenticated
    let userProfile = {};
    if (userId) {
      const profileRes = await query('SELECT * FROM health_profiles WHERE user_id = $1', [userId]);
      if (profileRes.rows.length > 0) {
        userProfile = profileRes.rows[0];
      }
    }

    // Calculate Base Nutri-Score & Personalized Health Score
    const base = calculateBaseScore(visionResult.macros_per_100g, visionResult.detected_items);
    const personalized = calculatePersonalizedScore(
      base.base_nutri_score,
      visionResult.macros_per_100g,
      userProfile,
      visionResult.detected_items
    );

    // Save food record in database
    const foodInsert = await query(
      `INSERT INTO foods (product_name, brand, package_size, image_url, base_nutri_score, nutri_grade, data_source)
       VALUES ($1, $2, $3, $4, $5, $6, 'GeminiVision')
       RETURNING food_id`,
      [
        visionResult.product_name,
        'AI Photo Recognition',
        `${visionResult.estimated_portion_grams}g portion`,
        imageUrl,
        base.base_nutri_score,
        base.base_grade
      ]
    );

    const foodId = foodInsert.rows[0].food_id;

    // Return Scan Result Card payload
    return res.status(200).json({
      success: true,
      data: {
        food_id: foodId,
        product: {
          barcode: null,
          product_name: visionResult.product_name,
          brand: 'AI Photo Recognition',
          package_size: `${visionResult.estimated_portion_grams}g portion`,
          image_url: imageUrl,
          detected_items: visionResult.detected_items
        },
        scoring: {
          base_nutri_score: base.base_nutri_score,
          base_grade: base.base_grade,
          personalized_health_score: personalized.personalized_health_score,
          personalized_grade: personalized.personalized_grade,
          verdict: personalized.verdict,
          warning_chips: personalized.warning_chips,
          is_allergen_hazard: personalized.is_allergen_hazard
        },
        portion_grams: visionResult.estimated_portion_grams,
        macros_per_100g: visionResult.macros_per_100g,
        accuracy_disclaimer: visionResult.accuracy_disclaimer || 'Estimated nutrition accuracy ±15%.',
        ai_insight: {
          provider: 'Google Gemini Vision',
          explanation: visionResult.ai_explanation,
          practical_tip: visionResult.practical_tip
        },
        attribution: 'Visual Recognition & Nutrition AI by Google Gemini'
      }
    });
  } catch (error) {
    console.error('Scan Photo Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error analyzing meal photo: ' + error.message
    });
  }
}

module.exports = {
  scanBarcode,
  detectBarcode,
  scanPhoto
};
