const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.OPENFOODFACTS_BASE_URL || 'https://world.openfoodfacts.org/api/v2';

/**
 * Fetches product metadata & nutrition details by barcode from OpenFoodFacts
 * @param {string} barcode
 */
async function getProductByBarcode(barcode) {
  try {
    const response = await axios.get(`${BASE_URL}/product/${barcode}.json`, {
      headers: {
        'User-Agent': 'MayiEatApp/1.0 (contact@mayieat.com)'
      },
      timeout: 5000
    });

    if (response.data && response.data.status === 1 && response.data.product) {
      const p = response.data.product;
      const nutriments = p.nutriments || {};

      // Extract official product front image
      let officialImageUrl = p.image_front_url || p.image_url || '';
      if (!officialImageUrl && p.selected_images && p.selected_images.front && p.selected_images.front.display) {
        officialImageUrl = p.selected_images.front.display.en || p.selected_images.front.display.fr || Object.values(p.selected_images.front.display)[0] || '';
      }

      const allergens = Array.isArray(p.allergens_tags)
        ? p.allergens_tags.map(a => a.replace(/^[a-z]+:/, '').replaceAll('-', ' '))
        : (typeof p.allergens === 'string' ? p.allergens.split(',') : []);

      return {
        found: true,
        barcode: barcode,
        product_name: p.product_name || p.product_name_en || 'Unknown Product',
        brand: p.brands || 'Generic Brand',
        package_size: p.quantity || '1 portion',
        image_url: officialImageUrl,
        ingredients_text: p.ingredients_text || p.ingredients_text_en || '',
        ingredients: Array.isArray(p.ingredients) ? p.ingredients.map(i => i.text) : [],
        nova_group: p.nova_group || p.nova_groups || null,
        allergens: allergens,
        nutrient_levels: p.nutrient_levels || {},
        macros_per_100g: {
          calories_100g: Number(nutriments['energy-kcal_100g'] || nutriments['energy-kcal'] || 0),
          protein_100g: Number(nutriments['proteins_100g'] || nutriments['proteins'] || 0),
          carbs_100g: Number(nutriments['carbohydrates_100g'] || nutriments['carbohydrates'] || 0),
          sugar_100g: Number(nutriments['sugars_100g'] || nutriments['sugars'] || 0),
          fat_100g: Number(nutriments['fat_100g'] || nutriments['fat'] || 0),
          sat_fat_100g: Number(nutriments['saturated-fat_100g'] || nutriments['saturated-fat'] || 0),
          fiber_100g: Number(nutriments['fiber_100g'] || nutriments['fiber'] || 0),
          sodium_mg_100g: Math.round(Number(nutriments['sodium_100g'] || 0) * 1000) || Math.round(Number(nutriments['salt_100g'] || 0) * 400)
        }
      };
    }

    return { found: false, barcode };
  } catch (error) {
    console.error(`OpenFoodFacts lookup failed for barcode ${barcode}:`, error.message);
    return { found: false, barcode, error: error.message };
  }
}

module.exports = {
  getProductByBarcode
};
