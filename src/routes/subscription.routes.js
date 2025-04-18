const express = require('express');
const router = express.Router();
const subscriptionController = require('../modules/subscription/subscription.controller');
const authMiddleware = require('../middleware/auth.middleware');
const superAdminMiddleware = require('../middleware/superadmin.middleware');

// Public route for getting subscription plans
router.get('/plans', subscriptionController.getAllPlans);

// Routes that require authentication
router.use(authMiddleware);

// Hospital subscription routes
router.post('/subscribe', subscriptionController.createSubscription);
router.get('/current', subscriptionController.getHospitalSubscription);

// Super admin only routes - protected by superadmin middleware
router.use(superAdminMiddleware);

// Subscription plan management
router.post('/plans', subscriptionController.createPlan);
router.put('/plans/:id', subscriptionController.updatePlan);
router.delete('/plans/:id', subscriptionController.deletePlan);

// Subscription status management
router.put('/subscriptions/:id/status', subscriptionController.updateSubscriptionStatus);

// Cache management
router.post('/refresh-cache', subscriptionController.refreshCache);

module.exports = router;