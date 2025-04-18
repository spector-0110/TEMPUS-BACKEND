const { prisma } = require('../services/database.service');
const otpService = require('../services/otp.service');
const mailService = require('../services/mail.service');
const messageProcessor = require('../queue/messageProcessor');
const formService = require('../services/form.service');

class HospitalController {
  constructor() {
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

  async validateFormData(data) {
    const formConfig = await formService.getConfig();
    const errors = [];
    const transformedData = { ...data };

    // Iterate through sections and validate each field
    for (const section of formConfig.sections) {
      for (const field of section.fields) {
        const value = this.getNestedValue(data, field.id);
        
        // Skip validation if field is not required and value is not provided
        if (!field.required && (value === undefined || value === null || value === '')) {
          continue;
        }

        const validationResult = await formService.validateFieldValue(field, value);
        
        if (!validationResult.isValid) {
          errors.push({
            field: field.id,
            label: field.label,
            errors: validationResult.errors
          });
        } else if (validationResult.transformedValue !== undefined) {
          // Update the data with transformed value
          this.setNestedValue(transformedData, field.id, validationResult.transformedValue);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      transformedData
    };
  }

  // Helper to get nested object value by path
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => 
      current ? current[key] : undefined, obj);
  }

  // Helper to set nested object value by path
  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((current, key) => {
      if (!current[key]) current[key] = {};
      return current[key];
    }, obj);
    target[lastKey] = value;
  }

  // Helper method to validate contact info
  validateContactInfo(contactInfo) {
    const requiredFields = ['phone'];
    const missingFields = requiredFields.filter(field => !contactInfo[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required contact fields: ${missingFields.join(', ')}`);
    }

    // // Validate email format
    // const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // if (!emailRegex.test(contactInfo.email)) {
    //   throw new Error('Invalid email format in contact info');
    // }

    // Validate phone format (basic validation)
    const phoneRegex = /^\+?[\d\s-]{8,}$/;
    if (!phoneRegex.test(contactInfo.phone)) {
      throw new Error('Invalid phone format in contact info');
    }

    return true;
  }

  async hospitalExistsBySupabaseId(supabaseUserId) {
    const hospital = await prisma.hospital.findUnique({
      where: { supabaseUserId :supabaseUserId },
      select: { id: true }
    });
    return Boolean(hospital);
  }

  async createHospital(req, res) {
    try {
      const supabaseUserId = req.user.id;
      const hospitalData = req.body;

      // Validate using form configuration
      const validationResult = await this.validateFormData(hospitalData);
      
      if (!validationResult.isValid) {
        return res.status(400).json({
          error: 'Validation failed',
          validationErrors: validationResult.errors
        });
      }

      // Use validated and transformed data
      const validatedData = validationResult.transformedData;

      if (await this.hospitalExistsBySupabaseId(supabaseUserId)) {
        return res.status(400).json({ error: 'Hospital already exists for this user' });
      }

      // Format address
      const addressObj = validatedData.address || {};
      const addressString = `${addressObj.street}, ${addressObj.city}, ${addressObj.state}, ${addressObj.pincode}`;

      // Use transaction to ensure data consistency
      const newHospital = await prisma.$transaction(async (tx) => {
        // Check unique constraints
        const [existingSubdomain] = await Promise.all([
          tx.hospital.findUnique({
            where: { subdomain: validatedData.subdomain },
            select: { id: true }
          })
        ]);

        if (existingSubdomain) {
          throw new Error('Subdomain already in use');
        }

        // Create hospital record with validated data
        const hospital = await tx.hospital.create({
          data: {
            supabaseUserId,
            name: validatedData.name,
            subdomain: validatedData.subdomain.toLowerCase(),
            adminEmail: req.user.email,
            gstin: validatedData.gstin,
            address: addressString,
            contactInfo: validatedData.contactInfo,
            logo: validatedData.logo,
            themeColor: validatedData.themeColor || '#2563EB',
            establishedDate: validatedData.establishedDate
          },
        });

        // Queue welcome email
        await messageProcessor.publishNotification({
          type: 'EMAIL',
          to: req.user.email,
          subject: 'Welcome to Swasthify',
          content: `Welcome to Swasthify! Your hospital ${hospital.name} has been successfully registered.`
        });

        return hospital;
      });

      return res.status(201).json({
        message: 'Hospital created successfully',
        hospital: newHospital
      });
    } catch (error) {
      console.error('Error creating hospital:', error);
      
      if (error.message === 'Subdomain already in use') {
        return res.status(400).json({ error: error.message });
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
      const hospitalId = req.user.hospital_id;
      const hospital = await prisma.hospital.findUnique({
        where: { id: hospitalId }
      });
      
      if (!hospital) {
        return res.status(404).json({ error: 'Hospital not found' });
      }

      return res.json(hospital);
    } catch (error) {
      console.error('Error fetching hospital details:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async requestEditVerification(req, res) {
    try {
      const hospitalId = req.user.hospital_id;
      const hospital = await prisma.hospital.findUnique({
        where: { id: hospitalId },
        select: { adminEmail: true }
      });

      if (!hospital) {
        return res.status(404).json({ error: 'Hospital not found' });
      }

      // Generate OTP
      const otp = await otpService.generateOTP(hospitalId);

      // Send OTP via email directly instead of using message queue
      await mailService.sendOTPEmail(hospital.adminEmail, otp, hospitalId);

      return res.json({ message: 'OTP sent successfully' });
    } catch (error) {
      console.error('Error requesting edit verification:', error);
      return res.status(500).json({ error: 'Failed to send OTP' });
    }
  }

  async verifyEditOTP(req, res) {
    try {
      const { otp } = req.body;
      const hospitalId = req.user.hospital_id;

      if (!otp) {
        return res.status(400).json({ error: 'OTP is required' });
      }

      await otpService.verifyOTP(hospitalId, otp);
      return res.json({ message: 'OTP verified successfully' });
    } catch (error) {
      console.error('Error verifying OTP:', error);
      return res.status(400).json({ error: error.message });
    }
  }

  async updateHospitalDetails(req, res) {
    try {
      const hospitalId = req.user.hospital_id;
      const updateData = req.body;

      // Check if user is verified for editing
      const isVerified = await otpService.checkEditVerificationStatus(hospitalId);
      if (!isVerified) {
        return res.status(403).json({ error: 'OTP verification required for editing' });
      }

      // Validate update data using form configuration
      const validationResult = await this.validateFormData(updateData);
      
      if (!validationResult.isValid) {
        return res.status(400).json({
          error: 'Validation failed',
          validationErrors: validationResult.errors
        });
      }

      // Use validated and transformed data
      const validatedData = validationResult.transformedData;

      // Filter allowed fields and format address if present
      const allowedFields = ['name', 'address', 'contactInfo', 'logo', 'themeColor', 'gstin', 'establishedDate'];
      const sanitizedData = Object.keys(validatedData)
        .filter(key => allowedFields.includes(key))
        .reduce((obj, key) => {
          obj[key] = validatedData[key];
          return obj;
        }, {});

      if (Object.keys(sanitizedData).length === 0) {
        return res.status(400).json({ 
          error: 'No valid fields to update',
          allowedFields
        });
      }

      // Format address if provided
      if (sanitizedData.address) {
        const addr = sanitizedData.address;
        sanitizedData.address = `${addr.street}, ${addr.city}, ${addr.state}, ${addr.pincode}`;
      }

      // Update hospital details
      const updatedHospital = await prisma.hospital.update({
        where: { id: hospitalId },
        data: sanitizedData
      });

      // Invalidate edit verification status after successful update
      await otpService.invalidateEditVerificationStatus(hospitalId);

      return res.json(updatedHospital);
    } catch (error) {
      console.error('Error updating hospital details:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getDashboardStats(req, res) {
    try {
      const hospitalId = req.user.hospital_id;

      // Get current date for stats
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0));
      const endOfDay = new Date(today.setHours(23, 59, 59, 999));

      const [
        totalAppointments,
        todayAppointments,
        totalDoctors,
        activeDoctors,
        subscription
      ] = await Promise.all([
        prisma.appointment.count({ 
          where: { hospitalId } 
        }),
        prisma.appointment.count({
          where: {
            hospitalId,
            appointmentDate: {
              gte: startOfDay,
              lte: endOfDay
            }
          }
        }),
        prisma.doctor.count({ 
          where: { hospitalId } 
        }),
        prisma.doctor.count({
          where: {
            hospitalId,
            schedules: {
              some: {
                status: 'active'
              }
            }
          }
        }),
        prisma.hospitalSubscription.findFirst({
          where: { 
            hospitalId, 
            status: 'active',
            endDate: {
              gt: new Date()
            }
          },
          include: { 
            plan: {
              select: {
                name: true,
                maxDoctors: true,
                features: true
              }
            }
          }
        })
      ]);

      const response = {
        appointments: {
          total: totalAppointments,
          today: todayAppointments
        },
        doctors: {
          total: totalDoctors,
          active: activeDoctors
        },
        subscription: subscription ? {
          plan: subscription.plan.name,
          expiresAt: subscription.endDate,
          status: subscription.status,
          maxDoctors: subscription.plan.maxDoctors,
          features: subscription.plan.features,
          credits: {
            sms: subscription.smsCredits,
            email: subscription.emailCredits
          }
        } : null,
        licenseWarnings: []
      };

      // Add warnings if needed
      if (subscription) {
        // Check if approaching doctor limit
        if (totalDoctors >= subscription.plan.maxDoctors * 0.8) {
          response.licenseWarnings.push({
            type: 'DOCTOR_LIMIT',
            message: `You are approaching your doctor limit (${totalDoctors}/${subscription.plan.maxDoctors})`
          });
        }

        // Check if subscription expires in less than 7 days
        const daysToExpiry = Math.ceil((subscription.endDate - new Date()) / (1000 * 60 * 60 * 24));
        if (daysToExpiry <= 7) {
          response.licenseWarnings.push({
            type: 'SUBSCRIPTION_EXPIRING',
            message: `Your subscription expires in ${daysToExpiry} days`
          });
        }
      }

      return res.json(response);
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
      
      // Check if config is provided
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