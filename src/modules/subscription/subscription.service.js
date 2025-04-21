const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const { 
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE,
  PRICING,
  CACHE_KEYS,
  CACHE_EXPIRY,
  LIMITS
} = require('./subscription.constants');

const messageService = require('../notification/message.service');

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

  async createSubscription(hospitalId, doctorCount, billingCycle) {
    if (doctorCount < LIMITS.MIN_DOCTORS || doctorCount > LIMITS.MAX_DOCTORS) {
      throw new Error(`Doctor count must be between ${LIMITS.MIN_DOCTORS} and ${LIMITS.MAX_DOCTORS}`);
    }

    const startDate = new Date();
    const endDate = new Date();
    if (billingCycle === BILLING_CYCLE.MONTHLY) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const totalPrice = await this.calculatePrice(doctorCount, billingCycle);

    return await prisma.$transaction(async (tx) => {
      const subscription = await tx.hospitalSubscription.create({
        data: {
          hospitalId,
          doctorCount,
          billingCycle,
          startDate,
          endDate,
          totalPrice,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          autoRenew: true
        }
      });

      // Create history entry
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          hospitalId,
          doctorCount,
          billingCycle,
          pricePerDoctor,
          totalPrice: pricePerDoctor * doctorCount,
          startDate,
          endDate,
          createdAt: new Date()
        }
      });

      // Initialize message quota
      await messageService.refreshMessageQuota(hospitalId);

      return subscription;
    });
  }

  async updateDoctorCount(hospitalId, newDoctorCount,billingCycle) {
    if (newDoctorCount < LIMITS.MIN_DOCTORS || newDoctorCount > LIMITS.MAX_DOCTORS) {
      throw new Error(`Doctor count must be between ${LIMITS.MIN_DOCTORS} and ${LIMITS.MAX_DOCTORS}`);
    }

    const subscription = await this.getHospitalSubscription(hospitalId);
    if (!subscription) {
      throw new Error('No active subscription found');
    }

    const startDate = new Date();
    const endDate = new Date();
    if (billingCycle === BILLING_CYCLE.MONTHLY) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }


    const totalPrice = await this.calculatePrice(newDoctorCount,billingCycle);

    const updatedSubscription = await prisma.$transaction(async (tx) => {
      // Update subscription
      const updated = await tx.hospitalSubscription.update({
        where: { id: subscription.id },
        data: {
          doctorCount: newDoctorCount,
          billingCycle,
          startDate,
          endDate,
          totalPrice,
          status: SUBSCRIPTION_STATUS.ACTIVE
        }
      });

      // Create history entry
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          hospitalId,
          doctorCount: newDoctorCount,
          billingCycle: subscription.billingCycle,
          pricePerDoctor,
          totalPrice: pricePerDoctor * newDoctorCount,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          createdAt: new Date()
        }
      });

      return updated;
    });

    // Invalidate cache
    await redisService.invalidateCache(CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId);

    // Update message quota
    await messageService.refreshMessageQuota(hospitalId);

    return updatedSubscription;
  }

  async renewSubscription(hospitalId, billingCycle) {
    const currentSub = await this.getHospitalSubscription(hospitalId);
    if (!currentSub) {
      throw new Error('No active subscription found');
    }

    const startDate = new Date();
    const endDate = new Date();
    if (billingCycle === BILLING_CYCLE.MONTHLY) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const totalPrice = await this.calculatePrice(currentSub.doctorCount, billingCycle);

    const renewedSubscription = await prisma.$transaction(async (tx) => {
      const subscription = await tx.hospitalSubscription.update({
        where: { id: currentSub.id },
        data: {
          billingCycle,
          startDate,
          endDate,
          totalPrice,
          status: SUBSCRIPTION_STATUS.ACTIVE
        }
      });

      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          hospitalId,
          doctorCount: subscription.doctorCount,
          billingCycle,
          pricePerDoctor,
          totalPrice: pricePerDoctor * subscription.doctorCount,
          startDate,
          endDate,
          createdAt: new Date()
        }
      });

      return subscription;
    });

    // Invalidate cache
    await redisService.invalidateCache(CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId);

    return renewedSubscription;
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
