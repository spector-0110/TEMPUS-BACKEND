const { prisma } = require('../services/database.service');
const otpService = require('../services/otp.service');
const mailService = require('../services/mail.service');
const messageProcessor = require('../queue/messageProcessor');

class HospitalController {
  constructor() {
    this.createHospital = this.createHospital.bind(this);
    this.getHospitalDetails = this.getHospitalDetails.bind(this);
    this.requestEditVerification = this.requestEditVerification.bind(this);
    this.verifyEditOTP = this.verifyEditOTP.bind(this);
    this.updateHospitalDetails = this.updateHospitalDetails.bind(this);
    this.getDashboardStats = this.getDashboardStats.bind(this);
  }

  // Helper method to validate contact info
  validateContactInfo(contactInfo) {
    const requiredFields = ['phone', 'email'];
    const missingFields = requiredFields.filter(field => !contactInfo[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required contact fields: ${missingFields.join(', ')}`);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contactInfo.email)) {
      throw new Error('Invalid email format in contact info');
    }

    // Validate phone format (basic validation)
    const phoneRegex = /^\+?[\d\s-]{8,}$/;
    if (!phoneRegex.test(contactInfo.phone)) {
      throw new Error('Invalid phone format in contact info');
    }

    return true;
  }

  async hospitalExistsBySupabaseId(supabaseUserId) {
    const hospital = await prisma.hospital.findUnique({
      where: { supabaseUserId },
      select: { id: true }
    });
    return Boolean(hospital);
  }

  async createHospital(req, res) {
    try {
      const supabaseUserId = req.user.id;
      const hospitalData = req.body;

      if (await this.hospitalExistsBySupabaseId(supabaseUserId)) {
        return res.status(400).json({ error: 'Hospital already exists for this user' });
      }

      // Validate required fields
      const requiredFields = ['name', 'subdomain', 'adminEmail', 'contactInfo'];
      const missingFields = requiredFields.filter(field => !hospitalData[field]);
      if (missingFields.length > 0) {
        return res.status(400).json({ 
          error: 'Missing required fields', 
          fields: missingFields 
        });
      }

      // Validate subdomain format
      const subdomainRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
      if (!subdomainRegex.test(hospitalData.subdomain)) {
        return res.status(400).json({ 
          error: 'Invalid subdomain format. Use only lowercase letters, numbers, and hyphens. Must start and end with alphanumeric.' 
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(hospitalData.adminEmail)) {
        return res.status(400).json({
          error: 'Invalid email format'
        });
      }

      // Validate contact info
      try {
        this.validateContactInfo(hospitalData.contactInfo);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      // Use transaction to ensure data consistency
      const newHospital = await prisma.$transaction(async (tx) => {
        // Check unique constraints within transaction
        const [existingSubdomain, existingEmail] = await Promise.all([
          tx.hospital.findUnique({ 
            where: { subdomain: hospitalData.subdomain },
            select: { id: true }
          }),
          tx.hospital.findUnique({ 
            where: { adminEmail: hospitalData.adminEmail },
            select: { id: true }
          })
        ]);

        if (existingSubdomain) {
          throw new Error('Subdomain already in use');
        }
        if (existingEmail) {
          throw new Error('Admin email already registered');
        }

        // Create hospital record
        const hospital = await tx.hospital.create({
          data: {
            supabaseUserId,
            name: hospitalData.name,
            subdomain: hospitalData.subdomain.toLowerCase(),
            adminEmail: hospitalData.adminEmail.toLowerCase(),
            gstin: hospitalData.gstin,
            address: hospitalData.address,
            contactInfo: hospitalData.contactInfo,
            logo: hospitalData.logo,
            themeColor: hospitalData.themeColor || '#2563EB', // Default theme color
          },
        });

        // Send welcome email through queue
        await messageProcessor.publishNotification({
          type: 'EMAIL',
          to: hospital.adminEmail,
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
      
      // Handle known errors
      if (error.message === 'Subdomain already in use' || 
          error.message === 'Admin email already registered') {
        return res.status(400).json({ error: error.message });
      }
      
      // Handle Prisma unique constraint violations
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

      // Filter allowed fields for update
      const allowedFields = ['name', 'address', 'contactInfo', 'logo', 'themeColor', 'gstin'];
      const sanitizedData = Object.keys(updateData)
        .filter(key => allowedFields.includes(key))
        .reduce((obj, key) => {
          obj[key] = updateData[key];
          return obj;
        }, {});

      if (Object.keys(sanitizedData).length === 0) {
        return res.status(400).json({ 
          error: 'No valid fields to update',
          allowedFields
        });
      }

      // Validate contactInfo if it's being updated
      if (sanitizedData.contactInfo) {
        if (typeof sanitizedData.contactInfo !== 'object') {
          return res.status(400).json({ 
            error: 'contactInfo must be an object'
          });
        }
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
}

module.exports = new HospitalController();