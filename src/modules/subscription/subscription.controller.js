const subscriptionService = require('./subscription.service');
const { SUBSCRIPTION_STATUS } = require('./subscription.constants');

class SubscriptionController {
  constructor() {
    // Bind methods to ensure correct 'this' context
    this.getHospitalSubscription = this.getHospitalSubscription.bind(this);
    this.getSubscriptionHistory = this.getSubscriptionHistory.bind(this);
    this.createRenewSubscription = this.createRenewSubscription.bind(this);
    this.verifySubscription = this.verifySubscription.bind(this);
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
      const history = await subscriptionService.getSubscriptionHistory(req.user.hospital_id);

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
      const { doctorCount, billingCycle, paymentMethod, paymentDetails } = req.body;
      const subscription = await subscriptionService.createSubscription(
        req.user.hospital_id,
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

  async createRenewSubscription(req, res) {
  try {
    const { billingCycle, updatedDoctorsCount } = req.body;

    if (!req.user || !req.user.hospital_id) {
      throw new Error('Hospital ID is missing or invalid');
    }

    const razorpayOrder = await subscriptionService.createRenewSubscription(
      req.user.hospital_id,
      billingCycle, 
      updatedDoctorsCount,
    );

    return res.status(200).json({
      success: true,
      data: razorpayOrder // Send the Razorpay order object
    });
  } catch (error) {
    console.error('Error in renewing subscription:', error.message);  // Log the error for debugging

    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  }

  async verifySubscription(req, res) {
    try{

      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters'
        });
      }

      const data = await subscriptionService.verifyAndUpdateSubscription(
        req.user.hospital,
        req.user.hospital_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      );

      return res.status(200).json({
        success: true,
        data: data
      }); 

    }catch(error){

    }

  }

  async cancelSubscription(req, res) {
    try {
      const subscription = await subscriptionService.cancelSubscription(req.user.hospital_id);

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
      const subscription = await subscriptionService.getHospitalSubscription(req.user.hospital_id);

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