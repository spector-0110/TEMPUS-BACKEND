const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const verifySignature=require('../middleware/public-auth.middleware');
const appointmentController = require('../modules/appointment/appointment.controller');
const router = express.Router();

// Public endpoints
router.get('/track/:token',appointmentController.trackAppointment);
router.get('/refresh-queue/:token', appointmentController.refreshQueueStatus); // For real-time queue updates
router.get('/details/:subdomain',verifySignature, appointmentController.getHospitalDetailsBySubdomainForAppointment);

// Patient endpoints - no auth required for patient to create/manage their own appointments
router.post('/',verifySignature, appointmentController.createAppointment);
router.delete('/:id', verifySignature,appointmentController.deleteAppointment);

// Protected endpoints - require authentication
router.get('/', authMiddleware, appointmentController.getTodayAndTomorrowandPastWeekAppointments);
router.get('/history', authMiddleware, appointmentController.getAppointmentHistory);

router.get('/:id', authMiddleware, appointmentController.getAppointmentById);
router.patch('/:id/status', authMiddleware, appointmentController.updateAppointmentStatus);
router.patch('/:id/payment', authMiddleware, appointmentController.updatePaymentStatus);

module.exports = router;