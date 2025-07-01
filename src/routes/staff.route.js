const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const staffController = require('../modules/staff/staff.controller');
const router = express.Router();

// All staff endpoints require authentication
router.use(authMiddleware);

// Get all staff members
router.get('/', staffController.getAllStaff);

// Staff CRUD operations
router.post('/', staffController.createStaff);
router.patch('/:id', staffController.updateStaff);
router.get('/:id', staffController.getStaffById);
router.delete('/:id', staffController.deleteStaff);

// Staff payment operations
router.get('/:id/payments', staffController.getStaffPayments);
router.post('/:id/payments', staffController.createStaffPayment);
router.patch('/payments/:paymentId', staffController.updateStaffPayment);
router.delete('/payments/:paymentId', staffController.deleteStaffPayment);

// Staff attendance operations
router.put('/attendance', staffController.markAttendance);
router.get('/:id/attendance', staffController.getStaffAttendance);
router.get('/attendance/summary', staffController.getAttendanceSummary);

module.exports = router;