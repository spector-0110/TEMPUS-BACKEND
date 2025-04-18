const hospitalService = require('./hospital.service');
const formService = require('../../services/form.service');

class HospitalController {
  constructor() {
    // Bind all methods to ensure correct 'this' context
    this.createHospital = this.createHospital.bind(this);
    this.getHospitalDetails = this.getHospitalDetails.bind(this);
    this.requestEditVerification = this.requestEditVerification.bind(this);
    this.verifyEditOTP = this.verifyEditOTP.bind(this);
    this.updateHospitalDetails = this.updateHospitalDetails.bind(this);
    this.getDashboardStats = this.getDashboardStats.bind(this);
    this.getFormConfig = this.getFormConfig.bind(this);
    this.updateFormConfig = this.updateFormConfig.bind(this);
    this.resetFormConfig = this.resetFormConfig.bind(this);
  }

  async createHospital(req, res) {
    try {
      const hospital = await hospitalService.createHospital(
        req.user.id,
        req.body,
        req.user.email
      );

      return res.status(201).json({
        message: 'Hospital created successfully',
        hospital
      });
    } catch (error) {
      console.error('Error creating hospital:', error);
      
      if (error.message === 'Subdomain already in use' || 
          error.message === 'Hospital already exists for this user') {
        return res.status(400).json({ error: error.message });
      }
      
      if (error.validationErrors) {
        return res.status(400).json({
          error: 'Validation failed',
          validationErrors: error.validationErrors
        });
      }

      if (error.code === 'P2002') {
        const field = error.meta?.target?.[0] || 'field';
        return res.status(400).json({ 
          error: `A hospital with this ${field} already exists` 
        });
      }

      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getHospitalDetails(req, res) {
    try {
      const hospital = await hospitalService.getHospitalDetails(req.user.hospital_id);
      return res.json(hospital);
    } catch (error) {
      console.error('Error fetching hospital details:', error);
      if (error.message === 'Hospital not found') {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async requestEditVerification(req, res) {
    try {
      await hospitalService.requestEditVerification(req.user.hospital_id);
      return res.json({ message: 'OTP sent successfully' });
    } catch (error) {
      console.error('Error requesting edit verification:', error);
      if (error.message === 'Hospital not found') {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to send OTP' });
    }
  }

  async verifyEditOTP(req, res) {
    try {
      await hospitalService.verifyEditOTP(req.user.hospital_id, req.body.otp);
      return res.json({ message: 'OTP verified successfully' });
    } catch (error) {
      console.error('Error verifying OTP:', error);
      return res.status(400).json({ error: error.message });
    }
  }

  async updateHospitalDetails(req, res) {
    try {
      const updatedHospital = await hospitalService.updateHospitalDetails(
        req.user.hospital_id,
        req.body
      );
      return res.json(updatedHospital);
    } catch (error) {
      console.error('Error updating hospital details:', error);
      
      if (error.message === 'OTP verification required for editing') {
        return res.status(403).json({ error: error.message });
      }

      if (error.message === 'No valid fields to update') {
        return res.status(400).json({ 
          error: error.message,
          allowedFields: ALLOWED_UPDATE_FIELDS
        });
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

  async getDashboardStats(req, res) {
    try {
      const stats = await hospitalService.getDashboardStats(req.user.hospital_id);
      return res.json(stats);
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getFormConfig(req, res) {
    try {
      const config = await formService.getConfig();
      if (!config) {
        return res.status(404).json({ 
          error: 'Form configuration not found',
          message: 'Using default configuration'
        });
      }
      return res.json(config);
    } catch (error) {
      console.error('Error fetching form config:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch form configuration',
        message: error.message 
      });
    }
  }

  async updateFormConfig(req, res) {
    try {
      const newConfig = req.body;
      
      if (!newConfig || !Object.keys(newConfig).length) {
        return res.status(400).json({ 
          error: 'Invalid request',
          message: 'Form configuration is required' 
        });
      }

      await formService.updateConfig(newConfig);
      return res.json({ 
        message: 'Form configuration updated successfully',
        config: newConfig 
      });
    } catch (error) {
      console.error('Error updating form config:', error);
      return res.status(error.message.includes('Invalid form') ? 400 : 500).json({ 
        error: error.message.includes('Invalid form') ? 'Validation Error' : 'Failed to update form configuration',
        message: error.message 
      });
    }
  }

  async resetFormConfig(req, res) {
    try {
      await formService.resetToDefault();
      const config = await formService.getConfig();
      return res.json({ 
        message: 'Form configuration reset to default',
        config 
      });
    } catch (error) {
      console.error('Error resetting form config:', error);
      return res.status(500).json({ 
        error: 'Failed to reset form configuration',
        message: error.message 
      });
    }
  }
}

module.exports = new HospitalController();