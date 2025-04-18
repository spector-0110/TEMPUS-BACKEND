const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const SERVICE_STATUS = {
  HEALTHY: 'healthy',
  WARNING: 'warning',
  ERROR: 'error'
};

const CIRCUIT_BREAKER_STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

const DEFAULT_CONFIG = {
  poolSize: 5,
  maxRetries: 3,
  retryDelay: 1000,
  connectionTimeout: 10000,
  keepAlive: 30000,
  enableReadyCheck: true,
  enableAutoPipelining: true
};

const CACHE_DEFAULTS = {
  ttl: 3600, // 1 hour
  json: true
};

module.exports = {
  LOG_LEVELS,
  SERVICE_STATUS,
  CIRCUIT_BREAKER_STATES,
  DEFAULT_CONFIG,
  CACHE_DEFAULTS
};