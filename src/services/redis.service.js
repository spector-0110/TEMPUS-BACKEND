const Redis = require('ioredis');

class CircuitBreaker {
  constructor(timeoutInMillis = 60000) {
    this.states = {
      CLOSED: 'CLOSED',
      OPEN: 'OPEN',
      HALF_OPEN: 'HALF_OPEN'
    };
    this.state = this.states.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.failureThreshold = 5;
    this.timeout = timeoutInMillis;
  }

  async execute(operation) {
    if (this.state === this.states.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.timeout) {
        this.state = this.states.HALF_OPEN;
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      if (this.state === this.states.HALF_OPEN) {
        this.reset();
      }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = this.states.OPEN;
    }
  }

  reset() {
    this.failureCount = 0;
    this.state = this.states.CLOSED;
    this.lastFailureTime = null;
  }
}

class RedisService {
  constructor() {
    this.clients = new Map();
    this.subscriberClient = null;
    this.POOL_SIZE = 5;
    this.MAX_RETRIES = 3;
    this.RETRY_DELAY = 1000;
    this.rateLimits = new Map();

    this.defaultRateLimit = {
      points: 100,
      duration: 60,
      blockDuration: 60,
    };

    // Log levels
    this.LOG_LEVELS = {
      ERROR: 0,
      WARN: 1,
      INFO: 2,
      DEBUG: 3
    };

    // Set default log level from env or default to INFO
    this.currentLogLevel = this.LOG_LEVELS[process.env.REDIS_LOG_LEVEL] || this.LOG_LEVELS.INFO;

    // Initialize metrics
    this.metrics = {
      operations: 0,
      errors: 0,
      lastError: null,
      connectionDrops: 0,
      lastReconnect: null
    };

    this.circuitBreaker = new CircuitBreaker();
    this.clusterMode = process.env.REDIS_CLUSTER_MODE === 'true';
    
    // Add cluster configuration
    this.clusterConfig = {
      nodes: process.env.REDIS_CLUSTER_NODES ? 
        process.env.REDIS_CLUSTER_NODES.split(',') : 
        ['redis://localhost:6379'],
      options: {
        scaleReads: 'slave',
        maxRedirections: 3,
        retryDelayOnFailover: 100
      }
    };

    this.initialize();
  }

  /**
   * Structured logging with levels and metrics tracking
   * @param {string} level - Log level (ERROR, WARN, INFO, DEBUG)
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   * @param {Error} [error] - Optional error object
   */
  log(level, message, context = {}, error = null) {
    // Check if we should log this level
    if (this.LOG_LEVELS[level] > this.currentLogLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logObject = {
      timestamp,
      service: 'RedisService',
      level,
      message,
      ...context
    };

    if (error) {
      logObject.error = {
        message: error.message,
        stack: error.stack,
        code: error.code
      };
      
      // Track error metrics
      this.metrics.errors++;
      this.metrics.lastError = {
        timestamp,
        message: error.message
      };
    }

    // In production, you might want to use a proper logging service
    if (process.env.NODE_ENV === 'production') {
      // Could integrate with services like Winston, Bunyan, or cloud logging
      // this.logger.log(logObject);
      console[level.toLowerCase()](JSON.stringify(logObject));
    } else {
      console[level.toLowerCase()](`[RedisService][${timestamp}][${level}] ${message}`, context, error ? '\nError:' + error.stack : '');
    }
  }

  /**
   * Error logging with full context
   * @param {string} message - Error message
   * @param {Error} error - Error object
   * @param {Object} context - Additional context
   */
  errorLog(message, error, context = {}) {
    this.log('ERROR', message, {
      ...context,
      connectionState: {
        poolSize: this.POOL_SIZE,
        activeClients: Array.from(this.clients.values()).filter(c => c.status === 'ready').length,
        lastReconnect: this.metrics.lastReconnect
      }
    }, error);
  }

  /**
   * Debug logging for development
   * @param {string} message - Debug message
   * @param {Object} context - Additional context
   */
  debug(message, context = {}) {
    this.log('DEBUG', message, context);
  }

  /**
   * Info logging for general operation tracking
   * @param {string} message - Info message
   * @param {Object} context - Additional context
   */
  info(message, context = {}) {
    this.log('INFO', message, context);
  }

  /**
   * Warning logging for potential issues
   * @param {string} message - Warning message
   * @param {Object} context - Additional context
   */
  warn(message, context = {}) {
    this.log('WARN', message, context);
  }

  async initialize() {
    try {
      for (let i = 0; i < this.POOL_SIZE; i++) {
        const client = this.createClient();
        this.clients.set(i, client);
      }
      this.subscriberClient = this.createClient();
      this.info('Redis pool initialized with %d clients', { poolSize: this.POOL_SIZE });
    } catch (err) {
      this.errorLog('Failed to initialize Redis pool', err);
    }
  }

  createClient() {
    let client;
    
    if (this.clusterMode) {
      client = new Redis.Cluster(this.clusterConfig.nodes, {
        ...this.clusterConfig.options,
        redisOptions: {
          retryStrategy: times => (times > this.MAX_RETRIES ? null : this.RETRY_DELAY * times),
          maxRetriesPerRequest: 3,
          connectTimeout: 10000,
          keepAlive: 30000,
          enableReadyCheck: true,
          enableAutoPipelining: true,
        }
      });
    } else {
      client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        retryStrategy: times => (times > this.MAX_RETRIES ? null : this.RETRY_DELAY * times),
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        keepAlive: 30000,
        enableReadyCheck: true,
        enableAutoPipelining: true,
        autoPipeliningIgnoredCommands: ['subscribe', 'psubscribe'],
      });
    }

    this.setupClientEventHandlers(client);
    return client;
  }

  setupClientEventHandlers(client) {
    client.on('ready', () => this.info('Redis client is ready'));
    client.on('error', err => this.errorLog('Redis error', err));
    client.on('close', () => this.warn('Redis connection closed'));
    client.on('reconnecting', () => {
      this.warn('Redis reconnecting');
      this.metrics.connectionDrops++;
      this.metrics.lastReconnect = new Date().toISOString();
    });
    client.on('end', () => this.warn('Redis connection ended'));

    // Cluster-specific events
    if (this.clusterMode && client.on) {
      client.on('+node', (node) => this.info('New node added to cluster', { node }));
      client.on('-node', (node) => this.warn('Node removed from cluster', { node }));
      client.on('node error', (error, node) => this
        .errorLog('Cluster node error', error, { node }));
    }
  }

  async executeWithCircuitBreaker(operation) {
    return this.circuitBreaker.execute(operation);
  }

  async getClient() {
    let attempts = 0;
    while (attempts < this.MAX_RETRIES) {
      const id = Math.floor(Math.random() * this.POOL_SIZE);
      const client = this.clients.get(id);

      if (client && client.status === 'ready') return client;

      attempts++;
      await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
    }

    this.errorLog('All Redis clients are unavailable');
    throw new Error('No available Redis client');
  }

  async set(key, value, expireSeconds = null) {
    return this.executeWithCircuitBreaker(async () => {
      const client = await this.getClient();
      const val = typeof value === 'object' ? JSON.stringify(value) : value;
      
      if (expireSeconds) {
        await client.set(key, val, 'EX', expireSeconds);
      } else {
        await client.set(key, val);
      }
      return true;
    });
  }

  async get(key) {
    return this.executeWithCircuitBreaker(async () => {
      const client = await this.getClient();
      const value = await client.get(key);
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    });
  }

  async delete(key) {
    const client = await this.getClient();
    return client.del(key);
  }

  async exists(key) {
    const client = await this.getClient();
    return client.exists(key);
  }

  async ttl(key) {
    const client = await this.getClient();
    return client.ttl(key);
  }

  // List methods
  async listPush(key, value) {
    const client = await this.getClient();
    const val = typeof value === 'object' ? JSON.stringify(value) : value;
    return client.rpush(key, val);
  }

  async listGet(key, start = 0, end = -1) {
    const client = await this.getClient();
    const list = await client.lrange(key, start, end);
    return list.map(item => {
      try {
        return JSON.parse(item);
      } catch {
        return item;
      }
    });
  }

  // Hash methods
  async hashSet(key, field, value) {
    const client = await this.getClient();
    const val = typeof value === 'object' ? JSON.stringify(value) : value;
    return client.hset(key, field, val);
  }

  async hashGet(key, field) {
    const client = await this.getClient();
    const val = await client.hget(key, field);
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }

  async hashGetAll(key) {
    const client = await this.getClient();
    const hash = await client.hgetall(key);
    Object.keys(hash).forEach(k => {
      try {
        hash[k] = JSON.parse(hash[k]);
      } catch {}
    });
    return hash;
  }

  // Rate limiting using sorted sets
  async checkRateLimit(key, customLimit = null) {
    const client = await this.getClient();
    const limit = customLimit || this.defaultRateLimit;
    const now = Date.now();
    const expireTime = now - limit.duration * 1000;

    const multi = client.multi();
    multi.zremrangebyscore(`ratelimit:${key}`, 0, expireTime);
    multi.zadd(`ratelimit:${key}`, now, `${now}-${Math.random()}`);
    multi.zcard(`ratelimit:${key}`);
    multi.expire(`ratelimit:${key}`, limit.duration);

    const [, , count] = await multi.exec();

    if (count[1] > limit.points) {
      await client.set(`ratelimit:blocked:${key}`, '1', 'EX', limit.blockDuration);
      throw new Error('Rate limit exceeded');
    }

    return true;
  }

  async setCache(key, value, expireSeconds = 3600) {
    let retries = 0;
    const val = typeof value === 'object' ? JSON.stringify(value) : value;

    while (retries < this.MAX_RETRIES) {
      try {
        const client = await this.getClient();
        const multi = client.multi();
        multi.set(key, val);
        multi.expire(key, expireSeconds);
        await multi.exec();
        return true;
      } catch (err) {
        retries++;
        if (retries >= this.MAX_RETRIES) throw err;
        await new Promise(res => setTimeout(res, this.RETRY_DELAY));
      }
    }
  }

  async getCache(key) {
    let retries = 0;
    while (retries < this.MAX_RETRIES) {
      try {
        const client = await this.getClient();
        const val = await client.get(key);
        return JSON.parse(val);
      } catch (err) {
        retries++;
        if (retries >= this.MAX_RETRIES) throw err;
        await new Promise(res => setTimeout(res, this.RETRY_DELAY));
      }
    }
  }

  async invalidateCache(key) {
    return this.delete(key);
  }

  async deleteByPattern(pattern) {
    const client = await this.getClient();
    const keys = await client.keys(pattern);
    if (keys.length > 0) await client.del(...keys);
    return true;
  }

  // Pub/Sub
  async publish(channel, message) {
    const client = await this.getClient();
    return client.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel, handler) {
    if (!this.subscriberClient) {
      this.subscriberClient = this.createClient();
    }

    await this.subscriberClient.subscribe(channel);
    this.subscriberClient.on('message', (chan, msg) => {
      if (chan === channel) {
        try {
          handler(JSON.parse(msg));
        } catch (err) {
          this.errorLog('Failed to parse message', err);
        }
      }
    });
  }

  async getClusterInfo() {
    if (!this.clusterMode) {
      return null;
    }

    const client = await this.getClient();
    return {
      nodes: client.nodes('master'),
      slots: client.slots,
      status: client.status
    };
  }

  async checkHealth() {
    try {
      const client = await this.getClient();
      const ping = await client.ping();
      const readyClients = Array.from(this.clients.values())
        .filter(c => c.status === 'ready').length;
      
      const health = {
        status: ping === 'PONG' && readyClients === this.POOL_SIZE ? 'healthy' : 'warning',
        readyClients,
        poolSize: this.POOL_SIZE,
        circuitBreakerState: this.circuitBreaker.state,
        metrics: this.metrics
      };

      if (this.clusterMode) {
        const clusterInfo = await this.getClusterInfo();
        health.cluster = clusterInfo;
      }

      return health;
    } catch (error) {
      this.errorLog('Health check failed', error);
      return { 
        status: 'error', 
        message: error.message,
        circuitBreakerState: this.circuitBreaker.state
      };
    }
  }

  async cleanup() {
    for (const client of this.clients.values()) await client.quit();
    if (this.subscriberClient) await this.subscriberClient.quit();
    this.clients.clear();
    this.info('Cleaned up all Redis clients');
  }
}

module.exports = new RedisService();