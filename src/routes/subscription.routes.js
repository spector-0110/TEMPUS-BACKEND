const express = require('express');
const router = express.Router();
const SubscriptionController = require('../controllers/subscription.controller');
const authMiddleware = require('../middleware/auth.middleware');

const subscriptionController = new SubscriptionController();

// Public route for getting subscription plans
router.get('/plans', (req, res) => subscriptionController.getAllPlans(req, res));

// Protected route for refreshing cache - only accessible by authenticated users
router.post('/refresh-cache', authMiddleware, (req, res) => subscriptionController.refreshCache(req, res));

module.exports = router;