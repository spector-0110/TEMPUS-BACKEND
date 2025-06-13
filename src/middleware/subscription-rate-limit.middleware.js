const rateLimiter = require('../utils/rate-limiter.util');

/**
 * Rate limiting middleware for subscription endpoints
 */
class SubscriptionRateLimitMiddleware {
  
  /**
   * Rate limit renewal attempts per hospital
   */
  static async limitRenewalAttempts(req, res, next) {
    try {
      const hospitalId = req.params.hospitalId || req.body.hospitalId;
      const clientIp = req.ip || req.connection.remoteAddress;

      if (!hospitalId) {
        return res.status(400).json({
          error: 'Hospital ID is required',
          code: 'MISSING_HOSPITAL_ID'
        });
      }

      // Check multiple rate limits
      const checks = [
        { key: hospitalId, limitType: 'renewalAttempts' },
        { key: clientIp, limitType: 'ipBasedOperations' },
        { key: 'global', limitType: 'globalRenewals' }
      ];

      const result = await rateLimiter.checkMultipleLimits(checks);

      if (!result.allowed) {
        const failure = result.failures[0];
        
        console.warn('Renewal rate limit exceeded', {
          hospitalId,
          clientIp,
          failure,
          userAgent: req.get('User-Agent'),
          timestamp: new Date().toISOString()
        });

        return res.status(429).json({
          error: 'Too many renewal attempts',
          code: 'RATE_LIMITED',
          retryAfter: Math.ceil((failure.resetTime - Date.now()) / 1000),
          details: {
            type: failure.check.limitType,
            resetTime: failure.resetTime
          }
        });
      }

      // Add rate limit info to request for logging
      req.rateLimitInfo = {
        renewalRemaining: result.failures.length === 0 ? 'allowed' : 'blocked'
      };

      next();
    } catch (error) {
      console.error('Rate limiting middleware error', {
        error: error.message,
        stack: error.stack
      });
      
      // Fail open - allow request if middleware fails
      next();
    }
  }

  /**
   * Rate limit payment verification attempts
   */
  static async limitVerificationAttempts(req, res, next) {
    try {
      const { razorpay_order_id, razorpay_payment_id } = req.body;
      const clientIp = req.ip || req.connection.remoteAddress;
      const hospitalId = req.params.hospitalId || req.body.hospitalId;

      if (!razorpay_order_id || !razorpay_payment_id) {
        return res.status(400).json({
          error: 'Payment details are required',
          code: 'MISSING_PAYMENT_DETAILS'
        });
      }

      // Check rate limits for verification attempts
      const checks = [
        { key: razorpay_order_id, limitType: 'verificationAttempts' },
        { key: clientIp, limitType: 'ipBasedOperations' }
      ];

      if (hospitalId) {
        checks.push({ key: hospitalId, limitType: 'verificationAttempts' });
      }

      const result = await rateLimiter.checkMultipleLimits(checks);

      if (!result.allowed) {
        const failure = result.failures[0];
        
        // Record this as a suspicious activity
        await rateLimiter.recordFailure(
          clientIp, 
          'verification', 
          'rate_limit_exceeded'
        );

        console.warn('Verification rate limit exceeded', {
          razorpay_order_id,
          clientIp,
          hospitalId,
          failure,
          userAgent: req.get('User-Agent'),
          timestamp: new Date().toISOString()
        });

        return res.status(429).json({
          error: 'Too many verification attempts',
          code: 'VERIFICATION_RATE_LIMITED',
          retryAfter: Math.ceil((failure.resetTime - Date.now()) / 1000),
          details: {
            type: failure.check.limitType,
            resetTime: failure.resetTime
          }
        });
      }

      next();
    } catch (error) {
      console.error('Verification rate limiting error', {
        error: error.message,
        stack: error.stack
      });
      
      // Fail open
      next();
    }
  }

  /**
   * General subscription operation rate limiting
   */
  static async limitSubscriptionOperations(req, res, next) {
    try {
      const clientIp = req.ip || req.connection.remoteAddress;
      const hospitalId = req.params.hospitalId || req.body.hospitalId;

      const checks = [
        { key: clientIp, limitType: 'ipBasedOperations' }
      ];

      if (hospitalId) {
        checks.push({ key: hospitalId, limitType: 'renewalAttempts' });
      }

      const result = await rateLimiter.checkMultipleLimits(checks);

      if (!result.allowed) {
        const failure = result.failures[0];
        
        console.warn('Subscription operation rate limit exceeded', {
          clientIp,
          hospitalId,
          path: req.path,
          method: req.method,
          failure,
          timestamp: new Date().toISOString()
        });

        return res.status(429).json({
          error: 'Too many requests',
          code: 'OPERATION_RATE_LIMITED',
          retryAfter: Math.ceil((failure.resetTime - Date.now()) / 1000)
        });
      }

      next();
    } catch (error) {
      console.error('General rate limiting error', {
        error: error.message,
        stack: error.stack
      });
      
      // Fail open
      next();
    }
  }

  /**
   * Suspicious activity detection and blocking
   */
  static async detectSuspiciousActivity(req, res, next) {
    try {
      const clientIp = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent') || 'unknown';
      
      // Check for failure-based blocking
      const failureBlockKey = `ratelimit:blocked:failures:${clientIp}`;
      const isBlocked = await require('../services/redis.service').exists(failureBlockKey);
      
      if (isBlocked) {
        const ttl = await require('../services/redis.service').ttl(failureBlockKey);
        
        console.error('Blocked suspicious IP attempting subscription operation', {
          clientIp,
          userAgent,
          path: req.path,
          blockTimeRemaining: ttl,
          timestamp: new Date().toISOString()
        });

        return res.status(403).json({
          error: 'Access temporarily restricted due to suspicious activity',
          code: 'SUSPICIOUS_ACTIVITY_BLOCKED',
          retryAfter: ttl
        });
      }

      // Pattern detection for suspicious requests
      const suspiciousPatterns = [
        // Missing or suspicious user agents
        !userAgent || userAgent.length < 10,
        // Rapid requests (checked via other rate limits)
        // Missing common headers
        !req.get('Accept'),
        // Suspicious paths or parameters
        JSON.stringify(req.body).length > 10000 // Oversized payloads
      ];

      const suspicionScore = suspiciousPatterns.filter(Boolean).length;
      
      if (suspicionScore >= 2) {
        console.warn('Suspicious subscription request detected', {
          clientIp,
          userAgent,
          path: req.path,
          suspicionScore,
          patterns: suspiciousPatterns,
          timestamp: new Date().toISOString()
        });

        // Don't block immediately, but record for monitoring
        await rateLimiter.recordFailure(clientIp, 'suspicious_request', 'pattern_match');
      }

      next();
    } catch (error) {
      console.error('Suspicious activity detection error', {
        error: error.message,
        stack: error.stack
      });
      
      // Fail open
      next();
    }
  }

  /**
   * Rate limit status endpoint for monitoring
   */
  static async getRateLimitStatus(req, res) {
    try {
      const { hospitalId, ip, limitType } = req.query;
      
      if (!hospitalId && !ip) {
        return res.status(400).json({
          error: 'hospitalId or ip parameter is required'
        });
      }

      const key = hospitalId || ip;
      const types = limitType ? [limitType] : [
        'renewalAttempts',
        'verificationAttempts', 
        'ipBasedOperations',
        'globalRenewals'
      ];

      const statuses = await Promise.all(
        types.map(type => rateLimiter.getStatus(key, type))
      );

      const activeBlocks = await rateLimiter.getActiveBlocks();

      res.json({
        key,
        statuses: statuses.filter(s => s !== null),
        activeBlocks: activeBlocks.filter(block => 
          block.identifier === key || (!hospitalId && block.identifier.includes(key))
        ),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Failed to get rate limit status', error);
      res.status(500).json({
        error: 'Failed to retrieve rate limit status',
        details: error.message
      });
    }
  }

  /**
   * Reset rate limits (admin endpoint)
   */
  static async resetRateLimit(req, res) {
    try {
      const { key, limitType } = req.body;
      
      if (!key || !limitType) {
        return res.status(400).json({
          error: 'key and limitType are required'
        });
      }

      const success = await rateLimiter.resetLimit(key, limitType);
      
      if (success) {
        console.info('Rate limit reset by admin', {
          key,
          limitType,
          adminUser: req.user?.id,
          timestamp: new Date().toISOString()
        });

        res.json({
          success: true,
          message: `Rate limit reset for ${key}:${limitType}`
        });
      } else {
        res.status(500).json({
          error: 'Failed to reset rate limit'
        });
      }

    } catch (error) {
      console.error('Failed to reset rate limit', error);
      res.status(500).json({
        error: 'Failed to reset rate limit',
        details: error.message
      });
    }
  }
}

module.exports = SubscriptionRateLimitMiddleware;
