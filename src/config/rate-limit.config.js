/**
 * Rate Limiting Configuration for Subscription Service
 * Centralized configuration for all rate limiting policies
 */

const RATE_LIMIT_CONFIG = {
  // Environment-based multipliers
  ENVIRONMENT_MULTIPLIERS: {
    development: 100,    // More lenient in development
    staging: 1.5,      // Slightly more lenient in staging
    production: 1      // Strict in production
  },

  // Base rate limits (will be multiplied by environment multiplier)
  BASE_LIMITS: {
    // Subscription renewal attempts per hospital
    renewalAttempts: {
      points: 3,           // 3 renewal attempts
      duration: 300,       // per 5 minutes (300 seconds)
      blockDuration: 900   // block for 15 minutes (900 seconds)
    },

    // Payment verification attempts per order/IP
    verificationAttempts: {
      points: 5,           // 5 verification attempts
      duration: 600,       // per 10 minutes
      blockDuration: 1800  // block for 30 minutes
    },

    // Global renewal rate limiting (across all hospitals)
    globalRenewals: {
      points: 100,         // 100 renewals globally
      duration: 60,        // per minute
      blockDuration: 300   // block for 5 minutes
    },

    // Per IP address rate limiting
    ipBasedOperations: {
      points: 20,          // 20 operations per IP
      duration: 300,       // per 5 minutes
      blockDuration: 600   // block for 10 minutes
    },

    // Failed operations pattern detection
    failedOperations: {
      points: 10,          // 10 failed operations
      duration: 3600,      // per hour
      blockDuration: 7200  // block for 2 hours
    },

    // Suspicious activity detection
    suspiciousActivity: {
      points: 5,           // 5 suspicious activities
      duration: 1800,      // per 30 minutes
      blockDuration: 3600  // block for 1 hour
    }
  },

  // Special limits for different user types
  USER_TYPE_LIMITS: {
    // Premium hospitals get higher limits
    premium: {
      multiplier: 2,
      specialLimits: {
        renewalAttempts: {
          points: 5,
          duration: 300,
          blockDuration: 600
        }
      }
    },

    // Standard hospitals get default limits
    standard: {
      multiplier: 1,
      specialLimits: {}
    },

    // Trial hospitals get stricter limits
    trial: {
      multiplier: 0.5,
      specialLimits: {
        renewalAttempts: {
          points: 2,
          duration: 600,
          blockDuration: 1800
        }
      }
    }
  },

  // Time-based adjustments
  TIME_BASED_ADJUSTMENTS: {
    // Peak hours (9 AM to 6 PM IST) - stricter limits
    peakHours: {
      startHour: 9,
      endHour: 18,
      multiplier: 0.8  // 20% stricter
    },

    // Off-peak hours - more lenient
    offPeakHours: {
      multiplier: 1.2  // 20% more lenient
    },

    // Weekend adjustments
    weekend: {
      multiplier: 1.5  // 50% more lenient on weekends
    }
  },

  // Geographic rate limiting
  GEOGRAPHIC_LIMITS: {
    // Default for Indian IPs
    domestic: {
      multiplier: 1
    },

    // Stricter for international IPs
    international: {
      multiplier: 0.5,
      additionalVerification: true
    }
  },

  // Emergency Settings for Rate Limiter
  EMERGENCY_SETTINGS: {
    emergencySettings: {
      autoDisableThresholds: {
        redisFailureRate: 0.1,      // 10% Redis failure rate threshold
        consecutiveFailures: 5       // 5 consecutive failures threshold
      },
      recoveryPeriod: 300,          // 5 minutes recovery period
      monitoringInterval: 60         // Check system health every minute
    }
  }
};

/**
 * Get rate limit configuration based on environment and context
 * @param {string} limitType - Type of rate limit
 * @param {Object} context - Context object with environment, userType, etc.
 * @returns {Object} Computed rate limit configuration
 */
function getRateLimitConfig(limitType, context = {}) {
  const {
    environment = process.env.NODE_ENV || 'development',
    userType = 'standard',
    isWeekend = false,
    currentHour = new Date().getHours(),
    isInternational = false
  } = context;

  const baseLimit = RATE_LIMIT_CONFIG.BASE_LIMITS[limitType];
  if (!baseLimit) {
    throw new Error(`Unknown rate limit type: ${limitType}`);
  }

  // Start with base configuration
  let config = { ...baseLimit };

  // Apply environment multiplier
  const envMultiplier = RATE_LIMIT_CONFIG.ENVIRONMENT_MULTIPLIERS[environment] || 1;
  
  // Apply user type adjustments
  const userConfig = RATE_LIMIT_CONFIG.USER_TYPE_LIMITS[userType];
  const userMultiplier = userConfig ? userConfig.multiplier : 1;
  const specialLimit = userConfig?.specialLimits[limitType];

  if (specialLimit) {
    config = { ...specialLimit };
  }

  // Apply time-based adjustments
  let timeMultiplier = 1;
  const { peakHours, offPeakHours, weekend } = RATE_LIMIT_CONFIG.TIME_BASED_ADJUSTMENTS;

  if (isWeekend && weekend.multiplier) {
    timeMultiplier *= weekend.multiplier;
  } else if (currentHour >= peakHours.startHour && currentHour < peakHours.endHour) {
    timeMultiplier *= peakHours.multiplier;
  } else {
    timeMultiplier *= offPeakHours.multiplier;
  }

  // Apply geographic adjustments
  const geoMultiplier = isInternational ? 
    RATE_LIMIT_CONFIG.GEOGRAPHIC_LIMITS.international.multiplier :
    RATE_LIMIT_CONFIG.GEOGRAPHIC_LIMITS.domestic.multiplier;

  // Calculate final values
  const totalMultiplier = envMultiplier * userMultiplier * timeMultiplier * geoMultiplier;

  return {
    points: Math.max(1, Math.round(config.points * totalMultiplier)),
    duration: config.duration,
    blockDuration: config.blockDuration,
    metadata: {
      basePoints: baseLimit.points,
      appliedMultipliers: {
        environment: envMultiplier,
        userType: userMultiplier,
        time: timeMultiplier,
        geographic: geoMultiplier,
        total: totalMultiplier
      },
      context: {
        environment,
        userType,
        isWeekend,
        currentHour,
        isInternational
      }
    }
  };
}

/**
 * Check if emergency bypass should be activated
 * @param {Object} systemMetrics - Current system metrics
 * @returns {boolean} Whether emergency bypass should be active
 */
function shouldActivateEmergencyBypass(systemMetrics) {
  const { emergencySettings } = RATE_LIMIT_CONFIG.EMERGENCY_SETTINGS;
  
  if (systemMetrics.redisFailureRate >= emergencySettings.autoDisableThresholds.redisFailureRate) {
    return true;
  }

  if (systemMetrics.consecutiveFailures >= emergencySettings.autoDisableThresholds.consecutiveFailures) {
    return true;
  }

  return false;
}

module.exports = {
  RATE_LIMIT_CONFIG,
  getRateLimitConfig,
  shouldActivateEmergencyBypass
};
