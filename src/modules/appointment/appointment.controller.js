const appointmentService = require('./appointment.service');
const validator = require('./appointment.validator');
const trackingUtil = require('../../utils/tracking.util');
const { APPOINTMENT_STATUS } = require('./appointment.constants');

/**
 * Controller for appointment-related API endpoints
 */
class AppointmentController {
  /**
   * Create a new appointment
   */
  async createAppointment(req, res) {
    try {
      // Validate appointment data
      const { error, value } = validator.validateAppointment(req.body);
      
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid appointment data',
          errors: error.details.map(detail => detail.message)
        });
      }
      
      // Create the appointment
      const appointment = await appointmentService.createAppointment(value);
      
      return res.status(201).json({
        success: true,
        message: 'Appointment created successfully',
        data: appointment
      });
    } catch (error) {
      console.error('Error in createAppointment controller:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to create appointment', 
        error: error.message 
      });
    }
  }

  /**
   * Get a specific appointment by ID
   */
  async getAppointmentById(req, res) {
    try {
      // Validate appointment ID
      const { error } = validator.validateAppointmentId({ id: req.params.id });
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid appointment ID',
          errors: error.details.map(detail => detail.message)
        });
      }
      
      // Get appointment
      const appointment = await appointmentService.getAppointmentById(req.params.id);
      
      return res.status(200).json({
        success: true,
        message: 'Appointment retrieved successfully',
        data: appointment
      });
    } catch (error) {
      console.error('Error in getAppointmentById controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: 'Appointment not found', 
          error: error.message 
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve appointment', 
        error: error.message 
      });
    }
  }

   /**
   * Get all appointments with optional filtering
   */
  async getTodayAndTomorrowandPastWeekAppointments(req, res) {
    try {
      const  hospitalId  = req.user.hospital_id;
      const appointments =await appointmentService.getTodayAndTomorrowandPastWeekAppointments(hospitalId);
  
      
      return res.status(200).json({
        success: true,
        message: 'Appointments retrieved successfully',
        data: appointments
      });
    } catch (error) {
      console.error('Error in getAllAppointments controller:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve appointments', 
        error: error.message 
      });
    }
  }
   /**
   * Get all appointments with optional filtering
   */
  async getAppointmentHistory(req, res) {
    try {
      const days = req.body?.days || 30;
      const hospitalId = req.user.hospital_id;
      
      const appointments =await appointmentService.getAppointmentHistory(hospitalId, days);
      
      return res.status(200).json({
        success: true,
        message: 'Appointments History retrieved successfully',
        data: appointments
      });
    } catch (error) {
      console.error('Error in getAllAppointments controller:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve appointments', 
        error: error.message 
      });
    }
  }

  /**
   * Update an appointment's status
   */
  async updateAppointmentStatus(req, res) {
    try {
      // Validate appointment ID
      const { error: idError } = validator.validateAppointmentId({ id: req.params.id });
      if (idError) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid appointment ID',
          errors: idError.details.map(detail => detail.message)
        });
      }
      
      // Validate status
      const { error, value } = validator.validateAppointmentStatus(req.body);
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid appointment status',
          errors: error.details.map(detail => detail.message)
        });
      }
      
      // Update status
      const updatedAppointment = await appointmentService.updateAppointmentStatus(req.params.id, value.status);
      
      return res.status(200).json({
        success: true,
        message: 'Appointment status updated successfully',
        data: updatedAppointment
      });
    } catch (error) {
      console.error('Error in updateAppointmentStatus controller:', error);
      
      if (error.message.includes('Invalid status transition')) {
        return res.status(400).json({ 
          success: false, 
          message: error.message 
        });
      }
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: 'Appointment not found', 
          error: error.message 
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update appointment status', 
        error: error.message 
      });
    }
  }

  /**
   * Update an appointment's payment status
   */
  async updatePaymentStatus(req, res) {
    try {
      // Validate appointment ID
      const { error: idError } = validator.validateAppointmentId({ id: req.params.id });
      if (idError) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid appointment ID',
          errors: idError.details.map(detail => detail.message)
        });
      }
      
      // Validate payment status
      const { error, value } = validator.validatePaymentStatus(req.body);
      if (error) {
        return res.status(400).json({ 
          success: false, 
          errors: error.details.map(detail => detail.message)
        });
      }
      
      // Update payment status
      const updatedAppointment = await appointmentService.updatePaymentStatus(
        req.params.id, 
        value.paymentStatus,
        value.paymentMethod,
        value.amount
      );
      
      return res.status(200).json({
        success: true,
        message: 'Payment updated successfully',
        data: updatedAppointment
      });
    } catch (error) {
      console.error('Error in updatePaymentStatus controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: 'Appointment not found', 
          error: error.message 
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update payment status', 
        error: error.message 
      });
    }
  }

  /**
   * Delete an appointment
   */
  async deleteAppointment(req, res) {
    try {
      // Validate appointment ID
      const { error } = validator.validateAppointmentId({ id: req.params.id });
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid appointment ID',
          errors: error.details.map(detail => detail.message)
        });
      }
      
      // Delete appointment
      await appointmentService.deleteAppointment(req.params.id);
      
      return res.status(200).json({
        success: true,
        message: 'Appointment deleted successfully'
      });
    } catch (error) {
      console.error('Error in deleteAppointment controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: 'Appointment not found', 
          error: error.message 
        });
      }
      
      if (error.message.includes('Cannot delete')) {
        return res.status(400).json({ 
          success: false, 
          message: error.message 
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to delete appointment', 
        error: error.message 
      });
    }
  }

  async getHospitalDetailsBySubdomainForAppointment(req, res) { 
    try {
      const { subdomain } = req.params;
      
      if (!subdomain) {
        return res.status(400).json({
          success: false,
          message: 'Subdomain is required'
        });
      }

      const hospitalDetails = await appointmentService.getHospitalDetailsBySubdomainForAppointment(subdomain);
      
      return res.status(200).json({
        success: true,
        message: 'Hospital details retrieved successfully',
        data: hospitalDetails
      });
    } catch (error) {
      console.error('Error getting hospital details by subdomain:', error);
      
      if (error.message === 'Hospital not found') {
        return res.status(404).json({
          success: false,
          message: 'Hospital not found with this subdomain'
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve hospital details',
        error: error.message
      });
    }
   }

   /**
   * Get appointments history by mobile number
   */
  async getAppointmentHistoryByMobileNumber(req, res) {
    try {
      const { mobileNumber } = req.query;
      const hospitalId = req.user.hospital_id;

      if (!mobileNumber) {
        return res.status(400).json({
          success: false,
          message: 'Mobile number is required'
        });
      }
      
      const appointments = await appointmentService.getAppointmentHistoryByMobileNumber(hospitalId, mobileNumber);
      
      return res.status(200).json({
        success: true,
        message: 'Appointment history retrieved successfully',
        data: appointments
      });
    } catch (error) {
      console.error('Error in getAppointmentHistoryByMobileNumber controller:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to retrieve appointment history', 
        error: error.message 
      });
    }
  }

  /**
   * Update appointment documents
   */
  async updateAppointmentDocuments(req, res) {
    try {
      // Extract JWT token from URL parameter
      const { token } = req.params;
      
      if (!token) {
        return res.status(400).json({
          success: false,
          message: 'JWT token is required'
        });
      }

      // Verify the JWT token
      let tokenData;
      try {
        tokenData = await trackingUtil.verifyToken(token);
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token',
          error: error.message
        });
      }

      // Extract appointment ID from verified token
      const appointmentId = tokenData.appointmentId;

      // Validate documents data
      const { error, value } = validator.validateDocumentsUpdate(req.body);
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid documents data',
          errors: error.details.map(detail => detail.message)
        });
      }

      // Update the appointment documents
      const appointment = await appointmentService.updateAppointmentDocuments(
        appointmentId, 
        value.documents
      );
      
      return res.status(200).json({
        success: true,
        message: 'Appointment documents updated successfully',
      });
    } catch (error) {
      console.error('Error in updateAppointmentDocuments controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: 'Appointment not found', 
          error: error.message 
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update appointment documents', 
        error: error.message 
      });
    }
  }

  /**
   * Verify upload token and check if documents already exist
   */
  async verifyUploadToken(req, res) {
    try {
      console.log('Verifying upload token...');
      // Extract JWT token from URL parameter
      const { token } = req.params;
      
      if (!token) {
        return res.status(400).json({
          success: false,
          message: 'JWT token is required'
        });
      }

      // Verify the JWT token
      let tokenData;
      try {
        tokenData = await trackingUtil.verifyToken(token);
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token',
          error: error.message
        });
      }

      // Extract appointment ID from verified token
      const appointmentId = tokenData.appointmentId;

      // Get the appointment to check if documents exist
      const appointment = await appointmentService.getAppointmentById(appointmentId);
      
      // Check if documents already exist
      const hasDocuments = appointment.documents && 
                          Array.isArray(appointment.documents) && 
                          appointment.documents.length > 0;
      const isCompleted = appointment.status === APPOINTMENT_STATUS.COMPLETED;

      if (!isCompleted) {
        return res.status(405).json({
          success: false,
          message: 'Document upload not allowed. Appointment must be completed first.',
          documentsExist: true
        });
      }

      if (hasDocuments) {
        return res.status(405).json({
          success: false,
          message: 'Documents already exist, not allowed to upload again',
          documentsExist: true
        });
      }

      // Documents don't exist, allow upload
      return res.status(200).json({
        success: true,
        message: 'Upload allowed',
        documentsExist: false,
        appointmentId: appointmentId
      });
    } catch (error) {
      console.error('Error in verifyUploadToken controller:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({ 
          success: false, 
          message: 'Appointment not found', 
          error: error.message 
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to verify upload token', 
        error: error.message 
      });
    }
  }

}


module.exports = new AppointmentController();