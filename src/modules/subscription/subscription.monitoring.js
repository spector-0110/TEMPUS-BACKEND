// Enhanced error recovery and monitoring for subscription service
const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const { PAYMENT_STATUS, SUBSCRIPTION_STATUS } = require('../subscription/subscription.constants');

class SubscriptionMonitoringService {
  constructor() {
    this.alertThresholds = {
      failedPayments: 5, // Alert after 5 failed payments in 1 hour
      timeouts: 3, // Alert after 3 consecutive timeouts
      duplicateAttempts: 10 // Alert after 10 duplicate attempts in 1 hour
    };
    
    this.metrics = {
      failedPayments: 0,
      consecutiveTimeouts: 0,
      duplicateAttempts: 0,
      lastReset: new Date()
    };
  }

  // Monitor and recover from stuck pending renewals
  async cleanupStuckRenewals() {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    try {
      // Find renewals that are stuck in PENDING status for more than 30 minutes
      const stuckRenewals = await prisma.subscriptionHistory.findMany({
        where: {
          paymentStatus: PAYMENT_STATUS.PENDING,
          createdAt: {
            lt: thirtyMinutesAgo
          }
        },
        include: {
          subscription: true
        }
      });

      console.info(`Found ${stuckRenewals.length} stuck renewal(s) to cleanup`, {
        timestamp: new Date().toISOString()
      });

      for (const renewal of stuckRenewals) {
        await this.handleStuckRenewal(renewal);
      }

      return { cleaned: stuckRenewals.length };
    } catch (error) {
      console.error('Failed to cleanup stuck renewals', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async handleStuckRenewal(renewal) {
    try {
      // Check if payment was actually processed via Razorpay API
      if (renewal.razorpayOrderId) {
        const getRazorpayInstance = require('../../config/razorpay.config');
        const razorpay = getRazorpayInstance();
        
        try {
          const orderDetails = await razorpay.orders.fetch(renewal.razorpayOrderId);
          
          if (orderDetails.status === 'paid') {
            console.warn('Found paid order that was not processed', {
              renewalId: renewal.id,
              razorpayOrderId: renewal.razorpayOrderId,
              hospitalId: renewal.hospitalId
            });
            
            // This needs manual verification - mark for admin review
            await this.markForAdminReview(renewal, 'PAID_BUT_NOT_PROCESSED');
          } else {
            // Order was never paid, safe to mark as failed
            await this.markRenewalAsFailed(renewal, 'TIMEOUT_UNPAID');
          }
        } catch (razorpayError) {
          console.error('Failed to fetch order details from Razorpay', {
            renewalId: renewal.id,
            razorpayOrderId: renewal.razorpayOrderId,
            error: razorpayError.message
          });
          
          // Mark for manual review if we can't verify
          await this.markForAdminReview(renewal, 'RAZORPAY_API_ERROR');
        }
      } else {
        // No Razorpay order ID, safe to mark as failed
        await this.markRenewalAsFailed(renewal, 'NO_PAYMENT_INITIATED');
      }
    } catch (error) {
      console.error('Failed to handle stuck renewal', {
        renewalId: renewal.id,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  async markRenewalAsFailed(renewal, reason) {
    await prisma.subscriptionHistory.update({
      where: { id: renewal.id },
      data: {
        paymentStatus: PAYMENT_STATUS.FAILED,
        paymentDetails: {
          failureReason: reason,
          failedAt: new Date().toISOString(),
          autoFailedByMonitoring: true
        }
      }
    });

    console.info('Marked stuck renewal as failed', {
      renewalId: renewal.id,
      hospitalId: renewal.hospitalId,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  async markForAdminReview(renewal, issue) {
    // Update with admin review flag
    await prisma.subscriptionHistory.update({
      where: { id: renewal.id },
      data: {
        paymentDetails: {
          ...renewal.paymentDetails,
          requiresAdminReview: true,
          reviewReason: issue,
          flaggedAt: new Date().toISOString()
        }
      }
    });

    // Send alert to admin (implement based on your notification system)
    console.error('ADMIN REVIEW REQUIRED: Subscription renewal issue', {
      renewalId: renewal.id,
      hospitalId: renewal.hospitalId,
      issue,
      razorpayOrderId: renewal.razorpayOrderId,
      timestamp: new Date().toISOString()
    });

    // Could integrate with alerting service here
    // await this.sendAdminAlert(renewal, issue);
  }

  // Monitor Redis locks and release orphaned ones
  async cleanupOrphanedLocks() {
    try {
      const lockPatterns = [
        'renewal_lock:*',
        'verification_lock:*'
      ];

      for (const pattern of lockPatterns) {
        const keys = await redisService.getClient().then(client => client.keys(pattern));
        
        for (const key of keys) {
          const ttl = await redisService.ttl(key);
          
          // If lock has been held for more than 5 minutes, it's likely orphaned
          if (ttl > 0 && ttl < (30 * 60 - 5 * 60)) {
            console.warn('Releasing potentially orphaned lock', {
              key,
              ttl,
              timestamp: new Date().toISOString()
            });
            
            await redisService.deleteCache(key);
          }
        }
      }
    } catch (error) {
      console.error('Failed to cleanup orphaned locks', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Track and alert on error patterns
  recordError(errorType, context = {}) {
    const now = new Date();
    
    // Reset metrics if it's been more than an hour
    if (now - this.metrics.lastReset > 60 * 60 * 1000) {
      this.resetMetrics();
    }

    switch (errorType) {
      case 'PAYMENT_FAILED':
        this.metrics.failedPayments++;
        if (this.metrics.failedPayments >= this.alertThresholds.failedPayments) {
          this.sendAlert('HIGH_PAYMENT_FAILURE_RATE', {
            count: this.metrics.failedPayments,
            threshold: this.alertThresholds.failedPayments,
            ...context
          });
        }
        break;

      case 'TIMEOUT':
        this.metrics.consecutiveTimeouts++;
        if (this.metrics.consecutiveTimeouts >= this.alertThresholds.timeouts) {
          this.sendAlert('CONSECUTIVE_TIMEOUTS', {
            count: this.metrics.consecutiveTimeouts,
            threshold: this.alertThresholds.timeouts,
            ...context
          });
        }
        break;

      case 'DUPLICATE_ATTEMPT':
        this.metrics.duplicateAttempts++;
        if (this.metrics.duplicateAttempts >= this.alertThresholds.duplicateAttempts) {
          this.sendAlert('HIGH_DUPLICATE_ATTEMPT_RATE', {
            count: this.metrics.duplicateAttempts,
            threshold: this.alertThresholds.duplicateAttempts,
            ...context
          });
        }
        break;
    }
  }

  recordSuccess(successType) {
    // Reset consecutive timeout counter on success
    if (successType === 'PAYMENT_VERIFIED') {
      this.metrics.consecutiveTimeouts = 0;
    }
  }

  resetMetrics() {
    this.metrics = {
      failedPayments: 0,
      consecutiveTimeouts: 0,
      duplicateAttempts: 0,
      lastReset: new Date()
    };
  }

  sendAlert(alertType, data) {
    console.error(`SUBSCRIPTION ALERT: ${alertType}`, {
      alertType,
      data,
      timestamp: new Date().toISOString()
    });

    // Implement integration with your alerting system here
    // Examples: Slack, PagerDuty, email, etc.
  }

  // Health check for subscription system
  async getSystemHealth() {
    try {
      const health = {
        status: 'healthy',
        checks: {
          database: 'unknown',
          redis: 'unknown',
          razorpay: 'unknown'
        },
        metrics: this.metrics,
        timestamp: new Date().toISOString()
      };

      // Check database connectivity
      try {
        await prisma.$queryRaw`SELECT 1`;
        health.checks.database = 'healthy';
      } catch (dbError) {
        health.checks.database = 'error';
        health.status = 'unhealthy';
      }

      // Check Redis connectivity
      try {
        const redisHealth = await redisService.checkHealth();
        health.checks.redis = redisHealth.status;
        if (redisHealth.status !== 'healthy') {
          health.status = 'degraded';
        }
      } catch (redisError) {
        health.checks.redis = 'error';
        health.status = 'unhealthy';
      }

      // Check Razorpay connectivity (light check)
      try {
        const getRazorpayInstance = require('../../config/razorpay.config');
        const razorpay = getRazorpayInstance();
        
        // Simple test to see if we can create an instance
        if (razorpay && razorpay.orders) {
          health.checks.razorpay = 'healthy';
        } else {
          health.checks.razorpay = 'error';
          health.status = 'degraded';
        }
      } catch (razorpayError) {
        health.checks.razorpay = 'error';
        health.status = 'degraded';
      }

      return health;
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Run all monitoring tasks
  async runMonitoringTasks() {
    console.info('Running subscription monitoring tasks', {
      timestamp: new Date().toISOString()
    });

    const results = {};

    try {
      results.stuckRenewals = await this.cleanupStuckRenewals();
    } catch (error) {
      results.stuckRenewals = { error: error.message };
    }

    try {
      await this.cleanupOrphanedLocks();
      results.orphanedLocks = { status: 'cleaned' };
    } catch (error) {
      results.orphanedLocks = { error: error.message };
    }

    results.systemHealth = await this.getSystemHealth();

    console.info('Completed subscription monitoring tasks', {
      results,
      timestamp: new Date().toISOString()
    });

    return results;
  }
}

module.exports = new SubscriptionMonitoringService();
