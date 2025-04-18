const { prisma } = require('../../services/database.service');
const otpService = require('../../services/otp.service');
const mailService = require('../../services/mail.service');
const messageProcessor = require('../../queue/messageProcessor');
const hospitalValidator = require('./hospital.validator');
const { 
  ALLOWED_UPDATE_FIELDS, 
  DEFAULT_THEME_COLOR,
  LICENSE_WARNING_TYPES,
  DOCTOR_LIMIT_WARNING_THRESHOLD,
  SUBSCRIPTION_EXPIRY_WARNING_DAYS
} = require('./hospital.constants');

class HospitalService {
  async createHospital(supabaseUserId, hospitalData, userEmail) {
    // Validate using form configuration
    const validationResult = await hospitalValidator.validateFormData(hospitalData);
    
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
    }

    const validatedData = validationResult.transformedData;

    if (await this.hospitalExistsBySupabaseId(supabaseUserId)) {
      throw new Error('Hospital already exists for this user');
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
          adminEmail: userEmail,
          gstin: validatedData.gstin,
          address: addressString,
          contactInfo: validatedData.contactInfo,
          logo: validatedData.logo,
          themeColor: validatedData.themeColor || DEFAULT_THEME_COLOR,
          establishedDate: validatedData.establishedDate
        },
      });

      // Queue welcome email
      await messageProcessor.publishNotification({
        type: 'EMAIL',
        to: userEmail,
        subject: 'Welcome to Tempus',
        content: `Welcome to Tempus! Your hospital ${hospital.name} has been successfully registered.`
      });

      return hospital;
    });

    return newHospital;
  }

  async getHospitalDetails(hospitalId) {
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId }
    });
    
    if (!hospital) {
      throw new Error('Hospital not found');
    }

    return hospital;
  }

  async requestEditVerification(hospitalId) {
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { adminEmail: true }
    });

    if (!hospital) {
      throw new Error('Hospital not found');
    }

    // Generate OTP
    const otp = await otpService.generateOTP(hospitalId);

    // Send OTP via email
    await mailService.sendOTPEmail(hospital.adminEmail, otp, hospitalId);
  }

  async verifyEditOTP(hospitalId, otp) {
    if (!otp) {
      throw new Error('OTP is required');
    }

    await otpService.verifyOTP(hospitalId, otp);
  }

  async updateHospitalDetails(hospitalId, updateData) {
    // Check if user is verified for editing
    const isVerified = await otpService.checkEditVerificationStatus(hospitalId);
    if (!isVerified) {
      throw new Error('OTP verification required for editing');
    }

    // Validate update data using form configuration
    const validationResult = await hospitalValidator.validateFormData(updateData);
    
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
    }

    const validatedData = validationResult.transformedData;

    // Filter allowed fields and format address if present
    const sanitizedData = Object.keys(validatedData)
      .filter(key => ALLOWED_UPDATE_FIELDS.includes(key))
      .reduce((obj, key) => {
        obj[key] = validatedData[key];
        return obj;
      }, {});

    if (Object.keys(sanitizedData).length === 0) {
      throw new Error('No valid fields to update');
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

    return updatedHospital;
  }

  async getDashboardStats(hospitalId) {
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
      prisma.appointment.count({ where: { hospitalId } }),
      prisma.appointment.count({
        where: {
          hospitalId,
          appointmentDate: {
            gte: startOfDay,
            lte: endOfDay
          }
        }
      }),
      prisma.doctor.count({ where: { hospitalId } }),
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

    const stats = {
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
      if (totalDoctors >= subscription.plan.maxDoctors * DOCTOR_LIMIT_WARNING_THRESHOLD) {
        stats.licenseWarnings.push({
          type: LICENSE_WARNING_TYPES.DOCTOR_LIMIT,
          message: `You are approaching your doctor limit (${totalDoctors}/${subscription.plan.maxDoctors})`
        });
      }

      // Check if subscription expires in less than 7 days
      const daysToExpiry = Math.ceil((subscription.endDate - new Date()) / (1000 * 60 * 60 * 24));
      if (daysToExpiry <= SUBSCRIPTION_EXPIRY_WARNING_DAYS) {
        stats.licenseWarnings.push({
          type: LICENSE_WARNING_TYPES.SUBSCRIPTION_EXPIRING,
          message: `Your subscription expires in ${daysToExpiry} days`
        });
      }
    }

    return stats;
  }

  async hospitalExistsBySupabaseId(supabaseUserId) {
    const hospital = await prisma.hospital.findUnique({
      where: { supabaseUserId },
      select: { id: true }
    });
    return Boolean(hospital);
  }
}

module.exports = new HospitalService();