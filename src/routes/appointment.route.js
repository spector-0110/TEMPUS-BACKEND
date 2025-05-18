const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const appointmentController = require('../modules/appointment/appointment.controller');
const router = express.Router();

// Public endpoints
router.get('/track/:token', appointmentController.trackAppointment);
router.get('/refresh-queue/:token', appointmentController.refreshQueueStatus); // For real-time queue updates

// Patient endpoints - no auth required for patient to create/manage their own appointments
router.post('/', appointmentController.createAppointment);
router.delete('/:id', appointmentController.deleteAppointment);

// Protected endpoints - require authentication
router.get('/', authMiddleware, appointmentController.getAllAppointments);
router.get('/:id', authMiddleware, appointmentController.getAppointmentById);
router.patch('/:id/status', authMiddleware, appointmentController.updateAppointmentStatus);
router.patch('/:id/payment', authMiddleware, appointmentController.updatePaymentStatus);

module.exports = router;