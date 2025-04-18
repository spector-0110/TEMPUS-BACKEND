const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const rabbitmqService = require('../../services/rabbitmq.service');
const subscriptionValidator = require('./subscription.validator');
const { 
  CACHE_KEYS, 
  CACHE_EXPIRY, 
  DEFAULT_CREDITS,
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE 
} = require('./subscription.constants');

class SubscriptionService {
  constructor() {
    this.setupSubscriptionQueue();
  }

  async setupSubscriptionQueue() {
    try {
      await rabbitmqService.createQueue('subscription_updates');
      // Listen for subscription plan updates
      await rabbitmqService.consumeQueue('subscription_updates', async (data) => {
        await this.invalidateAndRefreshCache();
      });
    } catch (error) {
      console.error('Error setting up subscription queue:', error);
    }
  }

  async createPlan(planData) {
    const validationResult = subscriptionValidator.validatePlanData(planData);
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
    }

    // Format features if provided as array
    if (planData.features && Array.isArray(planData.features)) {
      planData.features = JSON.stringify(planData.features);
    }

    const newPlan = await prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.create({
        data: {
          ...planData,
          isActive: true
        }
      });

      // Fetch all active plans to update cache
      const allPlans = await tx.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: { monthlyPrice: 'asc' }
      });

      // Update Redis cache
      await this.updatePlansCache(allPlans);

      return plan;
    });

    // Notify other servers about the update
    await this.notifyPlanUpdate('PLAN_CREATED', newPlan);

    return newPlan;
  }

  async updatePlan(planId, updateData) {
    const validationResult = subscriptionValidator.validatePlanData(updateData, true);
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
    }

    // Format features if provided as array
    if (updateData.features && Array.isArray(updateData.features)) {
      updateData.features = JSON.stringify(updateData.features);
    }

    const updatedPlan = await prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.update({
        where: { id: planId },
        data: updateData
      });

      // Fetch all active plans to update cache
      const allPlans = await tx.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: { monthlyPrice: 'asc' }
      });

      // Update Redis cache
      await this.updatePlansCache(allPlans);

      return plan;
    });

    // Notify other servers about the update
    await this.notifyPlanUpdate('PLAN_UPDATED', updatedPlan);

    return updatedPlan;
  }

  async deletePlan(planId) {
    // Soft delete with transaction
    const deletedPlan = await prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.update({
        where: { id: planId },
        data: { isActive: false }
      });

      // Fetch all remaining active plans
      const allPlans = await tx.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: { monthlyPrice: 'asc' }
      });

      // Update Redis cache
      await this.updatePlansCache(allPlans);

      return plan;
    });

    // Notify other servers about the deletion
    await this.notifyPlanUpdate('PLAN_DELETED', { id: planId, isActive: false });

    return deletedPlan;
  }

  async getAllPlans() {
    // Try to get plans from Redis cache first
    let plans = await redisService.getCache(CACHE_KEYS.SUBSCRIPTION_PLANS);
    
    if (!plans) {
      // If not in cache, fetch from database
      plans = await this.fetchPlansFromDB();

      if (plans?.length > 0) {
        // Store in cache if we got plans
        await this.updatePlansCache(plans);
      }
    }

    return plans;
  }

  async createHospitalSubscription(subscriptionData) {
    const validationResult = subscriptionValidator.validateSubscriptionData(subscriptionData);
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
    }

    // Set default values
    const now = new Date();
    const startDate = subscriptionData.startDate ? new Date(subscriptionData.startDate) : now;
    const endDate = subscriptionData.endDate ? new Date(subscriptionData.endDate) : 
      new Date(startDate.setMonth(startDate.getMonth() + (subscriptionData.billingCycle === BILLING_CYCLE.YEARLY ? 12 : 1)));

    const subscription = await prisma.$transaction(async (tx) => {
      // Check if hospital already has an active subscription
      const existingSubscription = await tx.hospitalSubscription.findFirst({
        where: {
          hospitalId: subscriptionData.hospitalId,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          endDate: { gt: now }
        }
      });

      if (existingSubscription) {
        throw new Error('Hospital already has an active subscription');
      }

      return await tx.hospitalSubscription.create({
        data: {
          ...subscriptionData,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          startDate,
          endDate,
          smsCredits: DEFAULT_CREDITS.SMS,
          emailCredits: DEFAULT_CREDITS.EMAIL
        }
      });
    });

    // Invalidate hospital subscription cache
    await this.invalidateHospitalSubscriptionCache(subscriptionData.hospitalId);

    return subscription;
  }

  async updateSubscriptionStatus(subscriptionId, status) {
    if (!Object.values(SUBSCRIPTION_STATUS).includes(status)) {
      throw new Error('Invalid subscription status');
    }

    const subscription = await prisma.hospitalSubscription.update({
      where: { id: subscriptionId },
      data: { status }
    });

    // Invalidate hospital subscription cache
    await this.invalidateHospitalSubscriptionCache(subscription.hospitalId);

    return subscription;
  }

  async getHospitalSubscription(hospitalId) {
    const cacheKey = CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId;
    
    // Try cache first
    let subscription = await redisService.getCache(cacheKey);
    
    if (!subscription) {
      subscription = await prisma.hospitalSubscription.findFirst({
        where: {
          hospitalId,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          endDate: { gt: new Date() }
        },
        include: {
          plan: {
            select: {
              name: true,
              maxDoctors: true,
              features: true
            }
          }
        }
      });

      if (subscription) {
        await redisService.setCache(cacheKey, subscription, CACHE_EXPIRY.HOSPITAL_SUBSCRIPTION);
      }
    }

    return subscription;
  }

  async updateUsageStats(usageData) {
    const validationResult = subscriptionValidator.validateUsageUpdate(usageData);
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
    }

    const { hospitalId, ...stats } = usageData;
    const cacheKey = CACHE_KEYS.USAGE_STATS + hospitalId;

    await redisService.setCache(cacheKey, {
      ...stats,
      lastUpdated: new Date()
    }, CACHE_EXPIRY.USAGE_STATS);
  }

  // Helper methods
  async fetchPlansFromDB() {
    return await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPrice: 'asc' }
    });
  }

  async updatePlansCache(plans) {
    await redisService.setCache(
      CACHE_KEYS.SUBSCRIPTION_PLANS, 
      plans, 
      CACHE_EXPIRY.SUBSCRIPTION_PLANS
    );
  }

  async invalidateAndRefreshCache() {
    // Invalidate current cache
    await redisService.invalidateCache(CACHE_KEYS.SUBSCRIPTION_PLANS);
    
    // Fetch fresh data from database
    const plans = await this.fetchPlansFromDB();
    
    // Update cache with fresh data
    if (plans?.length > 0) {
      await this.updatePlansCache(plans);
    }
  }

  async invalidateHospitalSubscriptionCache(hospitalId) {
    await redisService.invalidateCache(CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId);
  }

  async notifyPlanUpdate(type, plan) {
    try {
      await rabbitmqService.publishToQueue('subscription_updates', {
        type,
        plan,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error notifying plan update:', error);
    }
  }
}

module.exports = new SubscriptionService();