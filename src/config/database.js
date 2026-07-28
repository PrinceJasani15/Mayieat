const { Pool } = require('pg');
require('dotenv').config();

// Construct PostgreSQL Pool configuration
const isSSLRequired =
  !!process.env.DATABASE_URL &&
  (process.env.DATABASE_URL.includes('neon.tech') ||
    process.env.DATABASE_URL.includes('sslmode=require') ||
    process.env.DB_SSL === 'true');

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: isSSLRequired ? { rejectUnauthorized: false } : false,
      max: 20, // Max concurrent client connections in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_NAME || 'mayieat_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

const pool = new Pool(poolConfig);

// Pool event listeners
pool.on('connect', () => {
  console.log('PostgreSQL database pool connected successfully.');
});

async function runAutoMigrations() {
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_plan VARCHAR(50) DEFAULT 'FREE';

      ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS dob DATE;
      ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS goal_weight_kg NUMERIC(5,2);
      ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS daily_calorie_goal INT DEFAULT 2000;
      ALTER TABLE health_profiles ADD COLUMN IF NOT EXISTS water_goal_ml INT DEFAULT 2500;
    `);
    console.log('Database auto-migrations executed successfully.');
  } catch (err) {
    console.warn('Auto migration warning:', err.message);
  }
}

runAutoMigrations();

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err ? err.message : err);
  // Do NOT call process.exit(-1) on serverless lambdas to prevent crashing Vercel functions
});

/**
 * Execute a SQL query using the PostgreSQL connection pool
 * @param {string} text - SQL Query string
 * @param {Array} params - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
const query = (text, params) => pool.query(text, params);

module.exports = {
  pool,
  query,
};
