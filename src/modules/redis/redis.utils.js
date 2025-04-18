const { CACHE_DEFAULTS } = require('./redis.constants');
const { RedisCacheError } = require('./redis.errors');

/**
 * Serializes a value for Redis storage
 */
function serialize(value, options = {}) {
  try {
    if (options.json === false) return value;
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch (error) {
    throw new RedisCacheError('Failed to serialize value', null, 'serialize');
  }
}

/**
 * Deserializes a value from Redis storage
 */
function deserialize(value, options = {}) {
  if (!value) return null;
  try {
    if (options.json === false) return value;
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (error) {
    return value; // If parsing fails, return original value
  }
}

/**
 * Builds cache key with prefix
 */
function buildKey(key, prefix = '') {
  return prefix ? `${prefix}:${key}` : key;
}

/**
 * Normalizes cache options by merging with defaults
 */
function normalizeCacheOptions(options = {}) {
  return {
    ...CACHE_DEFAULTS,
    ...options
  };
}

/**
 * Calculates exponential backoff with jitter
 */
function calculateBackoff(attempt, baseDelay = 1000) {
  const max = Math.min(baseDelay * Math.pow(2, attempt), 30000);
  return Math.floor(Math.random() * max);
}

module.exports = {
  serialize,
  deserialize,
  buildKey,
  normalizeCacheOptions,
  calculateBackoff
};