const subscriptionService = require('./subscription.service');

class SubscriptionController {
  constructor() {
    // Bind methods to ensure correct 'this' context
    this.getAllPlans = this.getAllPlans.bind(this);
    this.createPlan = this.createPlan.bind(this);
    this.updatePlan = this.updatePlan.bind(this);
    this.deletePlan = this.deletePlan.bind(this);
    this.createSubscription = this.createSubscription.bind(this);
    this.getHospitalSubscription = this.getHospitalSubscription.bind(this);
    this.updateSubscriptionStatus = this.updateSubscriptionStatus.bind(this);
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

  async createSubscription(req, res) {
    try {
      const subscription = await subscriptionService.createHospitalSubscription({
        ...req.body,
        hospitalId: req.user.hospital_id
      });

      return res.status(201).json(subscription);
    } catch (error) {
      console.error('Error creating hospital subscription:', error);

      if (error.message === 'Hospital already has an active subscription') {
        return res.status(400).json({ error: error.message });
      }

      if (error.validationErrors) {
        return res.status(400).json({
          error: 'Validation failed',
          validationErrors: error.validationErrors
        });
      }

      return res.status(500).json({ error: 'Failed to create subscription' });
    }
  }

  async getHospitalSubscription(req, res) {
    try {
      const subscription = await subscriptionService.getHospitalSubscription(
        req.user.hospital_id
      );

      if (!subscription) {
        return res.status(404).json({ error: 'No active subscription found' });
      }

      return res.json(subscription);
    } catch (error) {
      console.error('Error fetching hospital subscription:', error);
      return res.status(500).json({ error: 'Failed to fetch subscription details' });
    }
  }

  async updateSubscriptionStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const subscription = await subscriptionService.updateSubscriptionStatus(id, status);

      return res.json({
        message: 'Subscription status updated successfully',
        subscription
      });
    } catch (error) {
      console.error('Error updating subscription status:', error);

      if (error.message === 'Invalid subscription status') {
        return res.status(400).json({ error: error.message });
      }

      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      return res.status(500).json({ error: 'Failed to update subscription status' });
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