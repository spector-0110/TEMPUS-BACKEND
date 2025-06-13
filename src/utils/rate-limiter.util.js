const redisService = require('../services/redis.service');
const { getRateLimitConfig, shouldActivateEmergencyBypass } = require('../config/rate-limit.config');

/**
 * Rate Limiter Utility for preventing abuse and spam
 * Uses Redis for distributed rate limiting across multiple instances
 */
class RateLimiter {
  constructor() {
    this.emergencyBypass = false;
    this.systemMetrics = {
      redisFailureRate: 0,
      consecutiveFailures: 0,
      totalOperations: 0,
      failedOperations: 0
    };
    
    // Legacy fallback limits (kept for backward compatibility)
    this.defaultLimits = {
      renewalAttempts: {
        points: 3,
        duration: 300,
        blockDuration: 900
      },
      verificationAttempts: {
        points: 5,
        duration: 600,
        blockDuration: 1800
      },
      globalRenewals: {
        points: 100,
        duration: 60,
        blockDuration: 300
      },
      ipBasedOperations: {
        points: 20,
        duration: 300,
        blockDuration: 600
      },
      failedOperations: {
        points: 10,
        duration: 3600,
        blockDuration: 7200
      }
    };
  }

  /**
   * Check rate limit for a specific key and limit type
   * @param {string} key - Unique identifier (hospitalId, IP, etc.)
   * @param {string} limitType - Type of limit to check
   * @param {Object} customLimit - Custom limit override
   * @param {Object} context - Context for dynamic configuration
   * @returns {Promise<{allowed: boolean, resetTime?: number, remaining?: number}>}
   */
  async checkLimit(key, limitType, customLimit = null, context = {}) {
    // Check emergency bypass first
    if (this.emergencyBypass || shouldActivateEmergencyBypass(this.systemMetrics)) {
      console.warn('Rate limiting bypassed due to emergency conditions', {
        emergencyBypass: this.emergencyBypass,
        systemMetrics: this.systemMetrics
      });
      return { allowed: true, bypassed: true };
    }

    let limit;
    
    try {
      // Use dynamic configuration if available
      limit = customLimit || getRateLimitConfig(limitType, context);
    } catch (configError) {
      console.warn('Failed to get dynamic rate limit config, using fallback', {
        limitType,
        error: configError.message
      });
      limit = this.defaultLimits[limitType];
    }
    
    if (!limit) {
      console.warn(`Unknown rate limit type: ${limitType}`);
      return { allowed: true };
    }

    const rateLimitKey = `ratelimit:${limitType}:${key}`;
    const blockKey = `ratelimit:blocked:${limitType}:${key}`;

    try {
      this.systemMetrics.totalOperations++;
      
      // Check if currently blocked
      const isBlocked = await redisService.exists(blockKey);
      if (isBlocked) {
        const ttl = await redisService.ttl(blockKey);
        console.warn('Rate limit block active', {
          key,
          limitType,
          remainingBlockTime: ttl,
          timestamp: new Date().toISOString()
        });
        return { 
          allowed: false, 
          resetTime: Date.now() + (ttl * 1000),
          reason: 'BLOCKED',
          limit: limit.points,
          remaining: 0
        };
      }

      const now = Date.now();
      const expireTime = now - (limit.duration * 1000);

      // Get Redis client for atomic operations
      const client = await redisService.getClient();
      
      // Use Redis transaction for atomicity
      const multi = client.multi();
      
      // Remove expired entries
      multi.zremrangebyscore(rateLimitKey, 0, expireTime);
      
      // Add current request
      multi.zadd(rateLimitKey, now, `${now}-${Math.random()}`);
      
      // Count current requests
      multi.zcard(rateLimitKey);
      
      // Set expiry for cleanup
      multi.expire(rateLimitKey, limit.duration);

      const results = await multi.exec();
      const currentCount = results[2][1]; // zcard result

      if (currentCount > limit.points) {
        // Rate limit exceeded - set block
        await redisService.setCache(blockKey, '1', limit.blockDuration);
        
        console.error('Rate limit exceeded', {
          key,
          limitType,
          currentCount,
          limit: limit.points,
          blockDuration: limit.blockDuration,
          context: limit.metadata || {},
          timestamp: new Date().toISOString()
        });

        return { 
          allowed: false, 
          resetTime: Date.now() + (limit.blockDuration * 1000),
          reason: 'RATE_LIMITED',
          limit: limit.points,
          current: currentCount,
          remaining: 0
        };
      }

      const remaining = Math.max(0, limit.points - currentCount);
      const resetTime = now + (limit.duration * 1000);

      console.debug('Rate limit check passed', {
        key,
        limitType,
        currentCount,
        remaining,
        limit: limit.points,
        context: limit.metadata || {}
      });

      // Reset consecutive failures on success
      this.systemMetrics.consecutiveFailures = 0;

      return { 
        allowed: true, 
        remaining,
        resetTime,
        limit: limit.points,
        current: currentCount
      };

    } catch (error) {
      this.systemMetrics.failedOperations++;
      this.systemMetrics.consecutiveFailures++;
      this.systemMetrics.redisFailureRate = this.systemMetrics.failedOperations / this.systemMetrics.totalOperations;
      
      console.error('Rate limiter error', {
        key,
        limitType,
        error: error.message,
        systemMetrics: this.systemMetrics,
        timestamp: new Date().toISOString()
      });
      
      // Check if we should activate emergency bypass
      if (shouldActivateEmergencyBypass(this.systemMetrics)) {
        this.emergencyBypass = true;
        console.error('EMERGENCY: Activating rate limiter bypass due to system issues', {
          systemMetrics: this.systemMetrics
        });
      }
      
      // Fail open - allow request if rate limiter fails
      return { allowed: true, error: error.message };
    }
  }

  /**
   * Check multiple rate limits simultaneously
   * @param {Array} checks - Array of {key, limitType, customLimit?} objects
   * @returns {Promise<{allowed: boolean, failures: Array}>}
   */
  async checkMultipleLimits(checks) {
    const results = await Promise.all(
      checks.map(check => this.checkLimit(check.key, check.limitType, check.customLimit))
    );

    const failures = results
      .map((result, index) => ({ ...result, check: checks[index] }))
      .filter(result => !result.allowed);

    return {
      allowed: failures.length === 0,
      failures
    };
  }

  /**
   * Record a failed operation for suspicious pattern detection
   * @param {string} key - Identifier
   * @param {string} operation - Operation type
   * @param {string} reason - Failure reason
   */
  async recordFailure(key, operation, reason) {
    const failureKey = `failures:${operation}:${key}`;
    
    try {
      const client = await redisService.getClient();
      const now = Date.now();
      
      // Add failure record
      await client.zadd(failureKey, now, `${now}-${reason}`);
      
      // Set expiry
      await client.expire(failureKey, 3600); // 1 hour
      
      // Check if we should trigger failure-based rate limiting
      const failureCount = await client.zcard(failureKey);
      const limit = this.defaultLimits.failedOperations;
      
      if (failureCount >= limit.points) {
        const blockKey = `ratelimit:blocked:failures:${key}`;
        await redisService.setCache(blockKey, '1', limit.blockDuration);
        
        console.error('Failure-based rate limit triggered', {
          key,
          operation,
          failureCount,
          reason,
          blockDuration: limit.blockDuration,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error('Failed to record failure', {
        key,
        operation,
        reason,
        error: error.message
      });
    }
  }

  /**
   * Get rate limit status for monitoring
   * @param {string} key - Identifier
   * @param {string} limitType - Limit type
   * @returns {Promise<Object>}
   */
  async getStatus(key, limitType) {
    const limit = this.defaultLimits[limitType];
    if (!limit) return null;

    const rateLimitKey = `ratelimit:${limitType}:${key}`;
    const blockKey = `ratelimit:blocked:${limitType}:${key}`;

    try {
      const [isBlocked, blockTtl, currentCount] = await Promise.all([
        redisService.exists(blockKey),
        redisService.ttl(blockKey),
        redisService.getClient().then(client => client.zcard(rateLimitKey))
      ]);

      return {
        key,
        limitType,
        limit: limit.points,
        current: currentCount || 0,
        remaining: Math.max(0, limit.points - (currentCount || 0)),
        blocked: !!isBlocked,
        blockTimeRemaining: isBlocked ? blockTtl : 0,
        resetTime: Date.now() + (limit.duration * 1000)
      };

    } catch (error) {
      console.error('Failed to get rate limit status', {
        key,
        limitType,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Manually reset rate limit for a key (admin function)
   * @param {string} key - Identifier
   * @param {string} limitType - Limit type
   */
  async resetLimit(key, limitType) {
    const rateLimitKey = `ratelimit:${limitType}:${key}`;
    const blockKey = `ratelimit:blocked:${limitType}:${key}`;

    try {
      await Promise.all([
        redisService.deleteCache(rateLimitKey),
        redisService.deleteCache(blockKey)
      ]);

      console.info('Rate limit reset', {
        key,
        limitType,
        timestamp: new Date().toISOString()
      });

      return true;
    } catch (error) {
      console.error('Failed to reset rate limit', {
        key,
        limitType,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get all active blocks for monitoring
   * @returns {Promise<Array>}
   */
  async getActiveBlocks() {
    try {
      const client = await redisService.getClient();
      const blockKeys = await client.keys('ratelimit:blocked:*');
      
      const blocks = await Promise.all(
        blockKeys.map(async (key) => {
          const ttl = await redisService.ttl(key);
          const parts = key.split(':');
          return {
            key,
            limitType: parts[2],
            identifier: parts.slice(3).join(':'),
            timeRemaining: ttl
          };
        })
      );

      return blocks.filter(block => block.timeRemaining > 0);
    } catch (error) {
      console.error('Failed to get active blocks', error);
      return [];
    }
  }

  /**
   * Cleanup expired rate limit data
   */
  async cleanup() {
    try {
      const client = await redisService.getClient();
      
      // Clean up expired rate limit keys
      const rateLimitKeys = await client.keys('ratelimit:*:*');
      const now = Date.now();
      
      for (const key of rateLimitKeys) {
        if (key.includes(':blocked:')) continue; // Skip block keys
        
        // Remove old entries from sorted sets
        const expiredBefore = now - (3600 * 1000); // 1 hour ago
        await client.zremrangebyscore(key, 0, expiredBefore);
        
        // Remove empty sets
        const count = await client.zcard(key);
        if (count === 0) {
          await client.del(key);
        }
      }

      console.info('Rate limiter cleanup completed', {
        keysProcessed: rateLimitKeys.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Rate limiter cleanup failed', error);
    }
  }
}

module.exports = new RateLimiter();
