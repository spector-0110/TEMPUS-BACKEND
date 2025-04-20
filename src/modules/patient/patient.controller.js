const patientService = require('./patient.service');

class PatientController {
  constructor() {
    // Bind methods to ensure correct 'this' context
    this.createPatient = this.createPatient.bind(this);
    this.getPatientDetails = this.getPatientDetails.bind(this);
    this.updatePatientDetails = this.updatePatientDetails.bind(this);
    this.searchPatients = this.searchPatients.bind(this);
    this.deletePatient = this.deletePatient.bind(this);
  }

  async createPatient(req, res) {
    try {
      if (!req.body || !Object.keys(req.body).length) {
        return res.status(400).json({ 
          error: 'Validation failed',
          message: 'Patient data is required'
        });
      }

      const patient = await patientService.createPatient(
        req.user.hospital_id,
        req.body
      );

      return res.status(201).json({
        message: 'Patient created successfully',
        patient
      });
    } catch (error) {
      console.error('Error creating patient:', error);
      
      if (error.message === 'A patient with this email or phone number already exists in this hospital') {
        return res.status(409).json({ error: error.message });
      }

      if (error.validationErrors) {
        return res.status(400).json({
          error: 'Validation failed',
          validationErrors: error.validationErrors
        });
      }

      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getPatientDetails(req, res) {
    try {
      const patient = await patientService.getPatientDetails(
        req.user.hospital_id,
        req.params.id
      );

      return res.json(patient);
    } catch (error) {
      console.error('Error fetching patient details:', error);
      
      if (error.message === 'Patient not found') {
        return res.status(404).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async updatePatientDetails(req, res) {
    try {
      if (!req.body || !Object.keys(req.body).length) {
        return res.status(400).json({ 
          error: 'Validation failed',
          message: 'Update data is required'
        });
      }

      const updatedPatient = await patientService.updatePatientDetails(
        req.user.hospital_id,
        req.params.id,
        req.body
      );

      return res.json({
        message: 'Patient updated successfully',
        patient: updatedPatient
      });
    } catch (error) {
      console.error('Error updating patient:', error);

      if (error.message === 'Patient not found') {
        return res.status(404).json({ error: error.message });
      }

      if (error.message === 'Another patient with this email or phone number already exists in this hospital') {
        return res.status(409).json({ error: error.message });
      }

      if (error.validationErrors) {
        return res.status(400).json({
          error: 'Validation failed',
          validationErrors: error.validationErrors
        });
      }

      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async searchPatients(req, res) {
    try {
      const { filters = {}, page = 1, limit = 10 } = req.query;

      const result = await patientService.searchPatients(
        req.user.hospital_id,
        filters,
        { page: parseInt(page), limit: parseInt(limit) }
      );

      return res.json(result);
    } catch (error) {
      console.error('Error searching patients:', error);

      if (error.validationErrors) {
        return res.status(400).json({
          error: 'Invalid filters',
          validationErrors: error.validationErrors
        });
      }

      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async deletePatient(req, res) {
    try {
      await patientService.deletePatient(
        req.user.hospital_id,
        req.params.id
      );

      return res.json({
        message: 'Patient deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting patient:', error);

      if (error.message === 'Patient not found') {
        return res.status(404).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new PatientController();