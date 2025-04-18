const RedisService = require('./redis.service');

// Create singleton instance with config from environment
const redisService = new RedisService({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  clusterMode: process.env.REDIS_CLUSTER_MODE === 'true',
  nodes: process.env.REDIS_CLUSTER_NODES?.split(','),
  poolSize: parseInt(process.env.REDIS_POOL_SIZE || '5'),
  maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || '3'),
  retryDelay: parseInt(process.env.REDIS_RETRY_DELAY || '1000')
});

module.exports = redisService;