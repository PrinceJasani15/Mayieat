const express = require('express');
const router = express.Router();

const authenticateJWT = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

const authController = require('../controllers/auth.controller');
const profileController = require('../controllers/profile.controller');
const scanController = require('../controllers/scan.controller');
const mealController = require('../controllers/meal.controller');
const coachController = require('../controllers/coach.controller');

// =============================================================================
// AUTH ROUTES
// =============================================================================
router.post('/auth/signup', authController.signup);
router.post('/auth/login', authController.login);
router.get('/auth/me', authenticateJWT, authController.getMe);

// =============================================================================
// HEALTH PROFILE ROUTES
// =============================================================================
router.get('/profile', authenticateJWT, profileController.getProfile);
router.post('/profile', authenticateJWT, profileController.saveProfile);
router.put('/profile', authenticateJWT, profileController.saveProfile);
router.post('/profile/avatar', authenticateJWT, upload.single('avatar'), profileController.uploadAvatar);
router.post('/profile/change-password', authenticateJWT, profileController.changePassword);
router.get('/profile/achievements', authenticateJWT, profileController.getAchievements);

// =============================================================================
// SCANNING ROUTES (BARCODE & CAMERA PHOTO)
// =============================================================================
router.get('/scan/barcode/:code', authenticateJWT, scanController.scanBarcode);
router.post('/scan/detect-barcode', authenticateJWT, upload.single('photo'), scanController.detectBarcode);
router.post('/scan/photo', authenticateJWT, upload.single('photo'), scanController.scanPhoto);

// =============================================================================
// MEAL LOGGING & DIARY ROUTES
// =============================================================================
router.post('/meals/log', authenticateJWT, mealController.logMeal);
router.get('/meals/today', authenticateJWT, mealController.getTodaySummary);
router.get('/meals/history', authenticateJWT, mealController.getHistory);

// =============================================================================
// AI NUTRITION COACH ROUTES
// =============================================================================
router.post('/coach/chat', authenticateJWT, coachController.chat);
router.post('/ai/nutrition', coachController.chat); // Direct AI endpoint support
router.get('/coach/history', authenticateJWT, coachController.getCoachHistory);

module.exports = router;
