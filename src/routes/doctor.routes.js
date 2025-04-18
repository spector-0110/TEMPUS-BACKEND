const express = require('express');
const router = express.Router();
const doctorController = require('../modules/doctor/doctor.controller');
const authMiddleware = require('../middleware/auth.middleware');

// All doctor routes require authentication
router.use(authMiddleware);

// Doctor management routes
router.post('/', doctorController.createDoctor);
router.get('/', doctorController.listDoctors);
router.get('/:id', doctorController.getDoctorDetails);
router.put('/:id', doctorController.updateDoctorDetails);
router.put('/:id/schedule/:dayOfWeek', doctorController.updateDoctorSchedule);

module.exports = router;