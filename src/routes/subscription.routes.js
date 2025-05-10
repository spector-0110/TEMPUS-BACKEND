const express = require('express');
const router = express.Router();
const subscriptionController = require('../modules/subscription/subscription.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { 
  validateCreateSubscription,
  validateCreateRenewSubscription,
} = require('../middleware/subscription.validator.middleware');

// All subscription routes require authentication
router.use(authMiddleware);

// Get current subscription
router.get('/current', subscriptionController.getCurrentSubscription);

// Get subscription history
router.get('/history', subscriptionController.getSubscriptionHistory);

// Create new subscription with validation not in  used as its used directly in service layer by hospital service
router.post('/create', validateCreateSubscription, subscriptionController.createSubscription);



// Create Renew subscription with validation
router.post('/create-renew', validateCreateRenewSubscription, subscriptionController.createRenewSubscription);

// add validation logic for razorpay payment
router.post('/verify-renew', subscriptionController.verifySubscription);


// Cancel subscription with validation
router.post('/cancel', subscriptionController.cancelSubscription);

module.exports = router;