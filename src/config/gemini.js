const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

/**
 * Retrieves configured GoogleGenerativeAI client instance
 * Reads process.env.GEMINI_API_KEY dynamically
 */
function getGenAIClient() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[MayiEat Backend] WARNING: GEMINI_API_KEY is missing in process.env!');
  }
  return new GoogleGenerativeAI(apiKey);
}

/**
 * List of Gemini models to try in fallback order
 */
const MODEL_PRIORITY = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash'
];

/**
 * Returns a generative model instance for a given model name
 * @param {string} modelName 
 * @param {string} systemInstruction 
 */
function getModel(modelName = 'gemini-2.5-flash', systemInstruction = '') {
  const genAI = getGenAIClient();
  const options = { model: modelName };
  if (systemInstruction) {
    options.systemInstruction = systemInstruction;
  }
  return genAI.getGenerativeModel(options);
}

module.exports = {
  getGenAIClient,
  getModel,
  MODEL_PRIORITY
};
