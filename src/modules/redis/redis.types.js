/**
 * @typedef {Object} RedisConfig
 * @property {string} url - Redis URL
 * @property {boolean} clusterMode - Whether Redis is in cluster mode
 * @property {string[]} nodes - Cluster nodes
 * @property {number} poolSize - Connection pool size
 * @property {number} maxRetries - Maximum retry attempts
 * @property {number} retryDelay - Delay between retries
 */

/**
 * @typedef {Object} RedisHealth
 * @property {string} status - Service status (healthy, warning, error)
 * @property {number} readyClients - Number of ready clients
 * @property {number} poolSize - Total pool size
 * @property {string} circuitBreakerState - State of circuit breaker
 */

/**
 * @typedef {Object} RedisCacheOptions
 * @property {number} [ttl] - Time to live in seconds
 * @property {boolean} [json] - Whether to JSON stringify/parse value
 */

module.exports = {
  // These are just type definitions, no actual code needed here
};