const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const messageService = require('../notification/message.service');
const monitoringService = require('./subscription.monitoring');
const crypto = require('crypto');
const  getRazorpayInstance = require('../../config/razorpay.config');
const { 
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE,
  PRICING,
  CACHE_KEYS,
  CACHE_EXPIRY,
  LIMITS,
  PAYMENT_STATUS
} = require('./subscription.constants');

class SubscriptionService {

  // Utility method for acquiring distributed locks with Redis
  async acquireLock(lockKey, timeout = 30) {
    try {
      const acquired = await redisService.setCache(lockKey, 'locked', timeout, 'NX');
      if (!acquired) {
        console.warn(`Failed to acquire lock: ${lockKey}`, {
          timestamp: new Date().toISOString()
        });
      }
      return acquired;
    } catch (error) {
      console.error(`Error acquiring lock: ${lockKey}`, {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }

  // Utility method for releasing distributed locks
  async releaseLock(lockKey) {
    try {
      await redisService.deleteCache(lockKey);
      console.debug(`Lock released: ${lockKey}`, {
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`Error releasing lock: ${lockKey}`, {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Utility method for safe cache invalidation
  async invalidateSubscriptionCache(hospitalId) {
    const cacheKeys = [
      CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId,
      `hospital:dashboard:${hospitalId}`
    ];

    for (const key of cacheKeys) {
      try {
        await redisService.invalidateCache(key);
        console.debug(`Cache invalidated: ${key}`, {
          hospitalId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Failed to invalidate cache: ${key}`, {
          hospitalId,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  async calculatePrice(doctorCount, billingCycle) {
    const basePriceTotal = PRICING.BASE_PRICE_PER_DOCTOR * doctorCount;

    // Apply volume discount
    let volumeDiscount = 0;
    for (const tier of PRICING.VOLUME_DISCOUNTS) {
      if (doctorCount >= tier.minDoctors) {
        volumeDiscount = tier.discount;
      }
    }

    const volumeDiscountAmount = (basePriceTotal * volumeDiscount) / 100;
    const priceAfterVolumeDiscount = basePriceTotal - volumeDiscountAmount;

    // Apply yearly discount if applicable
    let finalPrice = priceAfterVolumeDiscount;

    if (billingCycle === BILLING_CYCLE.YEARLY) {
      const yearlyDiscountAmount = (priceAfterVolumeDiscount * PRICING.YEARLY_DISCOUNT_PERCENTAGE) / 100;
      finalPrice = (priceAfterVolumeDiscount - yearlyDiscountAmount) * 12;
    }

    return Math.round(finalPrice * 100) / 100;
  }

  async getHospitalSubscription(hospitalId, statusFlag = false) {
    const cacheKey = CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId;
    
    try {
      let subscription = await redisService.getCache(cacheKey);

      let status;
      if (statusFlag) {
        status = undefined;  // find any subscription regardless of status
      } else {
        status = SUBSCRIPTION_STATUS.ACTIVE; // only find active subscriptions
      }

      if (!subscription) {
        subscription = await prisma.hospitalSubscription.findFirst({
          where: { 
            hospitalId,
            status: status
          }
        });

        if (subscription) {
          // Use try-catch for cache operations to prevent cache errors from affecting main flow
          try {
            await redisService.setCache(cacheKey, subscription, CACHE_EXPIRY.HOSPITAL_SUBSCRIPTION);
          } catch (error) {
            console.error('Cache set failed:', error);
          }
        }
      }

      return subscription;
    } catch (error) {
      // If cache fails, fallback to database
      console.error('Cache operation failed:', error);
      return await prisma.hospitalSubscription.findFirst({
        where: { 
          hospitalId,
          status: statusFlag ? undefined : SUBSCRIPTION_STATUS.ACTIVE
        }
      });
    }
  }

async sendSubscriptionEmail(subscription, emailType, hospital) {
  const formatCurrency = (amount) => `₹${Number(amount).toFixed(2)}`;
  const formatDate = (date) => new Date(date).toLocaleDateString();

  const getEmailContent = () => {
    const baseContent = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        
        <!-- Header -->
        <div style="background-color: #2563EB; padding: 20px;">
          <h2 style="color: #ffffff; margin: 0;">Subscription ${emailType}</h2>
        </div>

        <!-- Body -->
        <div style="padding: 24px;">
          <p style="font-size: 16px; color: #111827;">Dear ${hospital.name} Administrator,</p>

          <div style="background-color: #F3F4F6; padding: 16px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Subscription Details:</strong></p>
            <ul style="padding-left: 20px; margin: 0; color: #374151;">
              <li>Doctors Allowed: <strong>${subscription.doctorCount}</strong></li>
              <li>Billing Cycle: <strong>${subscription.billingCycle}</strong></li>
              <li>Total Price: <strong>${formatCurrency(subscription.totalPrice)}</strong></li>
              <li>Valid Until: <strong>${formatDate(subscription.endDate)}</strong></li>
              <li>Payment Method: <strong>${subscription.paymentMethod}</strong></li>
            </ul>
          </div>
    `;

    const dynamicMessage = {
      Created: `
        <p>Your subscription has been <strong>successfully created</strong>. Welcome aboard!</p>
        <p>You can now start adding doctors and managing your hospital with Tiqora.</p>
      `,
      Updated: `
        <p>Your subscription has been <strong>updated</strong> with the new doctor count.</p>
        <p>These changes are now active and reflected in your dashboard.</p>
      `,
      Renewed: `
        <p>Your subscription has been <strong>renewed</strong> successfully.</p>
        <p>We appreciate your continued trust in Tiqora for hospital queue management.</p>
      `
    };

    return baseContent + (dynamicMessage[emailType] || '');
  };

  const emailContent = getEmailContent() + `
        <div style="margin-top: 20px;">
          <p style="font-size: 15px; color: #4B5563;">
            If you have any questions, feel free to reach out to our support team at <a href="mailto:support@tiqora.in" style="color: #2563EB;">support@tiqora.in</a>.
          </p>
        </div>

        <!-- Footer -->
        <div style="border-top: 1px solid #E5E7EB; margin-top: 32px; padding-top: 16px; text-align: center; font-size: 12px; color: #9CA3AF;">
          <p style="margin: 0;">This is an automated email from Tiqora</p>
          <p style="margin: 0;">©️ ${new Date().getFullYear()} Tiqora Technologies. All rights reserved.</p>
        </div>
      </div>
    </div>`;

  // Send email through message service
  return messageService.sendMessage('email', {
    to: hospital.adminEmail,
    subject: `Subscription ${emailType} - ${hospital.name}`,
    content: emailContent,
    hospitalId: hospital.id,
    metadata: {
      subscriptionId: subscription.id,
      emailType: `subscription_${emailType.toLowerCase()}`,
      timestamp: new Date().toISOString()
    }
  });
}

  async createSubscription(tx=null, hospitalId, doctorCount, billingCycle, paymentMethod=null, paymentDetails="Trail") {
    if (doctorCount < LIMITS.MIN_DOCTORS || doctorCount > LIMITS.MAX_DOCTORS) {
      throw new Error(`Doctor count must be between ${LIMITS.MIN_DOCTORS} and ${LIMITS.MAX_DOCTORS}`);
    }
  
    if (!Object.values(BILLING_CYCLE).includes(billingCycle)) {
      throw new Error('Invalid billing cycle');
    }
  
    const startDate = new Date();
    const endDate = new Date();
    if (billingCycle === BILLING_CYCLE.MONTHLY) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }
  
    const totalPrice = await this.calculatePrice(doctorCount, billingCycle);
    const run = async (db) => {
      // Check if active subscription exists
      const existingSubscription = await db.hospitalSubscription.findFirst({
        where: { 
          hospitalId,
          status: SUBSCRIPTION_STATUS.ACTIVE
        }
      });

      if (existingSubscription) {
        throw new Error('Active subscription already exists');
      }

      const subscription = await db.hospitalSubscription.create({
        data: {
          doctorCount,
          billingCycle,
          startDate,
          endDate,
          totalPrice,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          paymentStatus: PAYMENT_STATUS.PENDING,
          autoRenew: true,
          hospital: {
            connect: {
              id: hospitalId
            }
          },
          history: {
            create: {
              doctorCount,
              billingCycle,
              totalPrice,
              startDate,
              endDate,
              paymentMethod,
              paymentDetails,
              paymentStatus: PAYMENT_STATUS.PENDING,
              hospital: {
                connect: {
                  id: hospitalId
                }
              }
            }
          }
        },
        include: {
          history: true,
          hospital: true
        }
      });
  
      if (!subscription.hospital) {
        throw new Error('Hospital not found');
      }
  
      return [subscription, subscription.hospital];
    };
  
    const [subscription, hospital] = tx ? await run(tx) : await prisma.$transaction(run);
  
    await this.invalidateSubscriptionCache(hospitalId);
    
    try {
      await this.sendSubscriptionEmail(subscription, 'Created', hospital);
      console.info('Subscription creation email sent successfully', {
        hospitalId,
        subscriptionId: subscription.id,
        adminEmail: hospital.adminEmail,
        timestamp: new Date().toISOString()
      });
    } catch (emailError) {
      console.error('Failed to send subscription creation email', {
        hospitalId,
        subscriptionId: subscription.id,
        adminEmail: hospital.adminEmail,
        error: emailError.message,
        stack: emailError.stack,
        timestamp: new Date().toISOString()
      });
    }
  
    return subscription;
  }

async createRenewSubscription(hospitalId, billingCycle, updatedDoctorsCount = null, paymentMethod = null, paymentDetails = null) {
  const razorpay = getRazorpayInstance();
  const lockKey = `renewal_lock:${hospitalId}`;
  
  // Input validation
  this.validateInputs(hospitalId, billingCycle, updatedDoctorsCount);
  
  // Implement Redis-based distributed lock to prevent race conditions
  const lockAcquired = await this.acquireLock(lockKey, 30);
  
  if (!lockAcquired) {
    throw new Error('Another renewal request is currently being processed. Please try again in a moment.');
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Use SELECT FOR UPDATE to prevent concurrent modifications
      const currentSub = await tx.hospitalSubscription.findFirst({
        where: { hospitalId },
        // Add FOR UPDATE for proper locking
        // Note: Prisma doesn't support FOR UPDATE directly, consider raw query if needed
      });

      if (!currentSub) {
        throw new Error('No subscription found for this hospital');
      }

      const doctorCount = updatedDoctorsCount || currentSub.doctorCount;
      
      // Validate doctor count early
      if (doctorCount < LIMITS.MIN_DOCTORS || doctorCount > LIMITS.MAX_DOCTORS) {
        throw new Error(`Doctor count must be between ${LIMITS.MIN_DOCTORS} and ${LIMITS.MAX_DOCTORS}`);
      }

      // Check current doctor count constraint
      const currentNumberOfListedDoctors = await this.getCurrentDoctorCount(hospitalId);
      if (doctorCount < currentNumberOfListedDoctors) {
        throw new Error(`Updated doctor count cannot be less than current doctor count (${currentNumberOfListedDoctors})`);
      }

      // Check for existing pending renewals and handle Redis cache
      const existingOrder = await this.handleExistingRenewal(
        tx, 
        hospitalId, 
        currentSub.id, 
        doctorCount, 
        billingCycle, 
        razorpay
      );
      
      if (existingOrder) {
        return existingOrder;
      }

      // Calculate pricing and dates
      const { startDate, endDate, totalPrice, amountInPaise } = await this.calculateRenewalDetails(
        doctorCount, 
        billingCycle,
        currentSub
      );

      // Create Razorpay order
      const razorpayOrder = await this.createRazorpayOrderWithRetry(
        razorpay,
        hospitalId,
        amountInPaise,
        { doctorCount, billingCycle, totalPrice, startDate, endDate, paymentMethod, paymentDetails }
      );

      // Create subscription history record
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: currentSub.id,
          hospitalId,
          razorpayOrderId: razorpayOrder.id,
          doctorCount,
          billingCycle,
          totalPrice,
          paymentStatus: PAYMENT_STATUS.PENDING,
          startDate,
          endDate,
          paymentMethod,
          paymentDetails: {
            ...paymentDetails,
            snapshotDoctorCount: currentNumberOfListedDoctors,
            lockTimestamp: new Date().toISOString()
          },
          createdAt: new Date()
        }
      });

      // Cache the order in Redis (non-blocking)
      this.cacheRazorpayOrder(hospitalId, billingCycle, doctorCount, razorpayOrder);

      return razorpayOrder;
    }, {
      timeout: 60000
    });
  } finally {
    await this.releaseLock(lockKey);
  }
}

// Helper method for input validation
validateInputs(hospitalId, billingCycle, updatedDoctorsCount) {
  if (!hospitalId || typeof hospitalId !== 'string') {
    throw new Error('Invalid hospital ID provided');
  }
  
  if (!Object.values(BILLING_CYCLE).includes(billingCycle)) {
    throw new Error('Invalid billing cycle provided');
  }
  
  if (updatedDoctorsCount !== null && (!Number.isInteger(updatedDoctorsCount) || updatedDoctorsCount <= 0)) {
    throw new Error('Doctor count must be a positive integer');
  }
}

// Helper method to get current doctor count
async getCurrentDoctorCount(hospitalId) {
  try {
    const doctorService = require('../doctor/doctor.service');
    const currentListedDoctors = await doctorService.listDoctors(hospitalId);
    return currentListedDoctors.length;
  } catch (error) {
    console.error('Failed to get current doctor count:', { hospitalId, error: error.message });
    throw new Error('Unable to verify current doctor count');
  }
}

// Helper method to handle existing renewals and Redis cache
async handleExistingRenewal(tx, hospitalId, subscriptionId, doctorCount, billingCycle, razorpay) {
  const redisKey = `razorpay_order:${hospitalId}:${billingCycle}:${doctorCount}`;
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

  // Check for pending renewals
  const pendingRenewal = await tx.subscriptionHistory.findFirst({
    where: {
      hospitalId,
      subscriptionId,
      paymentStatus: PAYMENT_STATUS.PENDING,
      doctorCount,
      billingCycle,
      createdAt: { gte: thirtyMinutesAgo }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!pendingRenewal) {
    return null;
  }

  // Try to get existing order from Redis
  try {
    const cachedOrder = await redisService.getCache(redisKey);
    if (cachedOrder) {
      // Validate order with Razorpay
      const isValidOrder = await this.validateRazorpayOrder(razorpay, cachedOrder.id);
      if (isValidOrder) {
        console.info('Returning existing valid Razorpay order from cache:', {
          hospitalId,
          orderId: cachedOrder.id,
          timestamp: new Date().toISOString()
        });
        return cachedOrder;
      }
      // Remove invalid cached order
      await redisService.deleteCache(redisKey);
    }
  } catch (error) {
    console.warn('Redis cache operation failed:', { hospitalId, error: error.message });
  }

  // Check if pending renewal is recent
  const pendingRenewalAge = Date.now() - pendingRenewal.createdAt.getTime();
  if (pendingRenewalAge < 30 * 60 * 1000) {
    monitoringService.recordError('DUPLICATE_ATTEMPT', {
      hospitalId,
      subscriptionId,
      operation: 'createRenewSubscription'
    });
    throw new Error('A pending renewal already exists for this subscription');
  }

  // Clean up old pending renewal
  await tx.subscriptionHistory.update({
    where: { id: pendingRenewal.id },
    data: { 
      paymentStatus: PAYMENT_STATUS.EXPIRED,
      updatedAt: new Date()
    }
  });

  return null;
}

// Helper method to validate Razorpay order
async validateRazorpayOrder(razorpay, orderId) {
  try {
    const order = await razorpay.orders.fetch(orderId);
    return order && order.status !== 'paid';
  } catch (error) {
    console.warn('Failed to validate Razorpay order:', { orderId, error: error.message });
    return false;
  }
}

// Helper method to calculate renewal details
// Helper method to calculate renewal details
async calculateRenewalDetails(doctorCount, billingCycle, currentSub) {
  const startDate = new Date();
  const endDate = new Date(startDate);
  
  if (billingCycle === BILLING_CYCLE.MONTHLY) {
    endDate.setMonth(endDate.getMonth() + 1);
  } else {
    endDate.setFullYear(endDate.getFullYear() + 1);
  }

  // Calculate the full price for the new subscription period
  const totalPrice = await this.calculatePrice(doctorCount, billingCycle);
  
  // Get any remaining amount from the current subscription
  const remaining = await this.calculateRemainingAmount(currentSub);
  const remainingPrice = remaining ? remaining.remainingAmount : 0;
  
  // Store the original price before adjusting for remaining credit
  let finalPrice = totalPrice;
  let priceBeforePlatformCharges = totalPrice;
  
  // Adjust final price by subtracting any remaining amount from the current subscription
  if (remainingPrice > 0) {
    // Even if remainingPrice fully covers the totalPrice, we'll still need to process platform charges
    priceBeforePlatformCharges = Math.max(0, totalPrice - remainingPrice);
  }

  // Calculate Razorpay charges on original amount
  // Platform fee is 2% + GST (18% on platform fee)
  const platformFeePercentage = 2;
  const gstPercentage = 18;
  
  // Calculate platform charges based on the original amount before credit
  const platformFee = (totalPrice * platformFeePercentage) / 100;
  const gstOnPlatformFee = (platformFee * gstPercentage) / 100;
  const totalPlatformCharges = platformFee + gstOnPlatformFee;

  // Add platform charges to adjusted price
  const finalPriceWithCharges = Math.max(1, priceBeforePlatformCharges + totalPlatformCharges);

  // Convert to paise (Indian currency smallest unit) for Razorpay
  // Ensure minimum amount is 100 paise (₹1) as Razorpay doesn't accept 0
  const amountInPaise = Math.round(finalPriceWithCharges * 100);

  return { 
    startDate, 
    endDate, 
    totalPrice: totalPrice, // Original price before any adjustments
    priceAfterCredit: priceBeforePlatformCharges,
    platformFee,
    gstOnPlatformFee,
    totalPlatformCharges,
    finalPriceWithCharges,
    amountInPaise,
    remainingCredit: remainingPrice,
    breakdown: {
      originalPrice: totalPrice,
      creditApplied: remainingPrice,
      priceAfterCredit: priceBeforePlatformCharges,
      platformCharges: totalPlatformCharges,
      finalAmount: finalPriceWithCharges
    }
  };
}

// Helper method to create Razorpay order with retry logic
async createRazorpayOrderWithRetry(razorpay, hospitalId, amountInPaise, logData, maxRetries = 2) {
  console.log('Creating Razorpay order for renewal:', {
    hospitalId,
    ...logData,
    timestamp: new Date().toISOString()
  });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const order = await this.createSingleRazorpayOrder(razorpay, hospitalId, amountInPaise);
      
      console.info('Razorpay order created successfully:', {
        hospitalId,
        orderId: order.id,
        amount: order.amount,
        attempt,
        timestamp: new Date().toISOString()
      });

      return order;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      
      console.error(`Razorpay order creation attempt ${attempt} failed:`, {
        hospitalId,
        error: error.message,
        isLastAttempt,
        timestamp: new Date().toISOString()
      });

      if (isLastAttempt) {
        this.handleRazorpayError(error, hospitalId);
        throw error;
      }

      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}

// Helper method to create single Razorpay order
async createSingleRazorpayOrder(razorpay, hospitalId, amountInPaise) {
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Razorpay API timeout')), 45000)
  );

  const receipt = this.generateUniqueReceipt(hospitalId);

  const orderPromise = razorpay.orders.create({
    amount: amountInPaise,
    currency: "INR",
    receipt,
    payment_capture: 1
  });

  const order = await Promise.race([orderPromise, timeoutPromise]);

  if (!order || !order.id) {
    throw new Error('Invalid order response from Razorpay');
  }

  return order;
}

// Helper method to generate unique receipt
generateUniqueReceipt(hospitalId) {
  const shortId = hospitalId.split('-')[0] || hospitalId.substring(0, 8);
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `rcpt_${shortId}_${timestamp}_${random}`.substring(0, 40); // Ensure under 40 chars
}

// Helper method to handle Razorpay errors
handleRazorpayError(error, hospitalId) {
  const errorMessage = error?.error?.description || error?.message || 'Unknown Razorpay error';
  
  if (error.message === 'Razorpay API timeout') {
    monitoringService.recordError('TIMEOUT', {
      hospitalId,
      operation: 'createRenewSubscription',
      service: 'razorpay'
    });
  } else if (errorMessage.toLowerCase().includes('invalid')) {
    monitoringService.recordError('VALIDATION_ERROR', {
      hospitalId,
      operation: 'createRenewSubscription',
      service: 'razorpay',
      error: errorMessage
    });
  } else {
    monitoringService.recordError('RAZORPAY_API_ERROR', {
      hospitalId,
      operation: 'createRenewSubscription',
      service: 'razorpay',
      error: errorMessage
    });
  }
}

// Helper method to cache Razorpay order (non-blocking)
async cacheRazorpayOrder(hospitalId, billingCycle, doctorCount, razorpayOrder) {
  const redisKey = `razorpay_order:${hospitalId}:${billingCycle}:${doctorCount}`;
  
  try {
    await redisService.setCache(redisKey, razorpayOrder, 2700); // 45 minutes TTL or let say 44 minutes to avoid overlapping 
    console.info('Razorpay order cached successfully:', {
      hospitalId,
      orderId: razorpayOrder.id,
      redisKey,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to cache Razorpay order:', {
      hospitalId,
      orderId: razorpayOrder.id,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    // Don't throw - caching failure shouldn't break the flow
  }
}

async verifyAndUpdateSubscription(hospital, hospitalId, razorpayOrderId, razorpayPaymentId, razorpaySignature) {
  try {
    console.info('Starting payment verification process', {
      hospitalId,
      razorpayOrderId,
      timestamp: new Date().toISOString()
    });

    // Input validation
    this._validateVerificationInputs({
      hospital,
      hospitalId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    });

    const razorpay = getRazorpayInstance();
    const lockKey = `verification_lock:${razorpayOrderId}`;
    
    // Acquire distributed lock
    const lockAcquired = await this._acquireVerificationLock(lockKey);
    if (!lockAcquired) {
      throw new Error('Payment verification is already in progress');
    }

    try {
      
      return await prisma.$transaction(async (tx) => {
        // Check for duplicate processing
        await this._checkDuplicatePayment(tx, razorpayOrderId, hospitalId);
        
        // Verify signature
        this._verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        
        // Fetch payment details with retry logic
        const paymentDetails = await this._fetchPaymentDetailsWithRetry(
          razorpay, 
          razorpayPaymentId, 
          { hospitalId, razorpayOrderId }
        );
        
        // Validate payment
        this._validatePaymentDetails(paymentDetails, { hospitalId, razorpayOrderId, razorpayPaymentId });
        
        // Find subscription and history
        const { currentSub, subscriptionHistory } = await this._findSubscriptionData(
          tx, 
          hospitalId, 
          razorpayOrderId
        );
        
        // Verify payment amount
        this._verifyPaymentAmount(paymentDetails, subscriptionHistory, { hospitalId, razorpayOrderId });
        
        // Update database records
        const updatedSubscription = await this._updateSubscriptionRecords(
          tx,
          currentSub,
          hospitalId,
          subscriptionHistory,
          paymentDetails
        );
        
        // Post-processing (non-blocking operations)
        this._performPostProcessing(updatedSubscription, hospital, hospitalId);
        
        console.info('Payment verification completed successfully', {
          hospitalId,
          subscriptionId: updatedSubscription.id,
          razorpayOrderId,
          timestamp: new Date().toISOString()
        });

        return {
          success: true,
          message: 'Payment verified and subscription updated successfully',
          subscription: {
            id: updatedSubscription.id,
            doctorCount: updatedSubscription.doctorCount,
            billingCycle: updatedSubscription.billingCycle,
            status: updatedSubscription.status,
            endDate: updatedSubscription.endDate,
            totalPrice: updatedSubscription.totalPrice
          }
        };
        
      }, {
        timeout: 90000 // 90 second transaction timeout
      });
      
    } finally {
      await this._releaseVerificationLock(lockKey);
    }
    
  } catch (error) {
    console.error('Payment verification failed', {
      hospitalId,
      razorpayOrderId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    this._recordVerificationError(error, {
      hospitalId,
      razorpayOrderId,
      razorpayPaymentId,
      operation: 'verifyAndUpdateSubscription'
    });
    
    throw error;
  }
}

// Helper Methods

_validateVerificationInputs({ hospital, hospitalId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const validationErrors = [];
  
  if (!hospital || typeof hospital !== 'object') {
    validationErrors.push('Invalid hospital object');
  }
  
  if (!hospitalId || typeof hospitalId !== 'string') {
    validationErrors.push('Invalid hospitalId');
  }
  
  if (!razorpayOrderId || typeof razorpayOrderId !== 'string' || !razorpayOrderId.startsWith('order_')) {
    validationErrors.push('Invalid Razorpay order ID format');
  }
  
  if (!razorpayPaymentId || typeof razorpayPaymentId !== 'string' || !razorpayPaymentId.startsWith('pay_')) {
    validationErrors.push('Invalid Razorpay payment ID format');
  }
  
  if (!razorpaySignature || typeof razorpaySignature !== 'string' || razorpaySignature.length !== 64) {
    validationErrors.push('Invalid signature format');
  }
  
  if (validationErrors.length > 0) {
    throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
  }
}

async _acquireVerificationLock(lockKey) {
  try {
    return await this.acquireLock(lockKey, 60);
  } catch (error) {
    console.warn('Failed to acquire verification lock', {
      lockKey,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    return false;
  }
}

async _releaseVerificationLock(lockKey) {
  try {
    await this.releaseLock(lockKey);
  } catch (error) {
    console.error('Failed to release verification lock', {
      lockKey,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async _checkDuplicatePayment(tx, razorpayOrderId, hospitalId) {
  const existingPayment = await tx.subscriptionHistory.findFirst({
    where: {
      razorpayOrderId,
      paymentStatus: PAYMENT_STATUS.SUCCESS
    },
    select: {
      id: true,
      createdAt: true,
      hospitalId: true
    }
  });

  if (existingPayment) {
    console.warn('Duplicate payment verification attempt detected', {
      hospitalId,
      razorpayOrderId,
      existingPaymentId: existingPayment.id,
      existingPaymentDate: existingPayment.createdAt,
      timestamp: new Date().toISOString()
    });
    
    monitoringService.recordError('DUPLICATE_VERIFICATION', {
      hospitalId,
      razorpayOrderId,
      operation: 'verifyAndUpdateSubscription'
    });
    
    throw new Error('Payment has already been processed successfully');
  }
}

_verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
  try {
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(razorpaySignature))) {
      throw new Error('Payment signature verification failed');
    }
    
    console.debug('Payment signature verified successfully', {
      razorpayOrderId,
      razorpayPaymentId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Signature verification failed', {
      razorpayOrderId,
      razorpayPaymentId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    monitoringService.recordError('SIGNATURE_MISMATCH', {
      razorpayOrderId,
      razorpayPaymentId,
      operation: 'verifyAndUpdateSubscription'
    });
    
    throw new Error('Payment signature verification failed - potential security breach');
  }
}

async _fetchPaymentDetailsWithRetry(razorpay, razorpayPaymentId, context, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.debug(`Fetching payment details (attempt ${attempt}/${maxRetries})`, {
        ...context,
        razorpayPaymentId,
        timestamp: new Date().toISOString()
      });
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Razorpay API timeout')), 30000)
      );
      
      const fetchPromise = razorpay.payments.fetch(razorpayPaymentId);
      
      const paymentDetails = await Promise.race([fetchPromise, timeoutPromise]);
      
      console.info('Payment details fetched successfully', {
        ...context,
        razorpayPaymentId,
        paymentStatus: paymentDetails.status,
        amount: paymentDetails.amount,
        attempt,
        timestamp: new Date().toISOString()
      });
      
      return paymentDetails;
      
    } catch (error) {
      lastError = error;
      const isTimeout = error.message === 'Razorpay API timeout';
      const isRetryable = isTimeout || error.statusCode >= 500;
      
      console.warn(`Payment details fetch failed (attempt ${attempt}/${maxRetries})`, {
        ...context,
        razorpayPaymentId,
        error: error.message,
        isTimeout,
        isRetryable,
        timestamp: new Date().toISOString()
      });
      
      if (attempt === maxRetries || !isRetryable) {
        break;
      }
      
      // Exponential backoff with jitter
      const delay = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 1000, 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  console.error('Failed to fetch payment details after all retries', {
    ...context,
    razorpayPaymentId,
    maxRetries,
    finalError: lastError.message,
    timestamp: new Date().toISOString()
  });
  
  monitoringService.recordError('PAYMENT_FETCH_FAILED', {
    ...context,
    razorpayPaymentId,
    operation: 'verifyAndUpdateSubscription',
    service: 'razorpay',
    retries: maxRetries
  });
  
  throw new Error(`Unable to fetch payment details from Razorpay: ${lastError.message}`);
}

_validatePaymentDetails(paymentDetails, context) {
  if (!paymentDetails) {
    throw new Error('No payment details received from Razorpay');
  }
  
  if (paymentDetails.status !== 'captured') {
    console.error('Payment verification failed - invalid status', {
      ...context,
      paymentStatus: paymentDetails.status,
      paymentId: paymentDetails.id,
      timestamp: new Date().toISOString()
    });
    
    monitoringService.recordError('PAYMENT_NOT_CAPTURED', {
      ...context,
      paymentStatus: paymentDetails.status,
      paymentMethod: paymentDetails.method
    });
    
    throw new Error(`Payment verification failed: status is '${paymentDetails.status}', expected 'captured'`);
  }
  
  console.debug('Payment details validation passed', {
    ...context,
    paymentStatus: paymentDetails.status,
    paymentMethod: paymentDetails.method,
    timestamp: new Date().toISOString()
  });
}

async _findSubscriptionData(tx, hospitalId, razorpayOrderId) {
  const currentSub = await tx.hospitalSubscription.findFirst({
    where: { hospitalId },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      doctorCount: true,
      billingCycle: true,
      totalPrice: true
    }
    
  });

  if (!currentSub) {
    console.error('No subscription found during payment verification', {
      hospitalId,
      razorpayOrderId,
      timestamp: new Date().toISOString()
    });
    throw new Error('No active subscription found for this hospital');
  }

  const subscriptionHistory = await tx.subscriptionHistory.findFirst({
    where: {
      hospitalId,
      subscriptionId: currentSub.id,
      razorpayOrderId,
      paymentStatus: PAYMENT_STATUS.PENDING,
    },
    select: {
      id: true,
      totalPrice: true,
      doctorCount: true,
      billingCycle: true,
      startDate: true,
      endDate: true
    }
  });

  if (!subscriptionHistory) {
    console.error('No matching pending subscription history found', {
      hospitalId,
      subscriptionId: currentSub.id,
      razorpayOrderId,
      timestamp: new Date().toISOString()
    });
    throw new Error('No pending subscription renewal found for this payment');
  }

  return { currentSub, subscriptionHistory };
}

_verifyPaymentAmount(paymentDetails, subscriptionHistory, context) {
  // Convert to strings and compare to avoid floating point precision issues
  const expectedAmountInPaise = (subscriptionHistory.totalPrice * 100).toFixed(0);
  const receivedAmount = paymentDetails.amount.toFixed(0);
  
  if (receivedAmount !== expectedAmountInPaise) {
    console.error('Payment amount mismatch detected', {
      ...context,
      expectedAmount: expectedAmountInPaise,
      receivedAmount,
      expectedAmountINR: subscriptionHistory.totalPrice,
      receivedAmountINR: receivedAmount / 100,
      timestamp: new Date().toISOString()
    });
    
    monitoringService.recordError('AMOUNT_MISMATCH', {
      ...context,
      expectedAmount: expectedAmountInPaise,
      receivedAmount,
      difference: Math.abs(receivedAmount - expectedAmountInPaise)
    });
    
    throw new Error(`Payment amount mismatch: expected ₹${subscriptionHistory.totalPrice}, received ₹${receivedAmount / 100}`);
  }
  
  console.debug('Payment amount verification passed', {
    ...context,
    amount: expectedAmountInPaise,
    amountINR: subscriptionHistory.totalPrice,
    timestamp: new Date().toISOString()
  });
}

async _updateSubscriptionRecords(tx, currentSub,hospitalId, subscriptionHistory, paymentDetails) {
  if (!hospitalId) {
    throw new Error('Hospital ID is required for subscription update');
  }

  // Update subscription history with all required fields preserved
  await tx.subscriptionHistory.update({
    where: { id: subscriptionHistory.id },
    data: {
      paymentStatus: PAYMENT_STATUS.SUCCESS,
      paymentDetails: paymentDetails,  // Keep as raw object, Prisma will handle serialization
      paymentMethod: 'RAZORPAY',
      subscription: {
        connect: { id: currentSub.id }
      }
    }
  });

  // Determine start date logic
  const startDate = currentSub.status !== SUBSCRIPTION_STATUS.ACTIVE 
    ? new Date(subscriptionHistory.startDate)
    : new Date(currentSub.startDate);

  // Update main subscription
  const updatedSubscription = await tx.hospitalSubscription.update({
    where: { id: currentSub.id },
    data: {
      status: SUBSCRIPTION_STATUS.ACTIVE,
      doctorCount: subscriptionHistory.doctorCount,
      billingCycle: subscriptionHistory.billingCycle,
      paymentStatus: PAYMENT_STATUS.SUCCESS,
      totalPrice: subscriptionHistory.totalPrice,
      startDate,
      endDate: new Date(subscriptionHistory.endDate),
      updatedAt: new Date()
    },
  });

  console.info('Subscription records updated successfully', {
    subscriptionId: updatedSubscription.id,
    historyId: subscriptionHistory.id,
    doctorCount: updatedSubscription.doctorCount,
    totalPrice: updatedSubscription.totalPrice,
    endDate: updatedSubscription.endDate,
    timestamp: new Date().toISOString()
  });

  return updatedSubscription;
}

async _performPostProcessing(updatedSubscription, hospital, hospitalId) {
  // Clear cache (non-blocking)
  this._invalidateSubscriptionCache(hospitalId);
  
  // Send email notification (non-blocking)
  this._sendSubscriptionEmail(updatedSubscription, hospital);
  
  // Record success metrics
  monitoringService.recordSuccess('PAYMENT_VERIFIED', {
    hospitalId,
    subscriptionId: updatedSubscription.id,
    doctorCount: updatedSubscription.doctorCount,
    totalPrice: updatedSubscription.totalPrice
  });
}

async _invalidateSubscriptionCache(hospitalId) {
  try {
    await this.invalidateSubscriptionCache(hospitalId);
    console.debug('Subscription cache invalidated', {
      hospitalId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn('Failed to invalidate subscription cache', {
      hospitalId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async _sendSubscriptionEmail(updatedSubscription, hospital) {
  try {
    await this.sendSubscriptionEmail(updatedSubscription, 'Renewed', hospital);
    console.info('Subscription renewal email sent successfully', {
      hospitalId: hospital.id,
      subscriptionId: updatedSubscription.id,
      adminEmail: hospital.adminEmail,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to send subscription renewal email', {
      hospitalId: hospital.id,
      subscriptionId: updatedSubscription.id,
      adminEmail: hospital.adminEmail,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    // Could implement retry queue here
    monitoringService.recordError('EMAIL_SEND_FAILED', {
      hospitalId: hospital.id,
      subscriptionId: updatedSubscription.id,
      operation: 'subscription_renewal_notification'
    });
  }
}

_recordVerificationError(error, context) {
  const errorType = this._categorizeVerificationError(error);
  
  monitoringService.recordError(errorType, {
    ...context,
    errorMessage: error.message,
    errorStack: error.stack
  });
}

_categorizeVerificationError(error) {
  if (error.message.includes('timeout')) return 'TIMEOUT';
  if (error.message.includes('signature')) return 'SIGNATURE_MISMATCH';
  if (error.message.includes('amount mismatch')) return 'AMOUNT_MISMATCH';
  if (error.message.includes('already processed')) return 'DUPLICATE_VERIFICATION';
  if (error.message.includes('not captured')) return 'PAYMENT_NOT_CAPTURED';
  if (error.message.includes('No active subscription')) return 'SUBSCRIPTION_NOT_FOUND';
  if (error.message.includes('Validation failed')) return 'INVALID_INPUT';
  return 'UNKNOWN';
}
  async cancelSubscription(hospitalId) {
    return await prisma.$transaction(async (tx) => {
      const subscription = await tx.hospitalSubscription.findFirst({
        where: { 
          hospitalId,
          status: SUBSCRIPTION_STATUS.ACTIVE 
        }
      });

      if (!subscription) {
        throw new Error('No active subscription found');
      }

      // Update subscription status within transaction
      const updatedSubscription = await tx.hospitalSubscription.update({
        where: { id: subscription.id },
        data: { status: SUBSCRIPTION_STATUS.CANCELLED }
      });
    
      // Create cancellation history entry within same transaction
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          hospitalId,
          doctorCount: subscription.doctorCount,
          billingCycle: subscription.billingCycle,
          totalPrice: subscription.totalPrice,
          startDate: subscription.startDate,
          endDate: new Date(),
          status: SUBSCRIPTION_STATUS.CANCELLED,
          createdAt: new Date()
        }
      });

      // Cache invalidation should happen after successful transaction
      await this.invalidateSubscriptionCache(hospitalId);

      return updatedSubscription;
    });
  }

  async getSubscriptionHistory(hospitalId) {
    return await prisma.subscriptionHistory.findMany({
      where: { hospitalId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async updateSubscriptionStatus(subscription, newStatus) {
    // Validate the status transition
    const validTransitions = {
      [SUBSCRIPTION_STATUS.ACTIVE]: [SUBSCRIPTION_STATUS.CANCELLED, SUBSCRIPTION_STATUS.EXPIRED],
      [SUBSCRIPTION_STATUS.PENDING]: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.CANCELLED],
      [SUBSCRIPTION_STATUS.CANCELLED]: [SUBSCRIPTION_STATUS.ACTIVE],
      [SUBSCRIPTION_STATUS.EXPIRED]: [SUBSCRIPTION_STATUS.ACTIVE]
    };

    if (!validTransitions[subscription.status]?.includes(newStatus)) {
      throw new Error(`Invalid status transition from ${subscription.status} to ${newStatus}`);
    }

    return await prisma.$transaction(async (tx) => {
      // Update subscription status
      const updatedSubscription = await tx.hospitalSubscription.update({
        where: { id: subscription.id },
        data: { 
          status: newStatus,
          updatedAt: new Date()
        }
      });

      // Create audit trail
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          hospitalId: subscription.hospitalId,
          doctorCount: subscription.doctorCount,
          billingCycle: subscription.billingCycle,
          totalPrice: subscription.totalPrice,
          startDate: subscription.startDate,
          endDate: new Date(),
          status: newStatus,
          paymentStatus: subscription.paymentStatus,
          paymentMethod: subscription.paymentMethod,
          paymentDetails: {
            previousStatus: subscription.status,
            newStatus: newStatus,
            reason: 'Status update',
            timestamp: new Date().toISOString()
          },
          createdAt: new Date()
        }
      });

      // Invalidate cache after successful transaction
      await this.invalidateSubscriptionCache(subscription.hospitalId);

      return updatedSubscription;
    });
  }

  async calculateRemainingAmount(subscription) {
    if (!subscription) {
      throw new Error('Subscription is required');
    }

    const currentDate = new Date();
    const startDate = new Date(subscription.startDate);
    const endDate = new Date(subscription.endDate);

    // Validate dates
    if(subscription.paymentStatus !== PAYMENT_STATUS.SUCCESS) {
      return 0;
    }

    if (currentDate < startDate) {
      return subscription.totalPrice; // Full amount remaining if subscription hasn't started
    }

    if (currentDate >= endDate) {
      return 0; // No amount remaining if subscription has ended
    }

    // Calculate total subscription duration in days
    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    
    // Calculate remaining days
    const remainingDays = Math.ceil((endDate - currentDate) / (1000 * 60 * 60 * 24));
    
    // Calculate daily rate
    const dailyRate = subscription.totalPrice / totalDays;
    
    // Calculate remaining amount
    const remainingAmount = Math.round((dailyRate * remainingDays) * 100) / 100;

    const data={
      remainingAmount,
      totalDays,
      remainingDays,
      dailyRate,
      subscriptionDetails: {
        doctorCount: subscription.doctorCount,
        billingCycle: subscription.billingCycle,
        totalPrice: subscription.totalPrice,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      },
      usageMetrics: {
        percentageUsed: Math.round(((totalDays - remainingDays) / totalDays) * 100),
        percentageRemaining: Math.round((remainingDays / totalDays) * 100),
        daysUsed: totalDays - remainingDays
      }
    };
    return data;
  }
}

module.exports = new SubscriptionService();
