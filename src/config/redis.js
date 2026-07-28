const { createClient } = require('redis');
require('dotenv').config();

const hasRedisConfig = !!(process.env.REDIS_URL || process.env.REDIS_HOST);
let redisClient = null;

if (hasRedisConfig) {
  const redisUrl =
    process.env.REDIS_URL ||
    `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`;

  redisClient = createClient({
    url: redisUrl,
    password: process.env.REDIS_PASSWORD || undefined,
  });

  redisClient.on('connect', () => {
    console.log('Redis client connecting...');
  });

  redisClient.on('ready', () => {
    console.log('Redis client connected and ready for caching.');
  });

  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err.message);
  });

  redisClient.on('end', () => {
    console.log('Redis client connection closed.');
  });

  // Self-executing connection initialization
  (async () => {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
    } catch (error) {
      console.warn('[Redis] Connection skipped/failed:', error.message);
    }
  })();
} else {
  // Safe dummy fallback object when Redis is not configured
  redisClient = {
    get: async () => null,
    set: async () => null,
    del: async () => null,
    isOpen: false,
    on: () => {},
  };
}

module.exports = redisClient;
