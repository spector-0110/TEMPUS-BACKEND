const redisClient = require('../config/redis.config');

class RedisService {
  // Basic Operations
  async set(key, value, expireSeconds = null) {
    try {
      if (typeof value === 'object') {
        value = JSON.stringify(value);
      }
      await redisClient.set(key, value);
      if (expireSeconds) {
        await redisClient.expire(key, expireSeconds);
      }
      return true;
    } catch (error) {
      console.error('Redis SET Error:', error);
      throw error;
    }
  }

  async get(key) {
    try {
      const value = await redisClient.get(key);
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      console.error('Redis GET Error:', error);
      throw error;
    }
  }

  async delete(key) {
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      console.error('Redis DELETE Error:', error);
      throw error;
    }
  }

  // List Operations
  async listPush(key, value) {
    try {
      if (typeof value === 'object') {
        value = JSON.stringify(value);
      }
      return await redisClient.rpush(key, value);
    } catch (error) {
      console.error('Redis RPUSH Error:', error);
      throw error;
    }
  }

  async listGet(key, start = 0, end = -1) {
    try {
      const list = await redisClient.lrange(key, start, end);
      return list.map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return item;
        }
      });
    } catch (error) {
      console.error('Redis LRANGE Error:', error);
      throw error;
    }
  }

  // Hash Operations
  async hashSet(key, field, value) {
    try {
      if (typeof value === 'object') {
        value = JSON.stringify(value);
      }
      return await redisClient.hset(key, field, value);
    } catch (error) {
      console.error('Redis HSET Error:', error);
      throw error;
    }
  }

  async hashGet(key, field) {
    try {
      const value = await redisClient.hget(key, field);
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      console.error('Redis HGET Error:', error);
      throw error;
    }
  }

  async hashGetAll(key) {
    try {
      const hash = await redisClient.hgetall(key);
      if (!hash) return null;
      
      Object.keys(hash).forEach(field => {
        try {
          hash[field] = JSON.parse(hash[field]);
        } catch {
          // Keep original value if not JSON
        }
      });
      
      return hash;
    } catch (error) {
      console.error('Redis HGETALL Error:', error);
      throw error;
    }
  }

  // Cache Operations
  async setCache(key, value, expireSeconds = 3600) {
    return this.set(key, value, expireSeconds);
  }

  async getCache(key) {
    return this.get(key);
  }

  async invalidateCache(key) {
    return this.delete(key);
  }

  // Pattern Operations
  async deleteByPattern(pattern) {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Redis Delete by Pattern Error:', error);
      throw error;
    }
  }

  // Utility Operations
  async exists(key) {
    try {
      return await redisClient.exists(key);
    } catch (error) {
      console.error('Redis EXISTS Error:', error);
      throw error;
    }
  }

  async ttl(key) {
    try {
      return await redisClient.ttl(key);
    } catch (error) {
      console.error('Redis TTL Error:', error);
      throw error;
    }
  }
}

module.exports = new RedisService();