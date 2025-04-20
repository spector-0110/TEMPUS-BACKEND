const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const { 
  CACHE_KEYS, 
  CACHE_EXPIRY, 
  DEFAULT_CREDITS,
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE 
} = require('./subscription.constants');

const subscriptionValidator = require('./subscription.validator');
const rabbitmqService = require('../../services/rabbitmq.service');

class SubscriptionService {

  // Methods for subscription management

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

  async getFreePlan() {
    const freePlan = await prisma.subscriptionPlan.findFirst({
      where: {
        isActive: true,
        monthlyPrice: 0,
        yearlyPrice: 0
      }
    });
    return freePlan;
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

  // Hospital Subscription Management
  async assignFreePlanToHospital(tx,hospitalId) {
    const freePlan = await this.getFreePlan();
    if (!freePlan) {
      throw new Error('Free plan not found in the system');
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1); // 1 month trial

    return await this.createOrUpdateSubscription({
      tx,
      hospitalId,
      planId: freePlan.id,
      plan: freePlan,
      startDate,
      endDate,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      billingCycle: BILLING_CYCLE.MONTHLY,
      isNewSubscription: true
    });
  }

  async getHospitalSubscription(hospitalId) {
    return await prisma.hospitalSubscription.findFirst({
      where: { 
        hospitalId,
        status: SUBSCRIPTION_STATUS.ACTIVE
      },
      include: {
        plan: true
      }
    });
  }

  async upgradePlan(hospitalId, newPlanId, billingCycle) {
    // Validate billing cycle
    if (!Object.values(BILLING_CYCLE).includes(billingCycle)) {
      throw Object.assign(new Error('Validation failed'), { 
        validationErrors: ['Invalid billing cycle'] 
      });
    }

    const [currentSub, newPlan] = await Promise.all([
      this.getHospitalSubscription(hospitalId),
      prisma.subscriptionPlan.findUnique({ where: { id: newPlanId } })
    ]);

    if (!currentSub) {
      throw new Error('No active subscription found');
    }
    if (!newPlan) {
      throw new Error('New plan not found');
    }
    if (!newPlan.isActive) {
      throw new Error('Selected plan is not active');
    }

    const startDate = new Date();
    const endDate = new Date();
    if (billingCycle === BILLING_CYCLE.MONTHLY) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    return await this.createOrUpdateSubscription({
      hospitalId,
      planId: newPlan.id,
      plan: newPlan,
      startDate,
      endDate,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      billingCycle,
      existingSubscriptionId: currentSub.id
    });
  }

  async renewSubscription(hospitalId, billingCycle) {
    // Validate billing cycle
    if (!Object.values(BILLING_CYCLE).includes(billingCycle)) {
      throw Object.assign(new Error('Validation failed'), { 
        validationErrors: ['Invalid billing cycle'] 
      });
    }

    const currentSub = await this.getHospitalSubscription(hospitalId);
    if (!currentSub) {
      throw new Error('No active subscription found');
    }

    if (!currentSub.plan.isActive) {
      throw new Error('Current plan is no longer active. Please upgrade to a different plan.');
    }

    const startDate = new Date();
    const endDate = new Date();
    if (billingCycle === BILLING_CYCLE.MONTHLY) {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    return await this.createOrUpdateSubscription({
      hospitalId,
      planId: currentSub.plan.id,
      plan: currentSub.plan,
      startDate,
      endDate,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      billingCycle,
      existingSubscriptionId: currentSub.id
    });
  }

  // Subscription History
  async getSubscriptionHistory(hospitalId) {
    return await prisma.subscriptionHistory.findMany({
      where: { hospitalId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  // Helper Methods
  async createOrUpdateSubscription({
    tx: passedTx,
    hospitalId,
    planId,
    plan,
    startDate,
    endDate,
    status,
    billingCycle,
    existingSubscriptionId = null,
    isNewSubscription = false
  }) {
    const operation = async (tx) => {
      if (!plan) {
        throw new Error('Subscription plan not found');
      }

      // Take a snapshot of current plan features
      const planFeatures = plan.features;

      let subscription;
      if (existingSubscriptionId) {
        // Update existing subscription
        subscription = await tx.hospitalSubscription.update({
          where: { id: existingSubscriptionId },
          data: {
            planId,
            startDate,
            endDate,
            status,
            billingCycle,
            planFeatures,
            autoRenew: true
          }
        });
      } else {
        // Create new subscription
        subscription = await tx.hospitalSubscription.create({
          data: {
            hospitalId,
            planId,
            billingCycle,
            startDate,
            endDate,
            status,
            planFeatures,
            autoRenew: true
          }
        });
      }

      // Create subscription history entry
      if (isNewSubscription || existingSubscriptionId) {
        const price = billingCycle === BILLING_CYCLE.MONTHLY ? plan.monthlyPrice : plan.yearlyPrice;
        await tx.subscriptionHistory.create({
          data: {
            subscriptionId: subscription.id,
            hospitalId,
            planId,
            billingCycle,
            priceAtTime: price,
            startDate,
            endDate,
            status,
            planFeatures,
            createdAt: new Date()
          }
        });
      }

      return subscription;
    };

    // Use passed transaction if available, otherwise create new one
    return passedTx ? operation(passedTx) : await prisma.$transaction(operation);
  }

  async updateSubscriptionStatusAndHistory(subscriptionId, newStatus, existingSubscription = null) {
    const subscription = existingSubscription || await prisma.hospitalSubscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true }
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    return await prisma.$transaction(async (tx) => {
      // Update subscription status
      const updatedSubscription = await tx.hospitalSubscription.update({
        where: { id: subscriptionId },
        data: { status: newStatus }
      });

      // Create history entry only for terminal states (EXPIRED, CANCELLED)
      if ([SUBSCRIPTION_STATUS.EXPIRED, SUBSCRIPTION_STATUS.CANCELLED].includes(newStatus)) {
        await tx.subscriptionHistory.create({
          data: {
            subscriptionId,
            hospitalId: subscription.hospitalId,
            planId: subscription.planId,
            billingCycle: subscription.billingCycle,
            priceAtTime: subscription.billingCycle === BILLING_CYCLE.MONTHLY ? 
              subscription.plan.monthlyPrice : 
              subscription.plan.yearlyPrice,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            status: newStatus,
            planFeatures: subscription.planFeatures
          }
        });
      }

      return updatedSubscription;
    });
  }

  async updatePlansCache(plans) {
    await redisService.setCache(
      CACHE_KEYS.SUBSCRIPTION_PLANS, 
      plans, 
      CACHE_EXPIRY.SUBSCRIPTION_PLANS
    );
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

  async fetchPlansFromDB() {
    return await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPrice: 'asc' }
    });
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

  // async invalidateHospitalSubscriptionCache(hospitalId) {
  //   await redisService.invalidateCache(CACHE_KEYS.HOSPITAL_SUBSCRIPTION + hospitalId);
  // }

}

module.exports = new SubscriptionService();
