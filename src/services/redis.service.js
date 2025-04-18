const Redis = require('ioredis');

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

    this.initialize();
  }

  log(message, ...args) {
    console.log(`[RedisService][${new Date().toISOString()}] ${message}`, ...args);
  }

  errorLog(message, ...args) {
    console.error(`[RedisService][${new Date().toISOString()}][ERROR] ${message}`, ...args);
  }

  async initialize() {
    try {
      for (let i = 0; i < this.POOL_SIZE; i++) {
        const client = this.createClient();
        this.clients.set(i, client);
      }
      this.subscriberClient = this.createClient();
      this.log('Redis pool initialized with %d clients', this.POOL_SIZE);
    } catch (err) {
      this.errorLog('Failed to initialize Redis pool', err);
    }
  }

  createClient() {
    const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      retryStrategy: times => (times > this.MAX_RETRIES ? null : this.RETRY_DELAY * times),
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      keepAlive: 30000,
      enableReadyCheck: true,
      enableAutoPipelining: true,
      autoPipeliningIgnoredCommands: ['subscribe', 'psubscribe'],
    });

    client.on('ready', () => this.log('Redis client is ready'));
    client.on('error', err => this.errorLog('Redis error', err));
    return client;
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
    const client = await this.getClient();
    const val = typeof value === 'object' ? JSON.stringify(value) : value;

    await client.set(key, val);
    if (expireSeconds) await client.expire(key, expireSeconds);
    return true;
  }

  async get(key) {
    const client = await this.getClient();
    const value = await client.get(key);
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
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

  async checkHealth() {
    try {
      const client = await this.getClient();
      const ping = await client.ping();
      const readyClients = Array.from(this.clients.values()).filter(c => c.status === 'ready').length;
      return {
        status: ping === 'PONG' && readyClients === this.POOL_SIZE ? 'healthy' : 'warning',
        readyClients,
        poolSize: this.POOL_SIZE
      };
    } catch (error) {
      this.errorLog('Health check failed', error);
      return { status: 'error', message: error.message };
    }
  }

  async cleanup() {
    for (const client of this.clients.values()) await client.quit();
    if (this.subscriberClient) await this.subscriberClient.quit();
    this.clients.clear();
    this.log('Cleaned up all Redis clients');
  }
}

module.exports = new RedisService();