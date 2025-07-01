const staffService = require('./staff.service');
const staffPaymentService = require('./staffPayment.service');
const attendanceService = require('./attendance.service');
const validator = require('./staff.validator');
const { getCurrentIst } = require('../../utils/timezone.util');

/**
 * Controller for staff-related API endpoints
 */
class StaffController {
  /**
   * Create a new staff member
   */
  async createStaff(req, res) {
    try {
      // Validate staff data
      const { error, value } = validator.validateCreateStaff(req.body);
      
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid staff data',
          errors: error.details.map(detail => detail.message)
        });
      }
      
      // Get hospital ID from authenticated user
      const hospitalId = req.user.hospital_id;
      
      // Create the staff member
      const staff = await staffService.createStaff(hospitalId, value);
      
      return res.status(201).json({
        success: true,
        message: 'Staff member created successfully',
        data: staff
      });
    } catch (error) {
      console.error('Error in createStaff controller:', error);
      
      if (error.message.includes('already exists')) {
        return res.status(409).json({ 
          success: false, 
          message: error.message
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to create staff member', 
        error: error.message 
      });
    }
  }

  /**
   * Update staff member (limited fields only)
   */
  async updateStaff(req, res) {
    try {
      // Validate staff ID
      const { error: idError } = validator.validateStaffId({ id: req.params.id });
      if (idError) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid staff ID',
          errors: idError.details.map(detail => detail.message)
        });
      }
      // Validate update data
      const { error, value } = validator.validateUpdateStaff(req.body);
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid update data',
          errors: error.details.map(detail => detail.message)
        });
      }

      // Get hospital ID from authenticated user
      const hospitalId = req.user.hospital_id;
      const staffId = req.params.id;

      // Update the staff member
      const updatedStaff = await staffService.updateStaff(hospitalId, staffId, value);

      return res.status(200).json({
        success: true,
        message: 'Staff member updated successfully',
        data: updatedStaff
      });
    } catch (error) {
      console.error('Error in updateStaff controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: error.message
        });
      }
      
      if (error.message.includes('already exists')) {
        return res.status(409).json({ 
          success: false, 
          message: error.message
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update staff member', 
        error: error.message 
      });
    }
  }

  /**
   * Get staff member by ID with attendances and payments
   */
  async getStaffById(req, res) {
    try {
      // Validate staff ID
      const { error } = validator.validateStaffId({ id: req.params.id });
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid staff ID',
          errors: error.details.map(detail => detail.message)
        });
      }

      // Get hospital ID from authenticated user
      const hospitalId = req.user.hospital_id;
      const staffId = req.params.id;

      // Get staff with includes
      const staff = await staffService.getStaffById(hospitalId, staffId);

      return res.status(200).json({
        success: true,
        message: 'Staff member retrieved successfully',
        data: staff
      });
    } catch (error) {
      console.error('Error in getStaffById controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: error.message
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve staff member', 
        error: error.message 
      });
    }
  }

  /**
   * Get all staff members for a hospital with attendance for a specific date
   */
  async getAllStaff(req, res) {
    try {
      // Get hospital ID from authenticated user
      const hospitalId = req.user.hospital_id;
      
      // Get date from query param, default to today's date in IST if not provided
      let date = req.query.date;
      if (!date) {
        const nowIST = getCurrentIst();
        date = nowIST.toISOString().split('T')[0]; // Format: YYYY-MM-DD
      }
      
      // Get all staff members with attendance for the specified date
      const staff = await staffService.getAllStaff(hospitalId, date);
      
      return res.status(200).json({
        success: true,
        message: 'Staff members retrieved successfully',
        data: staff
      });
    } catch (error) {
      console.error('Error in getAllStaff controller:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve staff members', 
        error: error.message 
      });
    }
  }

  /**
   * Get all payments for a staff member
   */
  async getStaffPayments(req, res) {
    try {
      // Validate staff ID
      const { error } = validator.validateStaffId({ id: req.params.id });
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid staff ID',
          errors: error.details.map(detail => detail.message)
        });
      }

      // Get hospital ID from authenticated user
      const hospitalId = req.user.hospital_id;
      const staffId = req.params.id;

      // Extract query parameters for filtering
      const filters = {};
      if (req.query.paymentType) filters.paymentType = req.query.paymentType;
      if (req.query.paymentMode) filters.paymentMode = req.query.paymentMode;
      if (req.query.fromDate) filters.fromDate = new Date(req.query.fromDate);
      if (req.query.toDate) filters.toDate = new Date(req.query.toDate);

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;

      // Get staff payments
      const payments = await staffPaymentService.getStaffPayments(hospitalId, staffId, filters, page, limit);

      return res.status(200).json({
        success: true,
        message: 'Staff payments retrieved successfully',
        data: payments
      });
    } catch (error) {
      console.error('Error in getStaffPayments controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: error.message
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve staff payments', 
        error: error.message 
      });
    }
  }

  /**
   * Create a new payment for a staff member
   */
  async createStaffPayment(req, res) {
    try {
      // Validate staff ID
      const { error: idError } = validator.validateStaffId({ id: req.params.id });
      if (idError) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid staff ID',
          errors: idError.details.map(detail => detail.message)
        });
      }

      // Validate payment data
      const { error, value } = validator.validateCreateStaffPayment(req.body);
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid payment data',
          errors: error.details.map(detail => detail.message)
        });
      }

      // Get hospital ID from authenticated user
      const hospitalId = req.user.hospital_id;
      const staffId = req.params.id;

      // Create the payment
      const payment = await staffPaymentService.createStaffPayment(hospitalId, staffId, value);

      return res.status(201).json({
        success: true,
        message: 'Staff payment created successfully',
        data: payment
      });
    } catch (error) {
      console.error('Error in createStaffPayment controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: error.message
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to create staff payment', 
        error: error.message 
      });
    }
  }

  /**
   * Delete a staff payment
   */
  async deleteStaffPayment(req, res) {
    try {
      // Validate payment ID
      const { error } = validator.validatePaymentId({ id: req.params.paymentId });
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid payment ID',
          errors: error.details.map(detail => detail.message)
        });
      }

      // Get hospital ID from authenticated user
      const hospitalId =req.user.hospital_id;
      const paymentId = req.params.paymentId;

      // Delete the payment
      await staffPaymentService.deleteStaffPayment(hospitalId, paymentId);

      return res.status(200).json({
        success: true,
        message: 'Staff payment deleted successfully'
      });
    } catch (error) {
      console.error('Error in deleteStaffPayment controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: error.message
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to delete staff payment', 
        error: error.message 
      });
    }
  }

  /**
   * Update a staff payment (limited fields only)
   */
  async updateStaffPayment(req, res) {
    try {
      // Validate payment ID
      const { error: idError } = validator.validatePaymentId({ id: req.params.paymentId });
      if (idError) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid payment ID',
          errors: idError.details.map(detail => detail.message)
        });
      }

      // Validate update data
      const { error, value } = validator.validateUpdateStaffPayment(req.body);
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid payment update data',
          errors: error.details.map(detail => detail.message)
        });
      }

      // Get hospital ID from authenticated user
      const hospitalId = req.user.hospital_id;
      const paymentId = req.params.paymentId;

      // Update the payment
      const updatedPayment = await staffPaymentService.updateStaffPayment(hospitalId, paymentId, value);

      return res.status(200).json({
        success: true,
        message: 'Staff payment updated successfully',
        data: updatedPayment
      });
    } catch (error) {
      console.error('Error in updateStaffPayment controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: error.message
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update staff payment', 
        error: error.message 
      });
    }
  }

  /**
   * Mark or update staff attendance (upsert operation)
   */
  async markAttendance(req, res) {
    try {
      // Validate attendance data
      const { error, value } = validator.validateAttendance(req.body);
      
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid attendance data',
          errors: error.details.map(detail => detail.message)
        });
      }
      
      // Get hospital ID from authenticated user
      const hospitalId =req.user.hospital_id;
      
      // Mark attendance
      const attendance = await attendanceService.markAttendance(hospitalId, value);
      
      return res.status(200).json({
        success: true,
        message: 'Attendance marked successfully',
        data: attendance
      });
    } catch (error) {
      console.error('Error in markAttendance controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: error.message
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to mark attendance', 
        error: error.message 
      });
    }
  }

  /**
   * Get staff attendance with optional filters
   */
  async getStaffAttendance(req, res) {
    try {
      // Validate staff ID
      const { error: idError } = validator.validateStaffId({ id: req.params.id });
      if (idError) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid staff ID',
          errors: idError.details.map(detail => detail.message)
        });
      }

      // Get hospital ID from authenticated user
      const hospitalId = req.user.hospital_id;
      const staffId = req.params.id;

      // Extract filters from query parameters
      const filters = {};
      if (req.query.fromDate) filters.fromDate = req.query.fromDate;
      if (req.query.toDate) filters.toDate = req.query.toDate;
      if (req.query.status) filters.status = req.query.status;

      // Get attendance
      const attendance = await attendanceService.getStaffAttendance(hospitalId, staffId, filters);

      return res.status(200).json({
        success: true,
        message: 'Staff attendance retrieved successfully',
        data: attendance
      });
    } catch (error) {
      console.error('Error in getStaffAttendance controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: error.message
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve staff attendance', 
        error: error.message 
      });
    }
  }

  /**
   * Get attendance summary for all staff
   */
  async getAttendanceSummary(req, res) {
    try {
      // Get hospital ID from authenticated user
      const hospitalId = req.user.hospital_id;

      // Extract filters from query parameters
      const filters = {};
      if (req.query.fromDate) filters.fromDate = req.query.fromDate;
      if (req.query.toDate) filters.toDate = req.query.toDate;
      if (req.query.status) filters.status = req.query.status;

      // Get attendance summary
      const summary = await attendanceService.getHospitalAttendance(hospitalId, filters);

      return res.status(200).json({
        success: true,
        message: 'Attendance summary retrieved successfully',
        data: summary
      });
    } catch (error) {
      console.error('Error in getAttendanceSummary controller:', error);
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve attendance summary', 
        error: error.message 
      });
    }
  }

  /**
   * Delete a staff member
   */
  async deleteStaff(req, res) {
    try {
      // Validate staff ID
      const { error } = validator.validateStaffId({ id: req.params.id });
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid staff ID',
          errors: error.details.map(detail => detail.message)
        });
      }

      // Get hospital ID from authenticated user
      const hospitalId = req.user.hospital_id;
      const staffId = req.params.id;

      // Delete the staff member
      const deletedStaff = await staffService.deleteStaff(hospitalId, staffId);

      return res.status(200).json({
        success: true,
        message: 'Staff member deleted successfully',
        data: deletedStaff
      });
    } catch (error) {
      console.error('Error in deleteStaff controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: error.message
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to delete staff member', 
        error: error.message 
      });
    }
  }
}

module.exports = new StaffController();
