const { query } = require('../config/database');
const { generateCoachResponse } = require('../services/coachLLM.service');

/**
 * AI Nutrition Coach Chat Controller
 * Endpoint: POST /api/ai/nutrition AND POST /api/v1/coach/chat
 * 
 * Request Payload:
 * {
 *    "message": " Can diabetics eat bananas? ",
 *    "medicalFlags": { "diabetes": true, "hypertension": false },
 *    "macros": { "goal": "Weight Loss" }
 * }
 * 
 * Response Payload:
 * {
 *    "success": true,
 *    "reply": "Gemini AI Multilingual Response..."
 * }
 */
async function chat(req, res) {
  try {
    // 1. Validate GEMINI_API_KEY presence
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      console.error('[MayiEat Backend Error] GEMINI_API_KEY is not defined in process.env');
      return res.status(500).json({
        success: false,
        message: 'AI Service configuration missing. GEMINI_API_KEY is not configured on the server.'
      });
    }

    const { message, medicalFlags, macros, history: clientHistory } = req.body;

    // 2. Validate Message Input
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid question message.'
      });
    }

    // 3. UTF-8 & Length Sanitization (Limit max 1000 characters)
    const sanitizedMessage = String(message).trim();
    if (sanitizedMessage.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Question is too long. Please keep your message under 1000 characters.'
      });
    }

    // Helper to validate UUID format for PostgreSQL queries
    const isValidUuid = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    // 4. Fetch User Profile & Chat History for Memory Context
    let userProfile = {};
    let conversationHistory = Array.isArray(clientHistory) ? clientHistory : [];

    if (req.user && isValidUuid(req.user.user_id)) {
      const userId = req.user.user_id;

      try {
        // Fetch saved Health Profile from DB
        const profileRes = await query('SELECT * FROM health_profiles WHERE user_id = $1', [userId]);
        if (profileRes.rows.length > 0) {
          userProfile = profileRes.rows[0];
        }

        // Fetch saved Chat History from DB for memory context
        if (conversationHistory.length === 0) {
          const sessionRes = await query('SELECT chat_history FROM ai_coach_sessions WHERE user_id = $1', [userId]);
          if (sessionRes.rows.length > 0) {
            conversationHistory = sessionRes.rows[0].chat_history || [];
          }
        }
      } catch (dbReadErr) {
        console.warn('[MayiEat AI Coach] Non-fatal DB read warning:', dbReadErr.message);
      }
    }

    // Direct payload overrides if provided
    if (medicalFlags) {
      const conds = [];
      if (medicalFlags.diabetes) conds.push('Diabetes');
      if (medicalFlags.hypertension) conds.push('Hypertension / Heart Disease');
      if (medicalFlags.ckd) conds.push('Chronic Kidney Disease (CKD)');
      userProfile.medical_conditions = conds;
    }
    if (macros && macros.goal) {
      userProfile.goal = macros.goal;
    }

    // 5. Call Gemini AI Service with Chat History Memory
    console.log(`[MayiEat AI Coach] Processing query: "${sanitizedMessage.substring(0, 60)}..."`);
    const replyText = await generateCoachResponse(sanitizedMessage, conversationHistory, userProfile);

    // 6. Save Session History in PostgreSQL if authenticated with valid UUID
    if (req.user && isValidUuid(req.user.user_id)) {
      try {
        const userId = req.user.user_id;
        const updatedHistory = [...conversationHistory];
        updatedHistory.push({ role: 'user', content: sanitizedMessage, timestamp: new Date().toISOString() });
        updatedHistory.push({ role: 'assistant', content: replyText, timestamp: new Date().toISOString() });

        await query(
          `INSERT INTO ai_coach_sessions (user_id, chat_history)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET
             chat_history = EXCLUDED.chat_history,
             updated_at = CURRENT_TIMESTAMP`,
          [userId, JSON.stringify(updatedHistory.slice(-20))] // Retain last 20 messages for context
        );
      } catch (dbWriteErr) {
        console.warn('[MayiEat AI Coach] Non-fatal DB session save warning:', dbWriteErr.message);
      }
    }

    // 7. Return JSON adhering exactly to specification
    return res.status(200).json({
      success: true,
      reply: replyText
    });

  } catch (error) {
    // Log the EXACT backend error for debugging
    console.error('[MayiEat Backend Gemini Error Detail]:', error);

    const errMsg = error.message || '';

    if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID')) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google Gemini API key. Please verify your GEMINI_API_KEY in .env.'
      });
    }

    if (errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate limit')) {
      return res.status(429).json({
        success: false,
        message: 'The AI service is experiencing high traffic. Please try again in a few moments.'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Unable to process your request at this time. Please try again later.'
    });
  }
}

/**
 * Fetch Chat History for authenticated user
 * GET /api/v1/coach/history
 */
async function getCoachHistory(req, res) {
  try {
    if (!req.user || !req.user.user_id) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const userId = req.user.user_id;
    const sessionRes = await query('SELECT chat_history FROM ai_coach_sessions WHERE user_id = $1', [userId]);

    if (sessionRes.rows.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    return res.status(200).json({
      success: true,
      data: sessionRes.rows[0].chat_history || []
    });
  } catch (error) {
    console.error('[Get Coach History Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch AI Coach history.'
    });
  }
}

module.exports = {
  chat,
  getCoachHistory
};
