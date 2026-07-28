const { query } = require('../config/database');

/**
 * Log a meal item to today's user diary
 * POST /api/v1/meals/log
 */
async function logMeal(req, res) {
  try {
    const userId = req.user.user_id;
    const {
      food_id,
      custom_name,
      meal_type,
      portion_grams,
      personalized_score,
      calories,
      protein_g,
      carbs_g,
      fat_g
    } = req.body;

    const mType = (meal_type || 'LUNCH').toUpperCase();
    const pGrams = parseFloat(portion_grams) || 100;
    const score = parseInt(personalized_score, 10) || 50;

    // Check if a meal_log header exists for today and this meal_type
    const todayLogRes = await query(
      `SELECT log_id FROM meal_logs 
       WHERE user_id = $1 AND meal_type = $2 AND DATE(logged_at) = CURRENT_DATE`,
      [userId, mType]
    );

    let logId;
    if (todayLogRes.rows.length > 0) {
      logId = todayLogRes.rows[0].log_id;
    } else {
      // Create new meal_log header
      const newLog = await query(
        `INSERT INTO meal_logs (user_id, meal_type, total_calories, average_score)
         VALUES ($1, $2, 0, $3)
         RETURNING log_id`,
        [userId, mType, score]
      );
      logId = newLog.rows[0].log_id;
    }

    // Insert item into meal_items
    const itemInsert = await query(
      `INSERT INTO meal_items 
       (log_id, food_id, custom_name, portion_grams, personalized_score, calories, protein_g, carbs_g, fat_g)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        logId,
        food_id || null,
        custom_name || 'Scanned Food Item',
        pGrams,
        score,
        parseFloat(calories) || 0,
        parseFloat(protein_g) || 0,
        parseFloat(carbs_g) || 0,
        parseFloat(fat_g) || 0
      ]
    );

    // Recalculate totals for the meal_log header
    await query(
      `UPDATE meal_logs SET
         total_calories = (SELECT COALESCE(SUM(calories), 0) FROM meal_items WHERE log_id = $1),
         total_protein_g = (SELECT COALESCE(SUM(protein_g), 0) FROM meal_items WHERE log_id = $1),
         total_carbs_g = (SELECT COALESCE(SUM(carbs_g), 0) FROM meal_items WHERE log_id = $1),
         total_fat_g = (SELECT COALESCE(SUM(fat_g), 0) FROM meal_items WHERE log_id = $1),
         average_score = (SELECT COALESCE(ROUND(AVG(personalized_score)), 50) FROM meal_items WHERE log_id = $1)
       WHERE log_id = $1`,
      [logId]
    );

    return res.status(201).json({
      success: true,
      message: 'Meal item logged successfully!',
      data: itemInsert.rows[0]
    });
  } catch (error) {
    console.error('Log Meal Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error logging meal: ' + error.message
    });
  }
}

/**
 * Get Today's Macro Summary & Logged Meals
 * GET /api/v1/meals/today
 */
async function getTodaySummary(req, res) {
  try {
    const userId = req.user.user_id;

    // Aggregate today's macros
    const summaryRes = await query(
      `SELECT 
         COALESCE(SUM(total_calories), 0) AS total_calories,
         COALESCE(SUM(total_protein_g), 0) AS total_protein_g,
         COALESCE(SUM(total_carbs_g), 0) AS total_carbs_g,
         COALESCE(SUM(total_fat_g), 0) AS total_fat_g,
         COALESCE(ROUND(AVG(average_score)), 0) AS average_score
       FROM meal_logs
       WHERE user_id = $1 AND DATE(logged_at) = CURRENT_DATE`,
      [userId]
    );

    // Fetch today's meal items
    const mealsRes = await query(
      `SELECT ml.log_id, ml.meal_type, ml.logged_at, mi.item_id, mi.custom_name, mi.portion_grams,
              mi.personalized_score, mi.calories, mi.protein_g, mi.carbs_g, mi.fat_g, f.image_url
       FROM meal_logs ml
       JOIN meal_items mi ON ml.log_id = mi.log_id
       LEFT JOIN foods f ON mi.food_id = f.food_id
       WHERE ml.user_id = $1 AND DATE(ml.logged_at) = CURRENT_DATE
       ORDER BY ml.logged_at DESC`,
      [userId]
    );

    const summary = summaryRes.rows[0];

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          total_calories: parseFloat(summary.total_calories),
          total_protein_g: parseFloat(summary.total_protein_g),
          total_carbs_g: parseFloat(summary.total_carbs_g),
          total_fat_g: parseFloat(summary.total_fat_g),
          average_score: parseInt(summary.average_score, 10)
        },
        items: mealsRes.rows
      }
    });
  } catch (error) {
    console.error('Get Today Summary Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching today summary.'
    });
  }
}

/**
 * Get Meal History Logged
 * GET /api/v1/meals/history
 */
async function getHistory(req, res) {
  try {
    const userId = req.user.user_id;

    const historyRes = await query(
      `SELECT ml.log_id, ml.meal_type, ml.logged_at, ml.total_calories, ml.average_score,
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  'item_id', mi.item_id,
                  'custom_name', mi.custom_name,
                  'portion_grams', mi.portion_grams,
                  'personalized_score', mi.personalized_score,
                  'calories', mi.calories,
                  'protein_g', mi.protein_g,
                  'image_url', f.image_url
                )
              ) AS items
       FROM meal_logs ml
       LEFT JOIN meal_items mi ON ml.log_id = mi.log_id
       LEFT JOIN foods f ON mi.food_id = f.food_id
       WHERE ml.user_id = $1
       GROUP BY ml.log_id
       ORDER BY ml.logged_at DESC
       LIMIT 50`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      data: historyRes.rows
    });
  } catch (error) {
    console.error('Get History Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching meal history.'
    });
  }
}

module.exports = {
  logMeal,
  getTodaySummary,
  getHistory
};
