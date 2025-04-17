const { prisma } = require('../services/database.service');
const redisService = require('../services/redis.service');
const rabbitmqService = require('../services/rabbitmq.service');

class SubscriptionController {
  constructor() {
    this.CACHE_KEY = 'subscription_plans';
    this.CACHE_EXPIRY = 24 * 60 * 60; // 24 hours
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

  async getAllPlans(req, res) {
    try {
      // Try to get plans from Redis cache first
      let plans = await redisService.getCache(this.CACHE_KEY);
      
      if (!plans) {
        console.log('Cache miss - fetching from database');
        // If not in cache, fetch from database
        plans = await this.fetchPlansFromDB();

        if (plans?.length > 0) {
          // Store in cache if we got plans
          await this.updateCache(plans);
        }
      } else {
        console.log('Cache hit - serving from Redis');
      }

      // Failsafe: If both Redis and DB fail or return no data, return default plan
      if (!plans || plans.length === 0) {
        return res.json([this.getDefaultPlan()]);
      }

      return res.json(plans);
    } catch (error) {
      console.error('Error fetching subscription plans:', error);
      return res.status(200).json([this.getDefaultPlan()]);
    }
  }

  async createPlan(req, res) {
    try {
      const planData = req.body;

      // Validate required fields
      if (!planData.name || !planData.maxDoctors || !planData.monthlyPrice) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Create plan in database
      const newPlan = await prisma.subscriptionPlan.create({
        data: planData
      });

      // Notify all servers about the update
      await rabbitmqService.publishToQueue('subscription_updates', {
        type: 'PLAN_CREATED',
        plan: newPlan
      });

      return res.status(201).json(newPlan);
    } catch (error) {
      console.error('Error creating subscription plan:', error);
      return res.status(500).json({ error: 'Failed to create subscription plan' });
    }
  }

  async updatePlan(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const updatedPlan = await prisma.subscriptionPlan.update({
        where: { id },
        data: updateData
      });

      // Notify all servers about the update
      await rabbitmqService.publishToQueue('subscription_updates', {
        type: 'PLAN_UPDATED',
        plan: updatedPlan
      });

      return res.json(updatedPlan);
    } catch (error) {
      console.error('Error updating subscription plan:', error);
      return res.status(500).json({ error: 'Failed to update subscription plan' });
    }
  }

  async deletePlan(req, res) {
    try {
      const { id } = req.params;

      // Soft delete by setting isActive to false
      const deletedPlan = await prisma.subscriptionPlan.update({
        where: { id },
        data: { isActive: false }
      });

      // Notify all servers about the update
      await rabbitmqService.publishToQueue('subscription_updates', {
        type: 'PLAN_DELETED',
        planId: id
      });

      return res.json({ message: 'Plan deactivated successfully' });
    } catch (error) {
      console.error('Error deleting subscription plan:', error);
      return res.status(500).json({ error: 'Failed to delete subscription plan' });
    }
  }

  // Private methods
  async fetchPlansFromDB() {
    return await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPrice: 'asc' }
    });
  }

  async updateCache(plans) {
    try {
      await redisService.setCache(this.CACHE_KEY, plans, this.CACHE_EXPIRY);
      console.log('Cache updated successfully');
    } catch (error) {
      console.error('Error updating cache:', error);
    }
  }

  async invalidateAndRefreshCache() {
    try {
      // Invalidate current cache
      await redisService.invalidateCache(this.CACHE_KEY);
      
      // Fetch fresh data from database
      const plans = await this.fetchPlansFromDB();
      
      // Update cache with fresh data
      if (plans?.length > 0) {
        await this.updateCache(plans);
      }
    } catch (error) {
      console.error('Error refreshing cache:', error);
    }
  }

  getDefaultPlan() {
    return {
      id: 'default',
      name: 'Basic Plan',
      description: 'Default basic plan',
      maxDoctors: 1,
      monthlyPrice: 0,
      yearlyPrice: 0,
      features: ['Basic features'],
      isActive: true
    };
  }
}

module.exports = SubscriptionController;