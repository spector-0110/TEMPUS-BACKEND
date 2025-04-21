const subscriptionService = require('./subscription.service');
const { SUBSCRIPTION_STATUS } = require('./subscription.constants');

class SubscriptionController {
  constructor() {
    // Bind methods to ensure correct 'this' context
    this.getHospitalSubscription = this.getHospitalSubscription.bind(this);
    this.getSubscriptionHistory = this.getSubscriptionHistory.bind(this);
    this.createSubscription = this.createSubscription.bind(this);
    this.updateDoctorCount = this.updateDoctorCount.bind(this);
    this.renewSubscription = this.renewSubscription.bind(this);
    this.cancelSubscription = this.cancelSubscription.bind(this);
    this.getCurrentSubscription = this.getCurrentSubscription.bind(this);
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
      const { hospitalId } = req.params;
      const history = await subscriptionService.getSubscriptionHistory(hospitalId);

      return res.status(200).json({
        success: true,
        data: history
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async createSubscription(req, res) {
    try {
      const { hospitalId, doctorCount, billingCycle, paymentMethod, paymentDetails } = req.body;
      const subscription = await subscriptionService.createSubscription(
        hospitalId,
        doctorCount,
        billingCycle,
        paymentMethod,
        paymentDetails
      );
      
      return res.status(201).json({
        success: true,
        data: subscription
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async updateDoctorCount(req, res) {
    try {
      const { hospitalId, newDoctorCount, billingCycle, paymentMethod, paymentDetails } = req.body;
      const subscription = await subscriptionService.updateDoctorCount(
        hospitalId,
        newDoctorCount,
        billingCycle,
        paymentMethod,
        paymentDetails
      );

      return res.status(200).json({
        success: true,
        data: subscription
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async renewSubscription(req, res) {
    try {
      const { hospitalId, billingCycle, paymentMethod, paymentDetails } = req.body;
      const subscription = await subscriptionService.renewSubscription(
        hospitalId,
        billingCycle,
        paymentMethod,
        paymentDetails
      );

      return res.status(200).json({
        success: true,
        data: subscription
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async cancelSubscription(req, res) {
    try {
      const { hospitalId } = req.body;
      const subscription = await subscriptionService.cancelSubscription(hospitalId);

      return res.status(200).json({
        success: true,
        data: subscription
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async getCurrentSubscription(req, res) {
    try {
      const { hospitalId } = req.params;
      const subscription = await subscriptionService.getHospitalSubscription(hospitalId);

      if (!subscription) {
        return res.status(404).json({
          success: false,
          error: 'No active subscription found'
        });
      }

      return res.status(200).json({
        success: true,
        data: subscription
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new SubscriptionController();