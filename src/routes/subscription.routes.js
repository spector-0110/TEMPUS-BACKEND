const express = require('express');
const router = express.Router();
const subscriptionController = require('../modules/subscription/subscription.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { 
  validateCreateSubscription,
  validateUpdateDoctorCount,
  validateRenewSubscription,
  validateCancelSubscription
} = require('../middleware/subscription.validator.middleware');

// All subscription routes require authentication
router.use(authMiddleware);

// Get current subscription
router.get('/current/:hospitalId', subscriptionController.getCurrentSubscription);

// Get subscription history
router.get('/history/:hospitalId', subscriptionController.getSubscriptionHistory);

// Create new subscription with validation
router.post('/create', validateCreateSubscription, subscriptionController.createSubscription);

// Update doctor count with validation
router.put('/update-doctors', validateUpdateDoctorCount, subscriptionController.updateDoctorCount);

// Renew subscription with validation
router.post('/renew', validateRenewSubscription, subscriptionController.renewSubscription);

// Cancel subscription with validation
router.post('/cancel', validateCancelSubscription, subscriptionController.cancelSubscription);

module.exports = router;