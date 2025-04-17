const express = require('express');
const router = express.Router();
const SubscriptionController = require('../controllers/subscription.controller');
const authMiddleware = require('../middleware/auth.middleware');
const superAdminMiddleware = require('../middleware/superadmin.middleware');

const subscriptionController = new SubscriptionController();

// Public route for getting subscription plans
router.get('/plans', (req, res) => subscriptionController.getAllPlans(req, res));

// Super admin only routes - protected by superadmin middleware
router.post('/plans', superAdminMiddleware, (req, res) => subscriptionController.createPlan(req, res));
router.put('/plans/:id', superAdminMiddleware, (req, res) => subscriptionController.updatePlan(req, res));
router.delete('/plans/:id', superAdminMiddleware, (req, res) => subscriptionController.deletePlan(req, res));

// Cache management - only accessible by super admin
router.post('/refresh-cache', superAdminMiddleware, (req, res) => subscriptionController.refreshCache(req, res));

module.exports = router;