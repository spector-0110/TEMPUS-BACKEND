// const { prisma } = require('../services/database.service');
// const redisService = require('../services/redis.service');
// const rabbitmqService = require('../services/rabbitmq.service');

// class SubscriptionController {
//   constructor() {
//     this.CACHE_KEY = 'subscription_plans';
//     this.CACHE_EXPIRY = 24 * 60 * 60; // 24 hours
//     this.setupSubscriptionQueue();
//   }

//   async setupSubscriptionQueue() {
//     try {
//       await rabbitmqService.createQueue('subscription_updates');
//       // Listen for subscription plan updates
//       await rabbitmqService.consumeQueue('subscription_updates', async (data) => {
//         await this.invalidateAndRefreshCache();
//       });
//     } catch (error) {
//       console.error('Error setting up subscription queue:', error);
//     }
//   }

//   async getAllPlans(req, res) {
//     try {
//       // Try to get plans from Redis cache first
//       let plans = await redisService.getCache(this.CACHE_KEY);
      
//       if (!plans) {
//         console.log('Cache miss - fetching from database');
//         // If not in cache, fetch from database
//         plans = await this.fetchPlansFromDB();

//         if (plans?.length > 0) {
//           // Store in cache if we got plans
//           await this.updateCache(plans);
//         } else {
//           return res.status(404).json({ error: 'No subscription plans found' });
//         }
//       } else {
//         console.log('Cache hit - serving from Redis');
//       }

//       return res.json(plans);
//     } catch (error) {
//       console.error('Error fetching subscription plans:', error);
//       return res.status(500).json({ error: 'Failed to fetch subscription plans' });
//     }
//   }

//   async createPlan(req, res) {
//     try {
//       const planData = req.body;

//       // Validate required fields
//       if (!this.validatePlanData(planData)) {
//         return res.status(400).json({ error: 'Missing required fields' });
//       }

//       // Format features if provided
//       if (planData.features && Array.isArray(planData.features)) {
//         planData.features = JSON.stringify(planData.features);
//       }

//       // Create plan in database with transaction
//       const newPlan = await prisma.$transaction(async (prismaClient) => {
//         const plan = await prismaClient.subscriptionPlan.create({
//           data: planData
//         });

//         // Fetch all active plans to update cache
//         const allPlans = await prismaClient.subscriptionPlan.findMany({
//           where: { isActive: true },
//           orderBy: { monthlyPrice: 'asc' }
//         });

//         // Update Redis cache
//         await this.updateCache(allPlans);

//         return plan;
//       });

//       // Notify other servers about the update through RabbitMQ
//       await this.notifyPlanUpdate('PLAN_CREATED', newPlan);

//       return res.status(201).json(newPlan);
//     } catch (error) {
//       console.error('Error creating subscription plan:', error);
//       await this.invalidateCache();
//       return res.status(500).json({ error: 'Failed to create subscription plan' });
//     }
//   }

//   async updatePlan(req, res) {
//     try {
//       const { id } = req.params;
//       const updateData = req.body;

//       // Validate update data
//       if (!this.validatePlanData(updateData, true)) {
//         return res.status(400).json({ error: 'Invalid update data' });
//       }

//       // Format features if provided
//       if (updateData.features && Array.isArray(updateData.features)) {
//         updateData.features = JSON.stringify(updateData.features);
//       }

//       // Update plan in database with transaction
//       const updatedPlan = await prisma.$transaction(async (prismaClient) => {
//         const plan = await prismaClient.subscriptionPlan.update({
//           where: { id },
//           data: updateData
//         });

//         // Fetch all active plans to update cache
//         const allPlans = await prismaClient.subscriptionPlan.findMany({
//           where: { isActive: true },
//           orderBy: { monthlyPrice: 'asc' }
//         });

//         // Update Redis cache
//         await this.updateCache(allPlans);

//         return plan;
//       });

//       // Notify other servers about the update
//       await this.notifyPlanUpdate('PLAN_UPDATED', updatedPlan);

//       return res.json(updatedPlan);
//     } catch (error) {
//       console.error('Error updating subscription plan:', error);
//       await this.invalidateCache();
//       if (error.code === 'P2025') {
//         return res.status(404).json({ error: 'Subscription plan not found' });
//       }
//       return res.status(500).json({ error: 'Failed to update subscription plan' });
//     }
//   }

//   async deletePlan(req, res) {
//     try {
//       const { id } = req.params;

//       // Soft delete with transaction
//       const deletedPlan = await prisma.$transaction(async (prismaClient) => {
//         const plan = await prismaClient.subscriptionPlan.update({
//           where: { id },
//           data: { isActive: false }
//         });

//         // Fetch all remaining active plans
//         const allPlans = await prismaClient.subscriptionPlan.findMany({
//           where: { isActive: true },
//           orderBy: { monthlyPrice: 'asc' }
//         });

//         // Update Redis cache
//         await this.updateCache(allPlans);

//         return plan;
//       });

//       // Notify other servers about the deletion
//       await this.notifyPlanUpdate('PLAN_DELETED', { id, isActive: false });

//       return res.json({ 
//         message: 'Plan deactivated successfully',
//         planId: deletedPlan.id 
//       });
//     } catch (error) {
//       console.error('Error deleting subscription plan:', error);
//       await this.invalidateCache();
//       if (error.code === 'P2025') {
//         return res.status(404).json({ error: 'Subscription plan not found' });
//       }
//       return res.status(500).json({ error: 'Failed to delete subscription plan' });
//     }
//   }

//   // Private methods
//   async fetchPlansFromDB() {
//     try {
//       return await prisma.subscriptionPlan.findMany({
//         where: { isActive: true },
//         orderBy: { monthlyPrice: 'asc' }
//       });
//     } catch (error) {
//       console.error('Error in fetchPlansFromDB:', error);
//       throw error;
//     }
//   }

//   async updateCache(plans) {
//     try {
//       // First invalidate the existing cache
//       await redisService.invalidateCache(this.CACHE_KEY);
      
//       // Then set the new data
//       await redisService.setCache(this.CACHE_KEY, plans, this.CACHE_EXPIRY);
//       console.log('Cache invalidated and updated successfully');
//     } catch (error) {
//       console.error('Error updating cache:', error);
//       throw error; // Propagate error to trigger rollback in transaction
//     }
//   }

//   async invalidateAndRefreshCache() {
//     try {
//       // Invalidate current cache
//       await redisService.invalidateCache(this.CACHE_KEY);
      
//       // Fetch fresh data from database
//       const plans = await this.fetchPlansFromDB();
      
//       // Update cache with fresh data
//       if (plans?.length > 0) {
//         await this.updateCache(plans);
//       }
//     } catch (error) {
//       console.error('Error refreshing cache:', error);
//     }
//   }

//   async invalidateCache() {
//     try {
//       await redisService.invalidateCache(this.CACHE_KEY);
//     } catch (error) {
//       console.error('Error invalidating cache:', error);
//     }
//   }

//   validatePlanData(data, isUpdate = false) {
//     // For updates, we don't require all fields
//     if (isUpdate) {
//       return Object.keys(data).length > 0;
//     }
    
//     return data.name && 
//            data.maxDoctors && 
//            (data.monthlyPrice !== undefined || data.yearlyPrice !== undefined);
//   }

//   async notifyPlanUpdate(type, plan) {
//     try {
//       await rabbitmqService.publishToQueue('subscription_updates', {
//         type,
//         plan,
//         timestamp: new Date().toISOString()
//       });
//     } catch (error) {
//       console.error('Error notifying plan update:', error);
//     }
//   }
// }

// module.exports = SubscriptionController;