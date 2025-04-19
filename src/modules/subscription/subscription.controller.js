const subscriptionService = require('./subscription.service');

class SubscriptionController {
  constructor() {
    // Bind methods to ensure correct 'this' context
    this.getAllPlans = this.getAllPlans.bind(this);
    this.createPlan = this.createPlan.bind(this);
    this.updatePlan = this.updatePlan.bind(this);
    this.deletePlan = this.deletePlan.bind(this);
    this.getHospitalSubscription = this.getHospitalSubscription.bind(this);
    this.getSubscriptionHistory = this.getSubscriptionHistory.bind(this);
    this.upgradePlan = this.upgradePlan.bind(this);
    this.renewSubscription = this.renewSubscription.bind(this);
    this.refreshCache = this.refreshCache.bind(this);
  }

  async getAllPlans(req, res) {
    try {
      const plans = await subscriptionService.getAllPlans();
      
      if (!plans?.length) {
        return res.status(404).json({ error: 'No subscription plans found' });
      }

      return res.json(plans);
    } catch (error) {
      console.error('Error fetching subscription plans:', error);
      return res.status(500).json({ error: 'Failed to fetch subscription plans' });
    }
  }

  async createPlan(req, res) {
    try {
      const newPlan = await subscriptionService.createPlan(req.body);
      return res.status(201).json(newPlan);
    } catch (error) {
      console.error('Error creating subscription plan:', error);

      if (error.validationErrors) {
        return res.status(400).json({
          error: 'Validation failed',
          validationErrors: error.validationErrors
        });
      }

      return res.status(500).json({ error: 'Failed to create subscription plan' });
    }
  }

  async updatePlan(req, res) {
    try {
      const updatedPlan = await subscriptionService.updatePlan(
        req.params.id,
        req.body
      );

      return res.json(updatedPlan);
    } catch (error) {
      console.error('Error updating subscription plan:', error);

      if (error.validationErrors) {
        return res.status(400).json({
          error: 'Validation failed',
          validationErrors: error.validationErrors
        });
      }

      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Subscription plan not found' });
      }

      return res.status(500).json({ error: 'Failed to update subscription plan' });
    }
  }

  async deletePlan(req, res) {
    try {
      const deletedPlan = await subscriptionService.deletePlan(req.params.id);

      return res.json({ 
        message: 'Plan deactivated successfully',
        planId: deletedPlan.id 
      });
    } catch (error) {
      console.error('Error deleting subscription plan:', error);

      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Subscription plan not found' });
      }

      return res.status(500).json({ error: 'Failed to delete subscription plan' });
    }
  }

  async getHospitalSubscription(req, res) {
    try {
      const subscription = await subscriptionService.getHospitalSubscription(req.user.hospital_id);
      
      if (!subscription) {
        return res.status(404).json({ error: 'No active subscription found' });
      }

      return res.json(subscription);
    } catch (error) {
      console.error('Error fetching hospital subscription:', error);
      return res.status(500).json({ error: 'Failed to fetch subscription details' });
    }
  }

  async getSubscriptionHistory(req, res) {
    try {
      const history = await subscriptionService.getSubscriptionHistory(req.user.hospital_id);
      return res.json(history);
    } catch (error) {
      console.error('Error fetching subscription history:', error);
      return res.status(500).json({ error: 'Failed to fetch subscription history' });
    }
  }

  async upgradePlan(req, res) {
    try {
      const { planId, billingCycle } = req.body;

      if (!planId || !billingCycle) {
        return res.status(400).json({ 
          error: 'Validation failed',
          message: 'Plan ID and billing cycle are required'
        });
      }

      const newSubscription = await subscriptionService.upgradePlan(
        req.user.hospital_id,
        planId,
        billingCycle
      );

      return res.json({
        message: 'Plan upgraded successfully',
        subscription: newSubscription
      });
    } catch (error) {
      console.error('Error upgrading subscription plan:', error);

      if (error.message === 'No active subscription found' || 
          error.message === 'New plan not found') {
        return res.status(404).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Failed to upgrade subscription plan' });
    }
  }

  async renewSubscription(req, res) {
    try {
      const { billingCycle } = req.body;

      if (!billingCycle) {
        return res.status(400).json({ 
          error: 'Validation failed',
          message: 'Billing cycle is required'
        });
      }

      const renewedSubscription = await subscriptionService.renewSubscription(
        req.user.hospital_id,
        billingCycle
      );

      return res.json({
        message: 'Subscription renewed successfully',
        subscription: renewedSubscription
      });
    } catch (error) {
      console.error('Error renewing subscription:', error);

      if (error.message === 'No active subscription found') {
        return res.status(404).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Failed to renew subscription' });
    }
  }

  async refreshCache(req, res) {
    try {
      await subscriptionService.invalidateAndRefreshCache();
      return res.json({ message: 'Cache refreshed successfully' });
    } catch (error) {
      console.error('Error refreshing cache:', error);
      return res.status(500).json({ error: 'Failed to refresh cache' });
    }
  }
}

module.exports = new SubscriptionController();