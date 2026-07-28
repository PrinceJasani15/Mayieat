const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'mayieat_super_secret_jwt_access_key_2026_dev';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Sign up a new user with Email + Password
 */
async function signup(req, res) {
  try {
    const { full_name, email, password } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({
        success: false,
        message: 'Please provide full_name, email, and password.'
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await query('SELECT user_id FROM users WHERE email = $1', [cleanEmail]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists.'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user into PostgreSQL
    const newUserRes = await query(
      `INSERT INTO users (full_name, email, password_hash, is_guest)
       VALUES ($1, $2, $3, false)
       RETURNING user_id, full_name, email, created_at`,
      [full_name.trim(), cleanEmail, passwordHash]
    );

    const user = newUserRes.rows[0];

    // Check if profile exists
    const profileRes = await query('SELECT 1 FROM health_profiles WHERE user_id = $1', [user.user_id]);
    const hasProfile = profileRes.rows.length > 0;

    // Issue JWT Token
    const token = jwt.sign(
      { user_id: user.user_id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      data: {
        token,
        user: {
          user_id: user.user_id,
          full_name: user.full_name,
          email: user.email,
          has_completed_profile: hasProfile
        }
      }
    });
  } catch (error) {
    console.error('Signup Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during signup: ' + error.message
    });
  }
}

/**
 * Log in an existing user with Email + Password
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password.'
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Query user
    const userRes = await query(
      'SELECT user_id, full_name, email, password_hash FROM users WHERE email = $1',
      [cleanEmail]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    const user = userRes.rows[0];

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password_hash || '');
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    // Check if profile exists
    const profileRes = await query('SELECT 1 FROM health_profiles WHERE user_id = $1', [user.user_id]);
    const hasProfile = profileRes.rows.length > 0;

    // Issue JWT Token
    const token = jwt.sign(
      { user_id: user.user_id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully!',
      data: {
        token,
        user: {
          user_id: user.user_id,
          full_name: user.full_name,
          email: user.email,
          has_completed_profile: hasProfile
        }
      }
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login: ' + error.message
    });
  }
}

/**
 * Get Current Logged In User Info
 */
async function getMe(req, res) {
  try {
    const userId = req.user.user_id;

    const userRes = await query(
      'SELECT user_id, full_name, email, is_guest, created_at FROM users WHERE user_id = $1',
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    const user = userRes.rows[0];
    const profileRes = await query('SELECT * FROM health_profiles WHERE user_id = $1', [userId]);

    return res.status(200).json({
      success: true,
      data: {
        user,
        has_completed_profile: profileRes.rows.length > 0,
        profile: profileRes.rows[0] || null
      }
    });
  } catch (error) {
    console.error('GetMe Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching user details.'
    });
  }
}

module.exports = {
  signup,
  login,
  getMe
};
