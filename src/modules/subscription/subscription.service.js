const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const messageService = require('../notification/message.service');
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


  async calculatePrice(doctorCount, billingCycle) {
    let price = doctorCount * PRICING.BASE_PRICE_PER_DOCTOR;
    
    // Apply volume discounts
    for (const tier of PRICING.VOLUME_DISCOUNTS) {
      if (doctorCount >= tier.minDoctors) {
        price = price * (1 - tier.discount / 100);
        break;
      }
    }

    // Apply yearly discount if applicable
    if (billingCycle === BILLING_CYCLE.YEARLY) {
      price = price * 12 * (1 - PRICING.YEARLY_DISCOUNT_PERCENTAGE / 100);
    }

    return Math.round(price * 100) / 100; // Round to 2 decimal places
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
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563EB;">Subscription ${emailType}</h2>
          <p>Dear ${hospital.name} Administrator,</p>
          
          <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
            <p><strong>Subscription Details:</strong></p>
            <ul>
              <li>Doctors Allowed: ${subscription.doctorCount}</li>
              <li>Billing Cycle: ${subscription.billingCycle}</li>
              <li>Total Price: ${formatCurrency(subscription.totalPrice)}</li>
              <li>Valid Until: ${formatDate(subscription.endDate)}</li>
              <li>Payment Method: ${subscription.paymentMethod}</li>
            </ul>
          </div>`;

      switch (emailType) {
        case 'Created':
          return baseContent + `
            <p>Your subscription has been successfully created. Welcome aboard!</p>
            <p>Your subscription is now active and you can start adding doctors to your hospital.</p>`;
        
        case 'Updated':
          return baseContent + `
            <p>Your subscription has been successfully updated with the new doctor count.</p>
            <p>The changes are effective immediately.</p>`;
        
        case 'Renewed':
          return baseContent + `
            <p>Your subscription has been successfully renewed.</p>
            <p>Thank you for continuing to trust us with your hospital management needs.</p>`;
        
        default:
          return baseContent;
      }
    };

    const emailContent = getEmailContent() + `
          <div style="margin-top: 20px;">
            <p>If you have any questions, please don't hesitate to contact our support team.</p>
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
  
    await redisService.invalidateCache(CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId);
    
    try {
      await this.sendSubscriptionEmail(subscription, 'Created', hospital);
    } catch (error) {
      console.error('Failed to send subscription email:', error);
    }
  
    return subscription;
  }

  async createRenewSubscription(hospitalId, billingCycle, updatedDoctorsCount = null, paymentMethod=null, paymentDetails=null) {
    const razorpay = getRazorpayInstance();
  
    // transaction to ensure ACID properties
    return await prisma.$transaction(async (tx) => {
  
      const currentSub = await tx.hospitalSubscription.findFirst({
        where: { 
          hospitalId
        }
      });
  
      if (!currentSub) {
        throw new Error('No subscription found for this hospital');
      }
  
      // if there's already a pending renewal
      const pendingRenewal = await tx.subscriptionHistory.findFirst({
        where: {
          hospitalId,
          subscriptionId: currentSub.id,
          paymentStatus: PAYMENT_STATUS.PENDING
        }
      });
  
      if (pendingRenewal) {
        throw new Error('A pending renewal already exists for this subscription');
      }
  
      const doctorCount = updatedDoctorsCount || currentSub.doctorCount;
  
      if (doctorCount < LIMITS.MIN_DOCTORS || doctorCount > LIMITS.MAX_DOCTORS) {
        throw new Error(`Doctor count must be between ${LIMITS.MIN_DOCTORS} and ${LIMITS.MAX_DOCTORS}`);
      }
      
      // Dynamically require doctorService to avoid circular dependency
      const doctorService = require('../doctor/doctor.service');
      const currentListedDoctors = await doctorService.listDoctors(hospitalId);
      const currentNumberOfListedDoctors = currentListedDoctors.length;
  
      if (doctorCount < currentNumberOfListedDoctors) {
        throw new Error(`Updated doctor count cannot be less than current doctor count (${currentNumberOfListedDoctors})`);
      }
  
      const startDate = new Date();
      const endDate = new Date();
      if (billingCycle === BILLING_CYCLE.MONTHLY) {
        endDate.setMonth(endDate.getMonth() + 1);
      } else {
        endDate.setFullYear(endDate.getFullYear() + 1);
      }
  
      const totalPrice = await this.calculatePrice(doctorCount, billingCycle);
      const amountInPaise = Math.round(totalPrice * 100);
  
      // Set timeout for Razorpay API call
      const razorpayPromise = new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Razorpay API timeout')), 30000);
        try {
          const order = await razorpay.orders.create({
            amount: amountInPaise,
            currency: "INR",
            receipt: `receipt_${hospitalId}_${Date.now()}`,
            payment_capture: 1
          });
          clearTimeout(timeout);
          resolve(order);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
  
      const razorpayOrder = await razorpayPromise;
  
      // Create subscription history within the transaction
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
          paymentDetails,
          createdAt: new Date()
        }
      });
  
      return razorpayOrder;
    });
  }

  async verifyAndUpdateSubscription(hospital, hospitalId, razorpayOrderId, razorpayPaymentId, razorpaySignature) {
  const razorpay = getRazorpayInstance();

  // transaction to ensure ACID properties
  return await prisma.$transaction(async (tx) => {
    // Check for duplicate payment verification
    const existingPayment = await tx.subscriptionHistory.findFirst({
      where: {
        razorpayOrderId,
        paymentStatus: PAYMENT_STATUS.SUCCESS
      }
    });

    if (existingPayment) {
      throw new Error('Payment already processed');
    }

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpayOrderId + "|" + razorpayPaymentId)
      .digest('hex');

    if (generatedSignature !== razorpaySignature) {
      throw new Error('Payment signature mismatch');
    }

    // Set timeout for Razorpay API call
    const paymentDetailsPromise = new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Razorpay API timeout')), 30000);
      try {
        const details = await razorpay.payments.fetch(razorpayPaymentId);
        clearTimeout(timeout);
        resolve(details);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });

    const paymentDetails = await paymentDetailsPromise;

    if (paymentDetails.status !== 'captured') {
      throw new Error('Payment was not successful');
    }

    const currentSub = await tx.hospitalSubscription.findFirst({
      where: {
        hospitalId,
      }
    });

    if (!currentSub) {
      throw new Error('No subscription found for this hospital');
    }

    const subscriptionHistory = await tx.subscriptionHistory.findFirst({
      where: {
        hospitalId,
        subscriptionId: currentSub.id,
        razorpayOrderId,
        paymentStatus: PAYMENT_STATUS.PENDING,
      },
    });

    if (!subscriptionHistory) {
      throw new Error('No matching subscription history found');
    }

    // Verify payment amount matches subscription amount
    const expectedAmountInPaise = Math.round(subscriptionHistory.totalPrice * 100);
    if (paymentDetails.amount !== expectedAmountInPaise) {
      throw new Error('Payment amount mismatch');
    }

    // Update subscription history
    await tx.subscriptionHistory.update({
      where: {
        id: subscriptionHistory.id,
      },
      data: {
        paymentStatus: PAYMENT_STATUS.SUCCESS,
        paymentDetails: paymentDetails,
        paymentMethod: 'RAZORPAY',
        updatedAt: new Date(),
      },
    });

    const startDate = (currentSub.status !== SUBSCRIPTION_STATUS.ACTIVE)
      ? subscriptionHistory.startDate
      : currentSub.startDate;

    // Update subscription within the same transaction
    const updatedSubscription = await tx.hospitalSubscription.update({
      where: { id: currentSub.id },
      data: {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        doctorCount: subscriptionHistory.doctorCount,
        billingCycle: subscriptionHistory.billingCycle,
        paymentStatus: PAYMENT_STATUS.SUCCESS,
        totalPrice: subscriptionHistory.totalPrice,
        startDate,
        endDate: subscriptionHistory.endDate,
      },
    });

    // Clear cache after successful update
    await redisService.invalidateCache(CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId);
    await redisService.invalidateCache(`hospital:dashboard:${hospitalId}`);

    // Send email notification
    await this.sendSubscriptionEmail(updatedSubscription, 'Renewed', hospital);

    return {
      success: true,
      message: 'Subscription renewed successfully',
    };
  });

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
      await redisService.invalidateCache(CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId);
      await redisService.invalidateCache(`hospital:dashboard:${hospitalId}`);


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
    const updatedSubscription = await prisma.hospitalSubscription.update({
      where: { id: subscription.id },
      data: { status: newStatus }
    });

    // Invalidate cache
    await redisService.invalidateCache(CACHE_KEYS.HOSPITAL_SUBSCRIPTION + subscription.hospitalId);
    await redisService.invalidateCache(`hospital:dashboard:${hospitalId}`);

    return updatedSubscription;
  }
}

module.exports = new SubscriptionService();
