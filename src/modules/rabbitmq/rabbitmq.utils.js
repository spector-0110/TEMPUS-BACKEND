const { LOG_LEVELS } = require('./rabbitmq.constants');

/**
 * Logging utility for RabbitMQ operations
 */
class Logger {
  constructor(logLevel = LOG_LEVELS.INFO) {
    this.logLevel = logLevel;
  }

  log(level, message, context = {}, error = null) {
    if (LOG_LEVELS[level] > this.logLevel) return;

    const logObject = {
      timestamp: new Date().toISOString(),
      service: 'RabbitMQ',
      level,
      message,
      ...context
    };

    if (error) {
      logObject.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      };
    }

    if (process.env.NODE_ENV === 'production') {
      console[level.toLowerCase()](JSON.stringify(logObject));
    } else {
      console[level.toLowerCase()](`[RabbitMQ][${logObject.timestamp}][${level}] ${message}`, 
        error ? { context, error: error.message } : context
      );
    }
  }
}

/**
 * Metrics collector for RabbitMQ operations
 */
class MetricsCollector {
  constructor() {
    this.reset();
  }

  reset() {
    this.metrics = {
      messagesPublished: 0,
      messagesConsumed: 0,
      errors: 0,
      reconnections: 0,
      channelCreated: 0,
      channelClosed: 0,
      lastError: null,
      startTime: new Date(),
      queueMetrics: new Map()
    };
  }

  recordPublish(queueName) {
    this.metrics.messagesPublished++;
    this.getQueueMetrics(queueName).published++;
  }

  recordConsume(queueName) {
    this.metrics.messagesConsumed++;
    this.getQueueMetrics(queueName).consumed++;
  }

  recordError(error) {
    this.metrics.errors++;
    this.metrics.lastError = {
      timestamp: new Date(),
      name: error.name,
      message: error.message,
      code: error.code
    };
  }

  recordReconnection() {
    this.metrics.reconnections++;
  }

  recordChannelCreated() {
    this.metrics.channelCreated++;
  }

  recordChannelClosed() {
    this.metrics.channelClosed++;
  }

  getQueueMetrics(queueName) {
    if (!this.metrics.queueMetrics.has(queueName)) {
      this.metrics.queueMetrics.set(queueName, {
        published: 0,
        consumed: 0,
        errors: 0,
        lastAccessed: new Date()
      });
    }
    return this.metrics.queueMetrics.get(queueName);
  }

  getMetrics() {
    return {
      ...this.metrics,
      queueMetrics: Object.fromEntries(this.metrics.queueMetrics),
      uptime: (new Date() - this.metrics.startTime) / 1000
    };
  }
}

/**
 * Channel pool manager utility
 */
class ChannelPool {
  constructor(maxSize = 10) {
    this.maxSize = maxSize;
    this.pool = new Map();
    this.lastId = 0;
  }

  add(channel) {
    const id = this.lastId++ % this.maxSize;
    this.pool.set(id, {
      channel,
      id,
      closed: false,
      createdAt: new Date(),
      messageCount: 0
    });
    return id;
  }

  get(id) {
    return this.pool.get(id);
  }

  remove(id) {
    return this.pool.delete(id);
  }

  getNextAvailable() {
    for (let i = 0; i < this.maxSize; i++) {
      const id = (this.lastId + i) % this.maxSize;
      const wrapper = this.pool.get(id);
      if (wrapper && !wrapper.closed) {
        return wrapper;
      }
    }
    return null;
  }

  clear() {
    this.pool.clear();
  }

  size() {
    return this.pool.size;
  }

  getActiveCount() {
    return Array.from(this.pool.values())
      .filter(wrapper => !wrapper.closed).length;
  }
}

module.exports = {
  Logger,
  MetricsCollector,
  ChannelPool
};