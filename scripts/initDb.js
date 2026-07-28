const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = parseInt(process.env.DB_PORT, 10) || 5432;
const dbUser = process.env.DB_USER || 'postgres';
const dbPassword = process.env.DB_PASSWORD || 'Prince@15';
const targetDb = process.env.DB_NAME || 'mayieat_db';

async function initializeDatabase() {
  const schemaPath = path.join(__dirname, '../sql/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Support direct DATABASE_URL for Neon PostgreSQL cloud migration
  if (process.env.DATABASE_URL) {
    console.log('Connecting to Cloud PostgreSQL Database via DATABASE_URL...');
    const isSSL =
      process.env.DATABASE_URL.includes('neon.tech') ||
      process.env.DATABASE_URL.includes('sslmode=require');
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: isSSL ? { rejectUnauthorized: false } : false,
    });

    try {
      await client.connect();
      console.log('Successfully connected to Cloud PostgreSQL Database.');
      console.log('Executing schema.sql DDL...');
      await client.query(schemaSql);
      console.log('Schema DDL executed successfully! All tables, indexes, and extensions are ready.');
    } catch (err) {
      console.error('Error executing schema.sql on Cloud PostgreSQL:', err.message);
      process.exit(1);
    } finally {
      await client.end();
    }
    return;
  }

  console.log(`Connecting to PostgreSQL server at ${dbHost}:${dbPort} as user '${dbUser}'...`);

  // Step 1: Connect to default 'postgres' database to verify connection & ensure target database exists
  const rootClient = new Client({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: 'postgres',
  });

  try {
    await rootClient.connect();
    console.log('Successfully connected to PostgreSQL root database ("postgres").');

    // Check if target database exists
    const dbCheckRes = await rootClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [targetDb]
    );

    if (dbCheckRes.rowCount === 0) {
      console.log(`Database "${targetDb}" does not exist. Creating database "${targetDb}"...`);
      await rootClient.query(`CREATE DATABASE "${targetDb}"`);
      console.log(`Database "${targetDb}" created successfully.`);
    } else {
      console.log(`Database "${targetDb}" already exists.`);
    }
  } catch (err) {
    console.error('Error verifying/creating PostgreSQL database:', err.message);
    process.exit(1);
  } finally {
    await rootClient.end();
  }

  // Step 2: Connect to the target database and execute schema.sql DDL
  console.log(`Connecting to target database "${targetDb}" to run schema DDL...`);
  const targetClient = new Client({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: targetDb,
  });

  try {
    await targetClient.connect();
    console.log(`Connected to database "${targetDb}".`);

    console.log('Executing schema.sql DDL...');
    await targetClient.query(schemaSql);
    console.log('Schema DDL executed successfully. All tables, functions, and indexes are ready!');
  } catch (err) {
    console.error('Error executing schema.sql:', err.message);
    process.exit(1);
  } finally {
    await targetClient.end();
  }
}

initializeDatabase();
