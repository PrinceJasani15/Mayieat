const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getModel } = require('../config/gemini');

/**
 * Sends image URL, file path, buffer, or base64 to Google Gemini Vision API to analyze plate contents
 * @param {string|Buffer} imageInput - Image URL, local file path, or image buffer
 */
async function analyzeMealPhoto(imageInput) {
  try {
    let imageBase64 = '';
    let mimeType = 'image/jpeg';

    if (typeof imageInput === 'string' && (imageInput.startsWith('http://') || imageInput.startsWith('https://'))) {
      // Download remote image via HTTP GET as ArrayBuffer
      const response = await axios.get(imageInput, { responseType: 'arraybuffer' });
      imageBase64 = Buffer.from(response.data).toString('base64');
      if (response.headers['content-type']) {
        mimeType = response.headers['content-type'];
      }
    } else if (typeof imageInput === 'string' && fs.existsSync(imageInput)) {
      // Read local file from disk
      const fileBuffer = fs.readFileSync(imageInput);
      imageBase64 = fileBuffer.toString('base64');
      const ext = path.extname(imageInput).toLowerCase();
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.webp') mimeType = 'image/webp';
      else mimeType = 'image/jpeg';
    } else if (Buffer.isBuffer(imageInput)) {
      imageBase64 = imageInput.toString('base64');
    } else if (typeof imageInput === 'string') {
      imageBase64 = imageInput;
    } else {
      throw new Error('Invalid image input provided to analyzeMealPhoto');
    }

    const prompt = `
You are MayiEat's AI Vision Nutritionist. Analyze this food plate photo and respond ONLY with a raw JSON object (no markdown, no backticks, no markdown code block markers).

Required JSON Structure:
{
  "product_name": "Short title of detected meal",
  "detected_items": ["Item 1", "Item 2"],
  "estimated_portion_grams": 350,
  "accuracy_disclaimer": "Estimated nutrition accuracy ±15%. Tap to adjust.",
  "macros_per_100g": {
    "calories_100g": 180,
    "protein_100g": 12.5,
    "carbs_100g": 20.0,
    "sugar_100g": 3.5,
    "fat_100g": 6.0,
    "sat_fat_100g": 1.5,
    "fiber_100g": 3.0,
    "sodium_mg_100g": 320
  },
  "ai_explanation": "2-sentence nutritional verdict explaining the meal components and health impact.",
  "practical_tip": "One actionable health advice tip for this meal."
}
`;

    const visionModel = getModel('gemini-2.5-flash');
    const result = await visionModel.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType: mimeType
        }
      }
    ]);

    const responseText = result.response.text();
    const cleanedText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsedData = JSON.parse(cleanedText);

    return parsedData;
  } catch (error) {
    console.error('Gemini Vision meal analysis error:', error.message);
    // Fallback response if Gemini API call fails or key is invalid
    return {
      product_name: 'Custom Scanned Meal',
      detected_items: ['Mixed Meal Dish'],
      estimated_portion_grams: 300,
      accuracy_disclaimer: 'Estimated nutrition accuracy ±15%.',
      macros_per_100g: {
        calories_100g: 210,
        protein_100g: 10.0,
        carbs_100g: 24.0,
        sugar_100g: 4.0,
        fat_100g: 8.0,
        sat_fat_100g: 2.0,
        fiber_100g: 2.5,
        sodium_mg_100g: 400
      },
      ai_explanation: 'Mixed meal with balanced protein and carbohydrates.',
      practical_tip: 'Add a side green salad for extra fiber!'
    };
  }
}

module.exports = {
  analyzeMealPhoto
};
