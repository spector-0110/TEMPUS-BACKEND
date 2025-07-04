const doctorService = require('./doctor.service');

class DoctorController {
  constructor() {
    // Bind methods to ensure correct 'this' context
    this.createDoctor = this.createDoctor.bind(this);
    this.updateDoctorDetails = this.updateDoctorDetails.bind(this);
    this.updateDoctorSchedule = this.updateDoctorSchedule.bind(this);
    this.getDoctorDetails = this.getDoctorDetails.bind(this);
    this.listDoctors = this.listDoctors.bind(this);
  }

  async createDoctor(req, res) {
    try {
      if (!req.body || !Object.keys(req.body).length) {
        return res.status(400).json({ 
          error: 'Validation failed',
          message: 'Doctor data is required'
        });
      }

      const doctor = await doctorService.createDoctor(
        req.user.hospital_id,
        req.body
      );

      return res.status(201).json({
        message: 'Doctor created successfully',
        doctor
      });
    } catch (error) {
      console.error('Error creating doctor:', error);

      if (error.message === 'A doctor with this email or phone number or aadhar already exists in this hospital') {
        return res.status(409).json({ error: error.message });
      }

      if (error.validationErrors) {
        return res.status(400).json({
          error: error.validationErrors
        });
      }

      return res.status(500).json({ error: 'Failed to create doctor' });
    }
  }

  async updateDoctorDetails(req, res) {
    try {
      // Extract required fields from the request body
      const { doctor_id, ...updateDoctorData } = req.body;
      
      if (!doctor_id) {
        return res.status(400).json({ 
          error: 'Doctor ID is required' ,
        });
      }
      
      const updatedDoctor = await doctorService.updateDoctorDetails(
        req.user.hospital_id,
        doctor_id,
        updateDoctorData
      );

      return res.json({
        message: 'Doctor updated successfully',
        doctor: updatedDoctor
      });
    } catch (error) {
      console.error('Error updating doctor:', error);

      if (error.message === 'Doctor not found') {
        return res.status(404).json({ error: error.message });
      }

      if(error.message === 'Doctor Status is INACTIVE') {  
        return res.status(402).json({ 
          error: error.message,
          message: 'Doctor Status is INACTIVE' 
        });
      }

      if (error.message === 'A doctor with this email or phone number or aadhar already exists in this hospital') {
        return res.status(409).json({ error: error.message });
      }

      if (error.validationErrors) {
        return res.status(400).json({
          error: error.validationErrors
        });
      }

      return res.status(500).json({ error: 'Failed to update doctor' });
    }
  }

  async updateDoctorSchedule(req, res) {
    try {
      if (!req.body.doctor_id || !req.body.schedules) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Doctor ID and schedule data are required'
        });
      }
      
      const schedules = await doctorService.updateDoctorsSchedule(
        req.user.hospital_id,
        req.body.doctor_id,
        req.body.schedules,
      );

      return res.json({
        message: 'Schedules updated successfully',
        schedules
      });
    } catch (error) {
      console.error('Error updating doctor schedule:', error);

      if (error.message === 'Doctor not found' || error.message === 'Doctor not found or inactive') {
        return res.status(404).json({ error: error.message });
      }

      if (error.validationErrors) {
        return res.status(400).json({
          error: error.validationErrors,
        });
      }

      return res.status(500).json({ error: 'Failed to update schedule' });
    }
  }

  async getDoctorDetails(req, res) {
    try {
      const doctor = await doctorService.getDoctorDetails(
        req.user.hospital_id,
        req.params.id
      );

      return res.json(doctor);
    } catch (error) {
      console.error('Error fetching doctor details:', error);

      if (error.message === 'Doctor not found') {
        return res.status(404).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Failed to fetch doctor details' });
    }
  }

  async listDoctors(req, res) {
    try {
      const doctors = await doctorService.listDoctors(req.user.hospital_id);
      return res.json(doctors);
    } catch (error) {
      console.error('Error listing doctors:', error);
      return res.status(500).json({ error: 'Failed to fetch doctors' });
    }
  }
}

module.exports = new DoctorController();