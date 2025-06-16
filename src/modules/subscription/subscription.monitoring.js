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
          subscription: true,
          hospital: {
            select: {
              id: true,
              name: true,
              adminEmail: true
            }
          }
        }
      });

      console.info(`Found ${stuckRenewals.length} stuck renewal(s) to cleanup`, {
        timestamp: new Date().toISOString(),
        cutoffTime: thirtyMinutesAgo.toISOString()
      });

      let processedCount = 0;
      let failedCount = 0;

      for (const renewal of stuckRenewals) {
        try {
          await this.handleStuckRenewal(renewal);
          processedCount++;
        } catch (error) {
          console.error(`Failed to process stuck renewal ${renewal.id}:`, {
            renewalId: renewal.id,
            hospitalId: renewal.hospitalId,
            error: error.message,
            timestamp: new Date().toISOString()
          });
          failedCount++;
        }
      }

      const result = { 
        total: stuckRenewals.length,
        processed: processedCount, 
        failed: failedCount 
      };

      console.info('Completed stuck renewals cleanup', {
        result,
        timestamp: new Date().toISOString()
      });

      return result;
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
      console.info(`Processing stuck renewal ${renewal.id}`, {
        renewalId: renewal.id,
        hospitalId: renewal.hospitalId,
        hospitalName: renewal.hospital?.name,
        createdAt: renewal.createdAt,
        razorpayOrderId: renewal.razorpayOrderId,
        timestamp: new Date().toISOString()
      });

      // Check if payment was actually processed via Razorpay API
      if (renewal.razorpayOrderId) {
        const getRazorpayInstance = require('../../config/razorpay.config');
        const razorpay = getRazorpayInstance();
        const subscriptionService = require('./subscription.service');
        const mailService = require('../../services/mail.service');
        
        try {
          const orderDetails = await razorpay.orders.fetch(renewal.razorpayOrderId);
          
          console.info(`Razorpay order status for renewal ${renewal.id}:`, {
            renewalId: renewal.id,
            razorpayOrderId: renewal.razorpayOrderId,
            orderStatus: orderDetails.status,
            orderAmount: orderDetails.amount,
            amountPaid: orderDetails.amount_paid,
            timestamp: new Date().toISOString()
          });
          
          if (orderDetails.status === 'paid') {

            const result = await this.checkAndProcessRazorpayPayment(renewal.razorpayOrderId);
            console.info(`Payment check result for renewal ${renewal.id}:`, {
              renewalId: renewal.id,
              razorpayOrderId: renewal.razorpayOrderId,
              success: result.success,
              timestamp: new Date().toISOString()
            });
            const superadminEmail = process.env.SUPER_ADMIN_EMAIL;
                if (superadminEmail) {
                  const emailContent = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                      <h2>Automatic Payment Recovery Success</h2>
                      <p>A previously stuck payment has been successfully processed:</p>
                      
                      <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
                        <p><strong>Details:</strong></p>
                        <ul>
                          <li>Hospital: ${renewal.hospital?.name} (ID: ${renewal.hospitalId})</li>
                          <li>Renewal ID: ${renewal.id}</li>
                          <li>Razorpay Order ID: ${renewal.razorpayOrderId}</li>
                          <li>Razorpay Payment ID: ${payment.id}</li>
                          <li>Amount: Rs. ${payment.amount / 100}</li>
                          <li>Payment Method: ${payment.method}</li>
                          <li>Processed At: ${new Date().toISOString()}</li>
                        </ul>
                      </div>
                      
                      <p>The subscription has been automatically updated and the hospital has been notified.</p>
                    </div>
                  `;
                  
                  await mailService.sendMail(
                    superadminEmail,
                    `Payment Recovery Success - Hospital: ${renewal.hospital?.name}`,
                    emailContent
                  );
                }
                
          } else if (orderDetails.status === 'created' || orderDetails.status === 'attempted') {
            // Order was created but never paid, safe to mark as failed
            await this.markRenewalAsFailed(renewal, 'TIMEOUT_UNPAID', {
              razorpayStatus: orderDetails.status,
              timeoutMinutes: Math.floor((Date.now() - new Date(renewal.createdAt).getTime()) / (1000 * 60))
            });
          } else {
            // Other statuses (failed, etc.)
            await this.markRenewalAsFailed(renewal, 'RAZORPAY_ORDER_FAILED', {
              razorpayStatus: orderDetails.status
            });
          }
        } catch (razorpayError) {
          console.error('Failed to fetch order details from Razorpay', {
            renewalId: renewal.id,
            razorpayOrderId: renewal.razorpayOrderId,
            error: razorpayError.message,
            stack: razorpayError.stack
          });
          
          // Mark for admin review since we couldn't determine status
          await this.markForAdminReview(renewal, 'RAZORPAY_API_ERROR', {
            error: razorpayError.message
          });
        }
      } else {
        // No Razorpay order ID, safe to mark as failed
        console.info(`No Razorpay order ID found for renewal ${renewal.id}, marking as failed`);
        await this.markRenewalAsFailed(renewal, 'NO_PAYMENT_INITIATED', {
          timeoutMinutes: Math.floor((Date.now() - new Date(renewal.createdAt).getTime()) / (1000 * 60))
        });
      }
    } catch (error) {
      console.error('Failed to handle stuck renewal', {
        renewalId: renewal.id,
        hospitalId: renewal.hospitalId,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      
      // Re-throw to be caught by the calling function
      throw error;
    }
  }

  async markRenewalAsFailed(renewal, reason, additionalData = {}) {
    try {
      // Use transaction to ensure data consistency
      await prisma.$transaction(async (tx) => {
        // Update the subscription history
        await tx.subscriptionHistory.update({
          where: { id: renewal.id },
          data: {
            paymentStatus: PAYMENT_STATUS.FAILED,
            paymentDetails: {
              ...(renewal.paymentDetails || {}),
              failureReason: reason,
              failedAt: new Date().toISOString(),
              autoFailedByMonitoring: true,
              ...additionalData
            }
          }
        });

        // Also update the main subscription status if it's still pending
        if (renewal.subscription && renewal.subscription.paymentStatus === PAYMENT_STATUS.PENDING) {
          await tx.hospitalSubscription.update({
            where: { id: renewal.subscriptionId },
            data: {
              paymentStatus: PAYMENT_STATUS.FAILED
            }
          });
        }
      });

      console.info('Marked stuck renewal as failed', {
        renewalId: renewal.id,
        hospitalId: renewal.hospitalId,
        hospitalName: renewal.hospital?.name,
        reason,
        additionalData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to mark renewal as failed', {
        renewalId: renewal.id,
        hospitalId: renewal.hospitalId,
        reason,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async markForAdminReview(renewal, issue, additionalData = {}) {
    try {
      // Update with admin review flag
      await prisma.subscriptionHistory.update({
        where: { id: renewal.id },
        data: {
          paymentDetails: {
            ...(renewal.paymentDetails || {}),
            requiresAdminReview: true,
            reviewReason: issue,
            flaggedAt: new Date().toISOString(),
            ...additionalData
          }
        }
      });

      // Send alert to admin (implement based on your notification system)
      console.error('ADMIN REVIEW REQUIRED: Subscription renewal issue', {
        renewalId: renewal.id,
        hospitalId: renewal.hospitalId,
        hospitalName: renewal.hospital?.name,
        adminEmail: renewal.hospital?.adminEmail,
        issue,
        razorpayOrderId: renewal.razorpayOrderId,
        additionalData,
        timestamp: new Date().toISOString()
      });

      // TODO: Integrate with alerting service here
      // await this.sendAdminAlert(renewal, issue, additionalData);
    } catch (error) {
      console.error('Failed to mark for admin review', {
        renewalId: renewal.id,
        hospitalId: renewal.hospitalId,
        issue,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
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

  async checkAndProcessRazorpayPayment(orderId) {
    if (!orderId) {
      console.error('Cannot check Razorpay payment: No order ID provided');
      return { success: false, error: 'No order ID provided' };
    }

    try {
      console.info(`Checking Razorpay payment status for order ID: ${orderId}`, {
        orderId,
        timestamp: new Date().toISOString()
      });

      // Find related subscription history entry
      const subscriptionHistory = await prisma.subscriptionHistory.findFirst({
        where: { razorpayOrderId: orderId },
        include: {
          hospital: {
            select: {
              id: true,
              name: true,
              adminEmail: true
            }
          }
        }
      });

      if (!subscriptionHistory) {
        console.warn(`No subscription history found for order ID: ${orderId}`, {
          orderId,
          timestamp: new Date().toISOString()
        });
        return { success: false, error: 'No subscription history found for this order ID' };
      }

      // Get Razorpay instance
      const getRazorpayInstance = require('../../config/razorpay.config');
      const razorpay = getRazorpayInstance();
      const subscriptionService = require('./subscription.service');
      const mailService = require('../../services/mail.service');

      // Fetch order details from Razorpay
      const orderDetails = await razorpay.orders.fetch(orderId);

      console.info(`Retrieved Razorpay order details:`, {
        orderId,
        orderStatus: orderDetails.status,
        orderAmount: orderDetails.amount,
        amountPaid: orderDetails.amount_paid,
        timestamp: new Date().toISOString()
      });

      // Check if payment was successful
      if (orderDetails.status === 'paid') {
        // Fetch complete payment details
        const payments = await razorpay.orders.fetchPayments(orderId);
        
        if (payments && payments.items && payments.items.length > 0) {
          // Get the successful payment
          const payment = payments.items.find(item => item.status === 'captured');
          
          if (payment) {
            console.info(`Found successful payment for order ${orderId}`, {
              paymentId: payment.id,
              paymentStatus: payment.status,
              paymentAmount: payment.amount,
              paymentMethod: payment.method,
              timestamp: new Date().toISOString()
            });
            
            // Begin transaction to update subscription records
            const result = await prisma.$transaction(async (tx) => {
              // Find current subscription - note the correction to use hospitalSubscription
              const currentSub = await tx.hospitalSubscription.findFirst({
                where: { hospitalId: subscriptionHistory.hospitalId },
                orderBy: { createdAt: 'desc' }
              });
              
              if (!currentSub) {
                throw new Error(`No subscription found for hospital ${subscriptionHistory.hospitalId}`);
              }
              
              // Update subscription records using subscription service methods
              const updatedSubscription = await subscriptionService._updateSubscriptionRecords(
                tx,
                currentSub,
                subscriptionHistory.hospitalId,
                subscriptionHistory,
                payment
              );
              
              return { success: true, subscription: updatedSubscription };
            });
            
            // Perform post-processing (cache invalidation, notifications) outside transaction
            await subscriptionService._performPostProcessing(
              result.subscription,
              subscriptionHistory.hospital,
              subscriptionHistory.hospitalId
            );
            
            // Notify superadmin about the successfully processed payment
            const superadminEmail = process.env.SUPERADMIN_EMAIL;
            if (superadminEmail) {
              const emailContent = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2>Payment Successfully Processed</h2>
                  <p>A payment has been successfully processed:</p>
                  
                  <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
                    <p><strong>Details:</strong></p>
                    <ul>
                      <li>Hospital: ${subscriptionHistory.hospital?.name} (ID: ${subscriptionHistory.hospitalId})</li>
                      <li>Subscription History ID: ${subscriptionHistory.id}</li>
                      <li>Razorpay Order ID: ${orderId}</li>
                      <li>Razorpay Payment ID: ${payment.id}</li>
                      <li>Amount: Rs. ${payment.amount / 100}</li>
                      <li>Payment Method: ${payment.method}</li>
                      <li>Processed At: ${new Date().toISOString()}</li>
                    </ul>
                  </div>
                  
                  <p>The subscription has been automatically updated.</p>
                </div>
              `;
              
              await mailService.sendMail(
                superadminEmail,
                `Payment Success - Hospital: ${subscriptionHistory.hospital?.name}`,
                emailContent
              );
            }
            
            console.info(`Successfully processed payment for order ${orderId}`, {
              orderId,
              hospitalId: subscriptionHistory.hospitalId,
              subscriptionHistoryId: subscriptionHistory.id, 
              razorpayPaymentId: payment.id,
              timestamp: new Date().toISOString()
            });
            
            return { 
              success: true, 
              paymentId: payment.id,
              hospitalId: subscriptionHistory.hospitalId,
              subscriptionId: result.subscription.id
            };
          } else {
            console.warn(`No captured payment found for paid order ${orderId}`);
            return { success: false, error: 'No captured payment found for this order' };
          }
        } else {
          console.warn(`No payment details found for order ${orderId}`);
          return { success: false, error: 'No payment details found for this order' };
        }
      } else {
        console.info(`Order ${orderId} payment status is not 'paid' (status: ${orderDetails.status})`);
        return { success: false, status: orderDetails.status };
      }
    } catch (error) {
      console.error(`Failed to process payment for order ID: ${orderId}`, {
        orderId,
        error: error.message,
        stack: error.stack
      });
      return { success: false, error: error.message };
    }
  }
}

module.exports = new SubscriptionMonitoringService();
