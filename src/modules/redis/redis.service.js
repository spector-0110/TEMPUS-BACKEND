const Redis = require('ioredis');
const { DEFAULT_CONFIG, SERVICE_STATUS, CIRCUIT_BREAKER_STATES } = require('./redis.constants');
const { RedisConnectionError, RedisOperationError, CircuitBreakerError } = require('./redis.errors');
const { serialize, deserialize, buildKey, normalizeCacheOptions, calculateBackoff } = require('./redis.utils');

class CircuitBreaker {
  constructor(timeoutInMillis = 60000) {
    this.state = CIRCUIT_BREAKER_STATES.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.failureThreshold = 5;
    this.timeout = timeoutInMillis;
  }

  async execute(operation) {
    if (this.state === CIRCUIT_BREAKER_STATES.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.timeout) {
        this.state = CIRCUIT_BREAKER_STATES.HALF_OPEN;
      } else {
        throw new CircuitBreakerError('Circuit breaker is OPEN', this.state);
      }
    }

    try {
      const result = await operation();
      if (this.state === CIRCUIT_BREAKER_STATES.HALF_OPEN) {
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
      this.state = CIRCUIT_BREAKER_STATES.OPEN;
    }
  }

  reset() {
    this.failureCount = 0;
    this.state = CIRCUIT_BREAKER_STATES.CLOSED;
    this.lastFailureTime = null;
  }
}

class RedisClientPool {
  constructor(config) {
    this.clients = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.size = this.config.poolSize;
  }

  async initialize() {
    for (let i = 0; i < this.size; i++) {
      const client = this.createClient();
      this.clients.set(i, client);
      await this.setupClientEventHandlers(client, i);
    }
  }

  createClient() {
    if (this.config.clusterMode) {
      return new Redis.Cluster(this.config.nodes, {
        redisOptions: this.getRedisOptions()
      });
    }
    return new Redis(this.config.url, this.getRedisOptions());
  }

  getRedisOptions() {
    return {
      retryStrategy: times => {
        if (times > this.config.maxRetries) return null;
        return calculateBackoff(times, this.config.retryDelay);
      },
      enableReadyCheck: this.config.enableReadyCheck,
      enableAutoPipelining: this.config.enableAutoPipelining,
      maxRetriesPerRequest: 3,
      connectTimeout: this.config.connectionTimeout,
      keepAlive: this.config.keepAlive
    };
  }

  async setupClientEventHandlers(client, id) {
    client.on('ready', () => this.onClientReady(id));
    client.on('error', error => this.onClientError(id, error));
    client.on('close', () => this.onClientClose(id));
    await client.ping();
  }

  async getClient() {
    const availableClients = Array.from(this.clients.entries())
      .filter(([, client]) => client.status === 'ready');
    
    if (availableClients.length === 0) {
      throw new RedisConnectionError('No available Redis clients');
    }

    const [id] = availableClients[Math.floor(Math.random() * availableClients.length)];
    return this.clients.get(id);
  }

  onClientReady(id) {
    console.log(`Redis client ${id} ready`);
  }

  onClientError(id, error) {
    console.error(`Redis client ${id} error:`, error);
  }

  onClientClose(id) {
    console.warn(`Redis client ${id} closed`);
  }
}

class RedisService {
  constructor(config = {}) {
    this.pool = new RedisClientPool(config);
    this.circuitBreaker = new CircuitBreaker();
    this.metrics = {
      operations: 0,
      errors: 0,
      lastError: null
    };
  }

  async initialize() {
    await this.pool.initialize();
  }

  async executeWithCircuitBreaker(operation) {
    return this.circuitBreaker.execute(operation);
  }

  async set(key, value, options = {}) {
    const normalizedOptions = normalizeCacheOptions(options);
    const serializedValue = serialize(value, normalizedOptions);
    
    return this.executeWithCircuitBreaker(async () => {
      const client = await this.pool.getClient();
      if (normalizedOptions.ttl) {
        await client.set(buildKey(key), serializedValue, 'EX', normalizedOptions.ttl);
      } else {
        await client.set(buildKey(key), serializedValue);
      }
      return true;
    });
  }

  async get(key, options = {}) {
    return this.executeWithCircuitBreaker(async () => {
      const client = await this.pool.getClient();
      const value = await client.get(buildKey(key));
      return deserialize(value, normalizeCacheOptions(options));
    });
  }

  async delete(key) {
    return this.executeWithCircuitBreaker(async () => {
      const client = await this.pool.getClient();
      return client.del(buildKey(key));
    });
  }

  // Cache-specific methods
  async setCache(key, value, expireSeconds = 3600) {
    return this.set(key, value, { ttl: expireSeconds });
  }

  async getCache(key) {
    return this.get(key);
  }

  async invalidateCache(key) {
    return this.delete(key);
  }

  async checkHealth() {
    try {
      const client = await this.pool.getClient();
      await client.ping();
      
      const readyClients = Array.from(this.pool.clients.values())
        .filter(c => c.status === 'ready').length;

      return {
        status: readyClients === this.pool.size ? 
          SERVICE_STATUS.HEALTHY : 
          SERVICE_STATUS.WARNING,
        readyClients,
        poolSize: this.pool.size,
        circuitBreakerState: this.circuitBreaker.state,
        metrics: this.metrics
      };
    } catch (error) {
      return {
        status: SERVICE_STATUS.ERROR,
        error: error.message,
        circuitBreakerState: this.circuitBreaker.state
      };
    }
  }

  async cleanup() {
    for (const client of this.pool.clients.values()) {
      await client.quit();
    }
    this.pool.clients.clear();
  }
}

module.exports = RedisService;