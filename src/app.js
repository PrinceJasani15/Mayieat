const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const apiRoutes = require('./routes');
const coachController = require('./controllers/coach.controller');
const { pool } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Logging Middleware
app.use(helmet({ crossOriginResourcePolicy: false })); // Allow static image loading across origins
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(morgan('dev'));


// Direct AI Endpoint (as specified in API Requirements)
app.post('/api/ai/nutrition', coachController.chat);

// API Health Check
app.get('/api/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT NOW()');
    return res.status(200).json({
      status: 'OK',
      app: 'MayiEat Backend API',
      timestamp: dbCheck.rows[0].now,
      database: 'Connected (PostgreSQL)'
    });
  } catch (error) {
    return res.status(500).json({
      status: 'ERROR',
      message: 'Database connection failed: ' + error.message
    });
  }
});

// Root Route (for Vercel deployment confirmation)
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'OK',
    app: 'MayiEat Backend API',
    message: 'Server is running smoothly on Vercel!',
    healthCheck: '/api/health'
  });
});

// Master REST API Router
app.use('/api/v1', apiRoutes);

// Global 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl} - Route not found.`
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// Start Express Server only when executed directly (not when imported on Vercel serverless)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` MayiEat Backend Server running on http://localhost:${PORT}`);
    console.log(` Health Check: http://localhost:${PORT}/api/health`);
    console.log(` Direct AI Endpoint: http://localhost:${PORT}/api/ai/nutrition`);
    console.log(` Cloudinary Storage: Configured & Active`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
