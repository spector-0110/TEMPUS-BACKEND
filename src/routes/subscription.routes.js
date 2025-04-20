const express = require('express');
const router = express.Router();
const subscriptionController = require('../modules/subscription/subscription.controller');
const authMiddleware = require('../middleware/auth.middleware');

// All routes require authentication
router.use(authMiddleware);

// Hospital subscription management
router.get('/current', subscriptionController.getHospitalSubscription);
router.get('/history', subscriptionController.getSubscriptionHistory);
router.post('/create', subscriptionController.createSubscription);
router.put('/update-doctors', subscriptionController.updateDoctorCount);
router.post('/renew', subscriptionController.renewSubscription);

module.exports = router;