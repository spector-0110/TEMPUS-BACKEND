const appointmentService = require('./appointment.service');
const validator = require('./appointment.validator');

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
   * Get all appointments with optional filtering
   */
  async getAllAppointments(req, res) {
    try {
      // Extract query params for filtering
      
      // Get appointments with filters
      const appointments = await appointmentService.getAllAppointment(req,res);
      
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
  
      console.log('Appointments:', appointments);
      
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
        value.paymentMethod
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

  /**
   * Track an appointment by token and get queue information
   */
  async trackAppointment(req, res) {
    try {
      // Validate tracking token
      const { error } = validator.validateTrackingToken({ token: req.params.token });
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid tracking token',
          errors: error.details.map(detail => detail.message)
        });
      }
      
      // Get appointment and queue information by tracking token
      const trackingInfo = await appointmentService.getAppointmentByTrackingToken(req.params.token);
      
      return res.status(200).json({
        success: true,
        message: 'Appointment and queue information retrieved successfully',
        data: trackingInfo
      });
    } catch (error) {
      console.error('Error in trackAppointment controller:', error);
      
      if (error.message.includes('Invalid or expired')) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid or expired tracking link' 
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
        message: 'Failed to track appointment', 
        error: error.message 
      });
    }
  }

  /**
   * Get fresh queue status information by tracking token
   * This endpoint bypasses the cache to provide the most up-to-date queue information
   */
  async refreshQueueStatus(req, res) {
    try {
      // Validate tracking token
      const { error } = validator.validateTrackingToken({ token: req.params.token });
      if (error) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid tracking token',
          errors: error.details.map(detail => detail.message)
        });
      }

      // First, invalidate any cached tracking data for this token
      await appointmentService.invalidateTrackingCaches(hospitalId, doctorId);
      
      // Get fresh appointment and queue information
      const trackingInfo = await appointmentService.getAppointmentByTrackingToken(req.params.token, true);
      
      return res.status(200).json({
        success: true,
        message: 'Queue information refreshed successfully',
        data: trackingInfo
      });
    } catch (error) {
      console.error('Error in refreshQueueStatus controller:', error);
      
      if (error.message.includes('Invalid or expired')) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid or expired tracking link' 
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
        message: 'Failed to refresh queue status', 
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
}


module.exports = new AppointmentController();