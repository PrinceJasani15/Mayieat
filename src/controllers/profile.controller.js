const bcrypt = require('bcryptjs');
const { query } = require('../config/database');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

/**
 * Calculates Age from Date of Birth string (YYYY-MM-DD)
 */
function calculateAge(dobStr) {
  if (!dobStr) return 30;
  const birthDate = new Date(dobStr);
  if (isNaN(birthDate.getTime())) return 30;
  
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return Math.max(13, age);
}

/**
 * Calculates BMI & Category
 */
function calculateBMI(weightKg, heightCm) {
  if (!weightKg || !heightCm || heightCm <= 0) {
    return { bmi: 22.0, category: 'Normal' };
  }
  const heightM = heightCm / 100;
  const bmiVal = Number((weightKg / (heightM * heightM)).toFixed(1));

  let category = 'Normal';
  if (bmiVal < 18.5) category = 'Underweight';
  else if (bmiVal >= 25 && bmiVal < 30) category = 'Overweight';
  else if (bmiVal >= 30) category = 'Obese';

  return { bmi: bmiVal, category };
}

/**
 * Fetch authenticated user's complete profile & health metrics
 * GET /api/v1/profile
 */
async function getProfile(req, res) {
  try {
    const userId = req.user.user_id;

    // Query user information
    const userRes = await query(
      'SELECT user_id, full_name, email, phone, avatar_url, membership_plan, created_at FROM users WHERE user_id = $1',
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User account not found.'
      });
    }

    const user = userRes.rows[0];

    // Query health profile
    const profileRes = await query('SELECT * FROM health_profiles WHERE user_id = $1', [userId]);
    const hp = profileRes.rows[0] || {};

    const computedAge = hp.dob ? calculateAge(hp.dob) : (hp.age || 30);
    const weight = parseFloat(hp.weight_kg) || 70.0;
    const height = parseFloat(hp.height_cm) || 170.0;
    const goalWeight = parseFloat(hp.goal_weight_kg) || 68.0;

    const { bmi, category: bmiCategory } = calculateBMI(weight, height);

    // Query total logged meals count
    const mealsCountRes = await query('SELECT COUNT(*) as total FROM meal_logs WHERE user_id = $1', [userId]);
    const totalMeals = parseInt(mealsCountRes.rows[0].total, 10) || 0;

    const profileData = {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone || '',
      avatar_url: user.avatar_url || '',
      membership_plan: user.membership_plan || 'FREE',
      created_at: user.created_at,
      dob: hp.dob ? new Date(hp.dob).toISOString().split('T')[0] : '',
      age: computedAge,
      gender: hp.gender || 'Other',
      height_cm: height,
      weight_kg: weight,
      goal_weight_kg: goalWeight,
      activity_level: hp.activity_level || 'Moderately Active',
      goal: hp.goal || 'Maintenance',
      diet_preference: hp.diet_preference || 'Balanced',
      medical_conditions: Array.isArray(hp.medical_conditions) ? hp.medical_conditions : [],
      allergies: Array.isArray(hp.allergies) ? hp.allergies : [],
      daily_calorie_goal: parseInt(hp.daily_calorie_goal, 10) || 2000,
      water_goal_ml: parseInt(hp.water_goal_ml, 10) || 2500,
      health_summary: {
        current_weight: weight,
        goal_weight: goalWeight,
        bmi: bmi,
        bmi_category: bmiCategory,
        calorie_goal: parseInt(hp.daily_calorie_goal, 10) || 2000,
        water_goal: parseInt(hp.water_goal_ml, 10) || 2500,
        current_streak: 7,
        meals_logged: totalMeals,
        exercise_minutes: 45
      }
    };

    return res.status(200).json({
      success: true,
      data: profileData
    });
  } catch (error) {
    console.error('Get Profile Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching profile: ' + error.message
    });
  }
}

/**
 * Save / Update authenticated user's complete profile
 * POST /api/v1/profile & PUT /api/v1/profile
 */
async function saveProfile(req, res) {
  try {
    const userId = req.user.user_id;
    const {
      full_name,
      phone,
      gender,
      dob,
      age,
      height_cm,
      weight_kg,
      goal_weight_kg,
      activity_level,
      goal,
      medical_conditions,
      allergies,
      diet_preference,
      daily_calorie_goal,
      water_goal_ml
    } = req.body;

    // Update users table if full_name or phone changed
    if (full_name || phone !== undefined) {
      await query(
        `UPDATE users SET 
           full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3`,
        [full_name ? full_name.trim() : null, phone ? phone.trim() : null, userId]
      );
    }

    const calculatedAge = dob ? calculateAge(dob) : (parseInt(age, 10) || 30);
    const condArray = Array.isArray(medical_conditions) ? medical_conditions : [];
    const allergArray = Array.isArray(allergies) ? allergies : [];

    // Upsert health_profiles table
    await query(
      `INSERT INTO health_profiles 
       (user_id, dob, age, gender, height_cm, weight_kg, goal_weight_kg, activity_level, goal, medical_conditions, allergies, diet_preference, daily_calorie_goal, water_goal_ml)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (user_id) DO UPDATE SET
         dob = EXCLUDED.dob,
         age = EXCLUDED.age,
         gender = EXCLUDED.gender,
         height_cm = EXCLUDED.height_cm,
         weight_kg = EXCLUDED.weight_kg,
         goal_weight_kg = EXCLUDED.goal_weight_kg,
         activity_level = EXCLUDED.activity_level,
         goal = EXCLUDED.goal,
         medical_conditions = EXCLUDED.medical_conditions,
         allergies = EXCLUDED.allergies,
         diet_preference = EXCLUDED.diet_preference,
         daily_calorie_goal = EXCLUDED.daily_calorie_goal,
         water_goal_ml = EXCLUDED.water_goal_ml,
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        dob || null,
        calculatedAge,
        gender || 'Other',
        parseFloat(height_cm) || 170.0,
        parseFloat(weight_kg) || 70.0,
        parseFloat(goal_weight_kg) || 68.0,
        activity_level || 'Moderately Active',
        goal || 'Maintenance',
        condArray,
        allergArray,
        diet_preference || 'Balanced',
        parseInt(daily_calorie_goal, 10) || 2000,
        parseInt(water_goal_ml, 10) || 2500
      ]
    );

    // Return updated profile payload
    return await getProfile(req, res);
  } catch (error) {
    console.error('Save Profile Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error saving profile: ' + error.message
    });
  }
}

/**
 * Upload User Profile Picture Avatar
 * POST /api/v1/profile/avatar
 */
async function uploadAvatar(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image attached for avatar upload.'
      });
    }

    const userId = req.user.user_id;
    const localFileName = req.file.filename;
    const avatarUrl = `${BASE_URL}/uploads/${localFileName}`;

    await query(
      'UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      [avatarUrl, userId]
    );

    return res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully!',
      avatar_url: avatarUrl
    });
  } catch (error) {
    console.error('Upload Avatar Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error uploading profile picture: ' + error.message
    });
  }
}

/**
 * Change Password Endpoint
 * POST /api/v1/profile/change-password
 */
async function changePassword(req, res) {
  try {
    const userId = req.user.user_id;
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current_password, new_password, and confirm_password.'
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password do not match.'
      });
    }

    // Validate password complexity requirements
    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long.'
      });
    }
    if (!/[A-Z]/.test(new_password)) {
      return res.status(400).json({
        success: false,
        message: 'New password must contain at least one uppercase letter (A-Z).'
      });
    }
    if (!/[a-z]/.test(new_password)) {
      return res.status(400).json({
        success: false,
        message: 'New password must contain at least one lowercase letter (a-z).'
      });
    }
    if (!/[0-9]/.test(new_password)) {
      return res.status(400).json({
        success: false,
        message: 'New password must contain at least one number (0-9).'
      });
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(new_password)) {
      return res.status(400).json({
        success: false,
        message: 'New password must contain at least one special character (!@#$%^&*).'
      });
    }

    // Query user current password hash
    const userRes = await query('SELECT password_hash FROM users WHERE user_id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = userRes.rows[0];
    const isMatch = await bcrypt.compare(current_password, user.password_hash || '');
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect current password. Please try again.'
      });
    }

    // Hash and update new password
    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(new_password, salt);

    await query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      [newHash, userId]
    );

    return res.status(200).json({
      success: true,
      message: 'Password Updated Successfully'
    });
  } catch (error) {
    console.error('Change Password Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error updating password: ' + error.message
    });
  }
}

/**
 * Fetch Health Achievement Badges
 * GET /api/v1/profile/achievements
 */
async function getAchievements(req, res) {
  try {
    const achievements = [
      {
        id: 'streak_7',
        title: '7 Day Streak',
        description: 'Logged meals consistently for 7 consecutive days',
        icon: 'local_fire_department',
        unlocked: true,
        progress: 1.0
      },
      {
        id: 'meals_30',
        title: '30 Healthy Meals',
        description: 'Log 30 meals with Health Grade A or B',
        icon: 'restaurant',
        unlocked: true,
        progress: 1.0
      },
      {
        id: 'calories_10000',
        title: '10,000 Calories Burned',
        description: 'Burn 10,000 active kcal through fitness goals',
        icon: 'bolt',
        unlocked: true,
        progress: 0.85
      },
      {
        id: 'workouts_50',
        title: '50 Workouts Completed',
        description: 'Complete 50 activity and workout sessions',
        icon: 'fitness_center',
        unlocked: false,
        progress: 0.60
      }
    ];

    return res.status(200).json({
      success: true,
      data: achievements
    });
  } catch (error) {
    console.error('Get Achievements Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching achievements.'
    });
  }
}

module.exports = {
  getProfile,
  saveProfile,
  uploadAvatar,
  changePassword,
  getAchievements
};
