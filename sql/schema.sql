-- =============================================================================
-- MAYIEAT DATABASE SCHEMA (PostgreSQL DDL)
-- Version: 1.0.0
-- Description: Schema for Users, Health Profiles, Foods, Ingredients,
--              Nutrition Facts, Meal Logs, Subscriptions, Notifications,
--              Reports, and AI Coach Sessions.
-- =============================================================================

-- Enable UUID extension for unique identifier generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. USERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    google_id VARCHAR(255) UNIQUE,
    apple_id VARCHAR(255) UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    avatar_url TEXT,
    membership_plan VARCHAR(50) DEFAULT 'FREE',
    is_guest BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 2. HEALTH PROFILES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_profiles (
    profile_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    dob DATE,
    age INT CHECK (age >= 13 AND age <= 120),
    gender VARCHAR(20),
    height_cm NUMERIC(5,2),
    weight_kg NUMERIC(5,2),
    goal_weight_kg NUMERIC(5,2),
    activity_level VARCHAR(50),
    goal VARCHAR(50),
    medical_conditions TEXT[] DEFAULT '{}', -- E.g. {'Diabetes', 'Hypertension'}
    allergies TEXT[] DEFAULT '{}',          -- E.g. {'Peanut', 'Gluten'}
    diet_preference VARCHAR(50),
    daily_calorie_goal INT DEFAULT 2000,
    water_goal_ml INT DEFAULT 2500,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_profile UNIQUE (user_id)
);

-- -----------------------------------------------------------------------------
-- 3. FOODS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS foods (
    food_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    barcode VARCHAR(100) UNIQUE,
    product_name VARCHAR(255) NOT NULL,
    brand VARCHAR(100),
    package_size VARCHAR(50),
    image_url TEXT,
    base_nutri_score INT CHECK (base_nutri_score BETWEEN 0 AND 100),
    nutri_grade CHAR(1) CHECK (nutri_grade IN ('A', 'B', 'C', 'D', 'E')),
    data_source VARCHAR(50) DEFAULT 'OpenFoodFacts',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 4. NUTRITION FACTS TABLE (Per 100g / 100mL)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nutrition_facts (
    fact_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    food_id UUID NOT NULL REFERENCES foods(food_id) ON DELETE CASCADE,
    calories_100g NUMERIC(6,2) DEFAULT 0,
    protein_100g NUMERIC(5,2) DEFAULT 0,
    carbs_100g NUMERIC(5,2) DEFAULT 0,
    sugar_100g NUMERIC(5,2) DEFAULT 0,
    fat_100g NUMERIC(5,2) DEFAULT 0,
    sat_fat_100g NUMERIC(5,2) DEFAULT 0,
    fiber_100g NUMERIC(5,2) DEFAULT 0,
    sodium_mg_100g NUMERIC(7,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_food_nutrition UNIQUE (food_id)
);

-- -----------------------------------------------------------------------------
-- 5. INGREDIENTS TABLE (Dictionary of Additives & Chemicals)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingredients (
    ingredient_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chemical_name VARCHAR(255) NOT NULL,
    e_number VARCHAR(20) UNIQUE,
    risk_level VARCHAR(20) CHECK (risk_level IN ('SAFE', 'MODERATE', 'HIGH_RISK')),
    health_impact TEXT,
    scientific_explanation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 6. FOOD INGREDIENTS JUNCTION TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS food_ingredients (
    food_id UUID REFERENCES foods(food_id) ON DELETE CASCADE,
    ingredient_id UUID REFERENCES ingredients(ingredient_id) ON DELETE CASCADE,
    PRIMARY KEY (food_id, ingredient_id)
);

-- -----------------------------------------------------------------------------
-- 7. BARCODE SCANS HISTORY
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barcode_scans (
    scan_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    barcode VARCHAR(100) NOT NULL,
    food_id UUID REFERENCES foods(food_id) ON DELETE SET NULL,
    scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 8. MEAL LOGS TABLE (Header for logged meals)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meal_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    meal_type VARCHAR(50) CHECK (meal_type IN ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK')),
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    total_calories NUMERIC(6,2) DEFAULT 0,
    total_protein_g NUMERIC(5,2) DEFAULT 0,
    total_carbs_g NUMERIC(5,2) DEFAULT 0,
    total_fat_g NUMERIC(5,2) DEFAULT 0,
    average_score INT CHECK (average_score BETWEEN 0 AND 100),
    notes TEXT
);

-- -----------------------------------------------------------------------------
-- 9. MEAL ITEMS TABLE (Detailed items inside a meal log)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meal_items (
    item_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_id UUID NOT NULL REFERENCES meal_logs(log_id) ON DELETE CASCADE,
    food_id UUID REFERENCES foods(food_id) ON DELETE SET NULL,
    custom_name VARCHAR(255),
    portion_grams NUMERIC(6,2) NOT NULL DEFAULT 100,
    personalized_score INT CHECK (personalized_score BETWEEN 0 AND 100),
    calories NUMERIC(6,2),
    protein_g NUMERIC(5,2),
    carbs_g NUMERIC(5,2),
    fat_g NUMERIC(5,2)
);

-- -----------------------------------------------------------------------------
-- 10. USER SUBSCRIPTIONS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_subscriptions (
    sub_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    plan_tier VARCHAR(20) DEFAULT 'FREE' CHECK (plan_tier IN ('FREE', 'PRO')),
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'ACTIVE',
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_subscription UNIQUE (user_id)
);

-- -----------------------------------------------------------------------------
-- 11. NOTIFICATIONS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    notification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'GENERAL',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 12. REPORTS TABLE (PDF/Weekly Analytics Metadata)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
    report_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    report_type VARCHAR(50) CHECK (report_type IN ('WEEKLY_SUMMARY', 'NUTRITION_PDF', 'MEDICAL_EXPORT')),
    file_url TEXT,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 13. AI COACH SESSIONS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_coach_sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    chat_history JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_coach_session UNIQUE (user_id)
);

-- =============================================================================
-- INDEXES FOR HIGH-PERFORMANCE QUERYING
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods(barcode);
CREATE INDEX IF NOT EXISTS idx_health_profiles_user_id ON health_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_logs_user_date ON meal_logs(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_meal_items_log_id ON meal_items(log_id);
CREATE INDEX IF NOT EXISTS idx_barcode_scans_user ON barcode_scans(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
