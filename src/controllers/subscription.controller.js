const { prisma } = require('../services/database.service');
const redisService = require('../services/redis.service');

class SubscriptionController {
  constructor() {
    this.CACHE_KEY = 'subscription_plans';
    this.CACHE_EXPIRY = 24 * 60 * 60; // 24 hours
  }

  async getAllPlans(req, res) {
    try {
      // Try to get plans from Redis cache first
      let plans = await redisService.getCache(this.CACHE_KEY);
      
      if (!plans) {
        // If not in cache, fetch from database
        plans = await prisma.subscriptionPlan.findMany({
          where: {
            isActive: true
          },
          orderBy: {
            monthlyPrice: 'asc'
          }
        });

        if (plans?.length > 0) {
          // Store in cache if we got plans
          await redisService.setCache(this.CACHE_KEY, plans, this.CACHE_EXPIRY);
        }
      }

      // Failsafe: If both Redis and DB fail or return no data, return default plan
      if (!plans || plans.length === 0) {
        const defaultPlan = {
          id: 'default',
          name: 'Basic Plan',
          description: 'Default basic plan',
          maxDoctors: 1,
          monthlyPrice: 0,
          yearlyPrice: 0,
          features: ['Basic features'],
          isActive: true
        };
        return res.json([defaultPlan]);
      }

      return res.json(plans);
    } catch (error) {
      console.error('Error fetching subscription plans:', error);
      // Failsafe: Return default plan in case of any error
      return res.status(200).json([{
        id: 'default',
        name: 'Basic Plan',
        description: 'Default basic plan',
        maxDoctors: 1,
        monthlyPrice: 0,
        yearlyPrice: 0,
        features: ['Basic features'],
        isActive: true
      }]);
    }
  }

  async refreshCache(req, res) {
    try {
      // Fetch fresh data from database
      const plans = await prisma.subscriptionPlan.findMany({
        where: {
          isActive: true
        },
        orderBy: {
          monthlyPrice: 'asc'
        }
      });

      // Update cache
      if (plans?.length > 0) {
        await redisService.setCache(this.CACHE_KEY, plans, this.CACHE_EXPIRY);
      }

      return res.json({ message: 'Cache refreshed successfully' });
    } catch (error) {
      console.error('Error refreshing subscription plans cache:', error);
      return res.status(500).json({ error: 'Failed to refresh cache' });
    }
  }
}

module.exports = SubscriptionController;