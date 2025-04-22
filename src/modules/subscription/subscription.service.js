const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const messageService = require('../notification/message.service');
const { 
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE,
  PRICING,
  CACHE_KEYS,
  CACHE_EXPIRY,
  LIMITS
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

  async getHospitalSubscription(hospitalId) {
    const cacheKey = CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId;
    let subscription = await redisService.getCache(cacheKey);

    if (!subscription) {
      subscription = await prisma.hospitalSubscription.findFirst({
        where: { 
          hospitalId,
          status: SUBSCRIPTION_STATUS.ACTIVE
        }
      });

      if (subscription) {
        await redisService.setCache(cacheKey, subscription, CACHE_EXPIRY.HOSPITAL_SUBSCRIPTION);
      }
    }

    return subscription;
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

  async createSubscription(tx=null,hospitalId, doctorCount, billingCycle,paymentMethod=null, paymentDetails="Free Trail") {
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
      const subscription = await db.hospitalSubscription.create({
        data: {
          hospitalId,
          doctorCount,
          billingCycle,
          startDate,
          endDate,
          totalPrice,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          autoRenew: true,
          paymentMethod,
          paymentDetails,
        }
      });
  
      await db.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          hospitalId,
          doctorCount,
          billingCycle,
          totalPrice,
          startDate,
          endDate,
          paymentMethod,
          paymentDetails,
          createdAt: new Date()
        }
      });
  
      const hospital = await db.hospital.findUnique({
        where: { id: hospitalId }
      });
  
      return [subscription, hospital];
    };
  
    const [subscription, hospital] = tx ? await run(tx) : await prisma.$transaction(run);
  
    // Send email notification
    const messageTrackingId = await this.sendSubscriptionEmail(subscription, 'Created', hospital);
  
    return subscription;
  }

  async updateDoctorCount(hospitalId, newDoctorCount, billingCycle, paymentMethod, paymentDetails) {
    const subscription = await this.getHospitalSubscription(hospitalId);
    if (!subscription) {
      throw new Error('No active subscription found');
    }

    if (newDoctorCount < LIMITS.MIN_DOCTORS || newDoctorCount > LIMITS.MAX_DOCTORS) {
      throw new Error(`Doctor count must be between ${LIMITS.MIN_DOCTORS} and ${LIMITS.MAX_DOCTORS}`);
    }

    const totalPrice = await this.calculatePrice(newDoctorCount, billingCycle || subscription.billingCycle);
    const startDate = new Date();
    const endDate = new Date();
    
    if (billingCycle === BILLING_CYCLE.MONTHLY) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const [updatedSubscription, hospital] = await prisma.$transaction(async (tx) => {
      const updated = await tx.hospitalSubscription.update({
        where: { id: subscription.id },
        data: {
          doctorCount: newDoctorCount,
          billingCycle: billingCycle || subscription.billingCycle,
          startDate,
          endDate,
          totalPrice,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          ...(paymentMethod && { paymentMethod, paymentDetails })
        }
      });

      // Create history entry
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          hospitalId,
          doctorCount: newDoctorCount,
          billingCycle: updated.billingCycle,
          totalPrice,
          startDate,
          endDate,
          paymentMethod: paymentMethod || subscription.paymentMethod,
          paymentDetails: paymentDetails || subscription.paymentDetails,
          createdAt: new Date()
        }
      });

      const hospital = await tx.hospital.findUnique({
        where: { id: hospitalId }
      });

      return [updated, hospital];
    });

    // Send email notification
    const messageTrackingId=await this.sendSubscriptionEmail(updatedSubscription, 'Updated', hospital);

    // Invalidate cache
    await redisService.invalidateCache(CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId);

    return updatedSubscription;
  }

  async renewSubscription(hospitalId, billingCycle, paymentMethod, paymentDetails) {
    const currentSub = await this.getHospitalSubscription(hospitalId);
    if (!currentSub) {
      throw new Error('No active subscription found');
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

    const totalPrice = await this.calculatePrice(currentSub.doctorCount, billingCycle);

    const [renewedSubscription, hospital] = await prisma.$transaction(async (tx) => {
      const subscription = await tx.hospitalSubscription.update({
        where: { id: currentSub.id },
        data: {
          billingCycle,
          startDate,
          endDate,
          totalPrice,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          paymentMethod,
          paymentDetails
        }
      });

      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          hospitalId,
          doctorCount: subscription.doctorCount,
          billingCycle,
          totalPrice,
          startDate,
          endDate,
          paymentMethod,
          paymentDetails,
          createdAt: new Date()
        }
      });

      const hospital = await tx.hospital.findUnique({
        where: { id: hospitalId }
      });

      return [subscription, hospital];
    });

    // Send email notification
    const messageTrackingId=await this.sendSubscriptionEmail(renewedSubscription, 'Renewed', hospital);

    // Invalidate cache
    await redisService.invalidateCache(CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId);

    return renewedSubscription;
  }

  async cancelSubscription(hospitalId) {
    const subscription = await this.getHospitalSubscription(hospitalId);
    if (!subscription) {
      throw new Error('No active subscription found');
    }

    const updatedSubscription = await this.updateSubscriptionStatus(subscription, SUBSCRIPTION_STATUS.CANCELLED);
    
    // Create cancellation history entry
    await prisma.subscriptionHistory.create({
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

    return updatedSubscription;
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

    return updatedSubscription;
  }
}

module.exports = new SubscriptionService();
