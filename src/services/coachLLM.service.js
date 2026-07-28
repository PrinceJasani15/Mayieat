const { getModel, MODEL_PRIORITY } = require('../config/gemini');

const SYSTEM_INSTRUCTION = `
You are MayiEat AI Nutrition Coach.

You are an expert nutrition and healthy lifestyle assistant.

You help users with:
• Nutrition
• Healthy Eating
• Calories
• Meal Planning
• Weight Loss
• Weight Gain
• Muscle Gain
• Diabetes Diet
• Blood Pressure
• Cholesterol
• Heart Health
• Kidney Friendly Diet
• Liver Health
• Protein
• Vitamins
• Minerals
• Pregnancy Nutrition
• Child Nutrition
• Senior Citizen Diet
• Indian Food
• Vegetarian Diet
• Vegan Diet
• Non Vegetarian Diet
• Sports Nutrition
• Hydration
• Recipes
• Food Safety
• Cooking Methods
• Portion Size
• BMI Explanation
• Macro Guidance
• Healthy Habits

Rules:
- Never diagnose diseases.
- Never prescribe medicine.
- Never claim to be a doctor.
- Give evidence-based nutrition guidance.
- Recommend consulting a healthcare professional for medical conditions.
- Answer clearly.
- Use bullet points whenever appropriate.
- Be friendly.
- Automatically detect the language of the user's message.
- Reply ONLY in the exact same language and script as the user's message.
  - If the user writes in Gujarati (e.g., ડાયાબિટીસમાં...), reply ONLY in Gujarati.
  - If the user writes in Hindi (e.g., क्या...), reply ONLY in Hindi.
  - If the user writes in English, reply ONLY in English.
  - If mixed language is used, reply naturally in the same style.
- Never translate unless requested.
- If a question is outside nutrition, health, food, or fitness, politely say:
"I am your MayiEat Nutrition Coach. I can help with food, nutrition, calories, meal planning, healthy eating, and fitness."
`;

/**
 * Maps standard conversation history to Gemini SDK format
 * @param {Array} history - List of { role: 'user'|'assistant'|'model', content: string }
 * @returns {Array} Gemini formatted history
 */
function formatHistoryForGemini(history = []) {
  if (!Array.isArray(history) || history.length === 0) return [];

  const formatted = [];
  for (const item of history) {
    if (!item || !item.content) continue;
    const role = (item.role === 'user') ? 'user' : 'model';
    const text = String(item.content).trim();
    if (text.length > 0) {
      formatted.push({
        role: role,
        parts: [{ text: text }]
      });
    }
  }
  return formatted;
}

/**
 * Generates AI Coach responses using Google Gemini API with Chat Memory & Fallbacks
 * 
 * @param {string} userMessage - User query text (supports UTF-8 / Unicode / Gujarati / Hindi)
 * @param {Array} conversationHistory - Previous chat messages for memory context
 * @param {Object} userProfile - User Health Profile (conditions, allergies, goals)
 * @returns {Promise<string>} Gemini response
 */
async function generateCoachResponse(userMessage, conversationHistory = [], userProfile = {}) {
  const cleanMessage = String(userMessage || '').trim();
  if (!cleanMessage) {
    throw new Error('Message content cannot be empty.');
  }

  // Construct dynamic health profile context if available
  let dynamicContext = '';
  if (userProfile && (userProfile.medical_conditions || userProfile.allergies || userProfile.goal)) {
    const conditions = Array.isArray(userProfile.medical_conditions) ? userProfile.medical_conditions.join(', ') : '';
    const allergies = Array.isArray(userProfile.allergies) ? userProfile.allergies.join(', ') : '';
    const goal = userProfile.goal || '';

    dynamicContext = `\n\nUSER PROFILE CONTEXT:\n- Health Goal: ${goal || 'General Health'}\n- Medical Conditions: ${conditions || 'None'}\n- Allergies/Intolerances: ${allergies || 'None'}`;
  }

  const fullSystemInstruction = SYSTEM_INSTRUCTION + dynamicContext;
  const geminiHistory = formatHistoryForGemini(conversationHistory);

  let lastError = null;

  // Try prioritized model list until success
  for (const modelName of MODEL_PRIORITY) {
    try {
      const model = getModel(modelName, fullSystemInstruction);

      if (geminiHistory.length > 0) {
        // Use Chat session for conversation memory context
        const chat = model.startChat({
          history: geminiHistory
        });
        const result = await chat.sendMessage(cleanMessage);
        const response = await result.response;
        const reply = response.text();
        if (reply && reply.trim().length > 0) {
          return reply.trim();
        }
      } else {
        // Single prompt generation
        const prompt = `${fullSystemInstruction}\n\nUSER QUESTION: "${cleanMessage}"`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const reply = response.text();
        if (reply && reply.trim().length > 0) {
          return reply.trim();
        }
      }
    } catch (err) {
      console.error(`[MayiEat Gemini Service] Model '${modelName}' attempt failed:`, err.message);
      lastError = err;
      // Continue loop to try next model in priority list
    }
  }

  // If all model attempts fail, throw the actual error (DO NOT RETURN HARDCODED FALLBACK)
  throw lastError || new Error('All Gemini AI model attempts failed to generate a response.');
}

module.exports = {
  generateCoachResponse
};
