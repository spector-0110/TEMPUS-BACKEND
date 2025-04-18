const EXCHANGE_TYPES = {
  DIRECT: 'direct',
  FANOUT: 'fanout',
  TOPIC: 'topic',
  HEADERS: 'headers'
};

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const DEFAULT_CONFIG = {
  maxConnectionAttempts: 5,
  reconnectDelay: 5000,
  maxChannels: 10,
  persistenceConfig: {
    durable: true,
    persistent: true,
    noAck: false,
    prefetch: 10
  }
};

const QUEUE_DEFAULTS = {
  durable: true,
  autoDelete: false,
  exclusive: false,
  maxLength: 1000000,
  messageTtl: 24 * 60 * 60 * 1000, // 24 hours
  queueMode: 'default',
  dlxRetention: 7 * 24 * 60 * 60 * 1000 // 7 days for dead letter queue
};

const EXCHANGE_DEFAULTS = {
  durable: true,
  autoDelete: false,
  internal: false
};

const CONSUMER_DEFAULTS = {
  noAck: false,
  exclusive: false,
  maxRetries: 3,
  prefetch: 10
};

const PUBLISH_DEFAULTS = {
  persistent: true,
  mandatory: true
};

const ERROR_CODES = {
  CONNECTION_ERROR: 'RABBITMQ_CONNECTION_ERROR',
  CHANNEL_ERROR: 'RABBITMQ_CHANNEL_ERROR',
  PUBLISH_ERROR: 'RABBITMQ_PUBLISH_ERROR',
  CONSUME_ERROR: 'RABBITMQ_CONSUME_ERROR',
  QUEUE_ERROR: 'RABBITMQ_QUEUE_ERROR',
  EXCHANGE_ERROR: 'RABBITMQ_EXCHANGE_ERROR'
};

const HEALTH_CHECK = {
  STATUS: {
    HEALTHY: 'healthy',
    WARNING: 'warning',
    ERROR: 'error'
  },
  WARNING_THRESHOLD: 0.5 // 50% channel capacity
};

module.exports = {
  EXCHANGE_TYPES,
  LOG_LEVELS,
  DEFAULT_CONFIG,
  QUEUE_DEFAULTS,
  EXCHANGE_DEFAULTS,
  CONSUMER_DEFAULTS,
  PUBLISH_DEFAULTS,
  ERROR_CODES,
  HEALTH_CHECK
};