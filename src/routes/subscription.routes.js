const express = require('express');
const router = express.Router();
const subscriptionController = require('../modules/subscription/subscription.controller');
const authMiddleware = require('../middleware/auth.middleware');
const superAdminMiddleware = require('../middleware/superadmin.middleware');

// Public route for getting subscription plans
router.get('/plans', subscriptionController.getAllPlans);

// Protected routes
// router.use(authMiddleware);

// Hospital subscription management
router.get('/current',authMiddleware, subscriptionController.getHospitalSubscription);
router.get('/history',authMiddleware, subscriptionController.getSubscriptionHistory);
router.post('/upgrade',authMiddleware, subscriptionController.upgradePlan);
router.post('/renew',authMiddleware, subscriptionController.renewSubscription);

// Super admin only routes - protected by superadmin middleware
router.use(superAdminMiddleware);

// Subscription plan management
router.post('/plans', subscriptionController.createPlan);
router.put('/plans/:id', subscriptionController.updatePlan);
router.delete('/plans/:id', subscriptionController.deletePlan);

// Cache management
router.post('/refresh-cache', subscriptionController.refreshCache);

module.exports = router;