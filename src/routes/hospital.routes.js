const express = require('express');
const router = express.Router();
const hospitalController = require('../modules/hospital/hospital.controller');
const authMiddleware = require('../middleware/auth.middleware');
const superAdminMiddleware = require('../middleware/superadmin.middleware');

// Public routes (if any)

// Form configuration routes
router.get('/form-config', hospitalController.getFormConfig);
router.put('/form-config', superAdminMiddleware, hospitalController.updateFormConfig);
router.post('/form-config/reset', superAdminMiddleware, hospitalController.resetFormConfig);

// Initial registration route - needs auth but not hospital_id
router.post('/initial-details', authMiddleware, hospitalController.createHospital);

// Protected routes - need both auth and hospital_id
router.use(authMiddleware);

// Hospital information
router.get('/details', hospitalController.getHospitalDetails);
router.get('/dashboard', hospitalController.getDashboardStats);

// Hospital editing flow
router.post('/request-edit-verification', hospitalController.requestEditVerification);
router.post('/verify-edit-otp', hospitalController.verifyEditOTP);
router.put('/update', hospitalController.updateHospitalDetails);

module.exports = router;