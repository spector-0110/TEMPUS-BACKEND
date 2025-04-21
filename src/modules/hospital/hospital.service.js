const { prisma } = require('../../services/database.service');
const otpService = require('../../services/otp.service');
const hospitalValidator = require('./hospital.validator');
const subscriptionService = require('../subscription/subscription.service');
const messageService = require('../notification/message.service');
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
          address: validatedData.address,
          contactInfo: validatedData.contactInfo,
          logo: validatedData.logo,
          themeColor: validatedData.themeColor || DEFAULT_THEME_COLOR,
          establishedDate: validatedData.establishedDate
        }
      });

      // Initialize with basic subscription
      const subscription = await subscriptionService.createSubscription(hospital.id, 1, 'MONTHLY');

      // Queue welcome email
      await messageService.sendMessage('email',{
        to: userEmail,
        subject: 'Welcome to Tempus',
        hospitalId: hospital.id,
        metadata: {
        subscriptionId: subscription.id,
        emailType: `Welcome${emailType.toLowerCase()}`,
        timestamp: new Date().toISOString()
        },
        content: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563EB;">Welcome to Tempus!</h2>
            <p>Dear Admin,</p>
            <p>Your hospital "${hospital.name}" has been successfully registered with Tempus. Here are your details:</p>
            
            <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
              <p><strong>Hospital Name:</strong> ${hospital.name}</p>
              <p><strong>Subdomain:</strong> ${hospital.subdomain}</p>
              <p><strong>Admin Email:</strong> ${hospital.adminEmail}</p>
              ${hospital.address ? `<p><strong>Address:</strong> ${JSON.stringify(hospital.address)}</p>` : ''}
            </div>

            <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
              <p><strong>Your Initial Subscription Details:</strong></p>
              <ul>
                <li>Doctors Allowed: ${subscription.doctorCount}</li>
                <li>Valid until: ${subscription.endDate.toLocaleDateString()}</li>
              </ul>
              <p><em>You can upgrade your subscription anytime from the dashboard</em></p>
            </div>

            <p>To upgrade your subscription or manage your hospital, visit your hospital dashboard.</p>
          </div>
        `
      });

      return {...hospital, subscription};
    });
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

    // Send OTP via email using message service
    await messageService.sendMessage('email',{
      to: userEmail,
      subject: 'OTP Verification for Hospital Edit',
      hospitalId: hospital.id,
      metadata: {
      timestamp: new Date().toISOString()
      },
      content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563EB;">OTP Verification Required</h2>
          <p>Dear Hospital Administrator,</p>
          <p>Your OTP for editing hospital details is:</p>
          <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0; text-align: center;">
            <h1 style="color: #2563EB; font-size: 32px;">${otp}</h1>
          </div>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you did not request this OTP, please ignore this email.</p>
        </div>
      `,
      metadata: {
        hospitalId,
        type: 'edit_verification_otp'
      }
    });
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

    await messageService.sendMessage('email',{
      to: updatedHospital.adminEmail,
      subject: 'Hospital Details Updated',
      hospitalId: updatedHospital.id,
      metadata: {
      subscriptionId: subscription.id,
      emailType: `Details Update${emailType.toLowerCase()}`,
      timestamp: new Date().toISOString()
      },
      content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563EB;">Welcome to Tempus!</h2>
          <p>Dear Admin,</p>
          <p>Your hospital "${updatedHospital.name}" details has been successfully updated with Tempus. Here are your details:</p>
          
          <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
            <p><strong>Hospital Name:</strong> ${updatedHospital.name}</p>
            <p><strong>Subdomain:</strong> ${updatedHospital.subdomain}</p>
            <p><strong>Admin Email:</strong> ${updatedHospital.adminEmail}</p>
            ${updatedHospital.address ? `<p><strong>Address:</strong> ${JSON.stringify(updatedHospital.address)}</p>` : ''}
          </div>

          <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
            <p><strong>Your Initial Subscription Details:</strong></p>
            <ul>
              <li>Doctors Allowed: ${subscription.doctorCount}</li>
              <li>Valid until: ${subscription.endDate.toLocaleDateString()}</li>
            </ul>
            <p><em>You can upgrade your subscription anytime from the dashboard</em></p>
          </div>

          <p>To upgrade your subscription or manage your hospital, visit your hospital dashboard.</p>
        </div>
      `
    });

    return updatedHospital;
  }

  async getDashboardStats(hospitalId) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const [
      totalAppointments,
      todayAppointments,
      totalDoctors,
      activeDoctors,
      subscription,
      subscriptionHistory
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
          status: 'ACTIVE',
          endDate: {
            gt: new Date()
          }
        }
      }),
      prisma.subscriptionHistory.findMany({
        where: { hospitalId },
        take: 5,
        orderBy: { createdAt: 'desc' }
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
        expiresAt: subscription.endDate,
        status: subscription.status,
        doctorCount: subscription.doctorCount,
        billingCycle: subscription.billingCycle,
        totalPrice: subscription.totalPrice,
        autoRenew: subscription.autoRenew
      } : null,
      subscriptionHistory: subscriptionHistory.map(sub => ({
        startDate: sub.startDate,
        endDate: sub.endDate,
        status: sub.status,
        doctorCount: sub.doctorCount,
        totalPrice: sub.totalPrice,
        billingCycle: sub.billingCycle
      })),
      licenseWarnings: []
    };

    // Add warnings if needed
    if (subscription) {
      // Check if approaching doctor limit
      if (totalDoctors >= subscription.doctorCount * DOCTOR_LIMIT_WARNING_THRESHOLD) {
        stats.licenseWarnings.push({
          type: LICENSE_WARNING_TYPES.DOCTOR_LIMIT,
          message: `You are approaching your doctor limit (${totalDoctors}/${subscription.doctorCount})`
        });
      }

      // Check if subscription expires in less than warning threshold days
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