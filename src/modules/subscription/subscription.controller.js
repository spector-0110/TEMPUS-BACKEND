const subscriptionService = require('./subscription.service');

class SubscriptionController {
  constructor() {
    // Bind methods to ensure correct 'this' context
    this.getHospitalSubscription = this.getHospitalSubscription.bind(this);
    this.getSubscriptionHistory = this.getSubscriptionHistory.bind(this);
    this.createSubscription = this.createSubscription.bind(this);
    this.updateDoctorCount = this.updateDoctorCount.bind(this);
    this.renewSubscription = this.renewSubscription.bind(this);
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

  async createSubscription(req, res) {
    try {
      const { doctorCount, billingCycle } = req.body;

      if (!doctorCount || !billingCycle) {
        return res.status(400).json({ 
          error: 'Validation failed',
          message: 'Doctor count and billing cycle are required'
        });
      }

      const subscription = await subscriptionService.createSubscription(
        req.user.hospital_id,
        doctorCount,
        billingCycle
      );

      return res.status(201).json({
        message: 'Subscription created successfully',
        subscription
      });
    } catch (error) {
      console.error('Error creating subscription:', error);

      if (error.message.includes('Doctor count must be between')) {
        return res.status(400).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Failed to create subscription' });
    }
  }

  async updateDoctorCount(req, res) {
    try {
      const { doctorCount,billingCycle } = req.body;

      if (!doctorCount || !billingCycle) {
        return res.status(400).json({ 
          error: 'Validation failed',
          message: 'Doctor count and billing cycle are required'
        });
      }

      const subscription = await subscriptionService.updateDoctorCount(
        req.user.hospital_id,
        doctorCount,
        billingCycle
      );

      return res.json({
        message: 'Doctor count updated successfully',
        subscription
      });
    } catch (error) {
      console.error('Error updating doctor count:', error);

      if (error.message.includes('Doctor count must be between') || 
          error.message === 'No active subscription found') {
        return res.status(400).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Failed to update doctor count' });
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

      const subscription = await subscriptionService.renewSubscription(
        req.user.hospital_id,
        billingCycle
      );

      return res.json({
        message: 'Subscription renewed successfully',
        subscription
      });
    } catch (error) {
      console.error('Error renewing subscription:', error);

      if (error.message === 'No active subscription found') {
        return res.status(404).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Failed to renew subscription' });
    }
  }
}

module.exports = new SubscriptionController();