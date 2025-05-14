const express = require('express');
const router = express.Router();
const doctorController = require('../modules/doctor/doctor.controller');
const authMiddleware = require('../middleware/auth.middleware');
const checkDoctorLimitMiddleware = require('../middleware/checkDoctorLimit.middleware');

// All doctor routes require authentication
router.use(authMiddleware);

// Doctor management routes
router.post('/create-doctor', checkDoctorLimitMiddleware ,doctorController.createDoctor);
router.get('/', doctorController.listDoctors);
router.get('/:id', doctorController.getDoctorDetails);
router.put('/:id', doctorController.updateDoctorDetails);
router.put('/update-doctor-schedule', doctorController.updateDoctorSchedule);
// add delete doctor route::

module.exports = router;