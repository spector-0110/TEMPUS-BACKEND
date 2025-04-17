const express = require('express');
const router = express.Router();
const hospitalController = require('../controllers/hospital.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Initial registration route with auth
router.post('/initial-details', authMiddleware, hospitalController.createHospital);

// Apply auth middleware to all other routes
router.use(authMiddleware);

// Hospital dashboard and details
router.get('/dashboard', hospitalController.getDashboardStats);
router.get('/details', hospitalController.getHospitalDetails);

// OTP verification flow
router.post('/request-edit-verification', hospitalController.requestEditVerification);
router.post('/verify-edit-otp', hospitalController.verifyEditOTP);
router.put('/update', hospitalController.updateHospitalDetails);

module.exports = router;