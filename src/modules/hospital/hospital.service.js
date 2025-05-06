const { prisma } = require('../../services/database.service');
const otpService = require('../../services/otp.service');
const hospitalValidator = require('./hospital.validator');
const subscriptionService = require('../subscription/subscription.service');
const messageService = require('../notification/message.service');
const redisService = require('../../services/redis.service');
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
      const subscription = await subscriptionService.createSubscription(tx,hospital.id, 1, 'MONTHLY');

      // Define email type for welcome message
      const emailType = 'Hospital';
      
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
                ${
                  hospital.address ? `
                    <p><strong>Address:</strong></p>
                    <p>
                      ${hospital.address.street},<br>
                      ${hospital.address.district}, ${hospital.address.state} - ${hospital.address.pincode}<br>
                      ${hospital.address.country}
                    </p>
                  ` : ''
                }
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
    await messageService.sendMessage('otp',{
      to: hospital.adminEmail,
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
          <p>This OTP will expire in 5 minutes.</p>
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

    // Define email type for welcome message
    const emailType = 'Hospital';
    
    await messageService.sendMessage('email',{
      to: updatedHospital.adminEmail,
      subject: 'Hospital Details Updated',
      hospitalId: updatedHospital.id,
      metadata: {
      emailType: `Details Update${emailType.toLowerCase()}`,
      timestamp: new Date().toISOString()
      },
      content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563EB;">Hospital Details Updated</h2>
          <p>Dear Admin,</p>
          <p>Your hospital "${updatedHospital.name}" details have been successfully updated in Tempus. Here are your details:</p>
          
          <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
            <p><strong>Hospital Name:</strong> ${updatedHospital.name}</p>
            <p><strong>Subdomain:</strong> ${updatedHospital.subdomain}</p>
            <p><strong>Admin Email:</strong> ${updatedHospital.adminEmail}</p>
            ${updatedHospital.address ? `<p><strong>Address:</strong> ${updatedHospital.address}</p>` : ''}
          </div>

          <p>You can view and manage your hospital settings through the dashboard.</p>
        </div>
      `
    });

    return updatedHospital;
  }

  async getDashboardStats(hospitalId) {
    // Try to get stats from cache first
    const CACHE_KEY = `hospital:dashboard:${hospitalId}`;
    const CACHE_EXPIRY = 5 * 60; // 5 minutes cache
    
    try {
      const cachedStats = await redisService.getCache(CACHE_KEY);
      if (cachedStats) {
        return cachedStats;
      }
    } catch (error) {
      console.error('Error fetching dashboard stats from cache:', error);
      // Continue to fetch from database if cache fails
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    
    // Get tomorrow's date range
    const startOfTomorrow = new Date(startOfDay);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const endOfTomorrow = new Date(startOfTomorrow);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
    
    // Get date for 7 days ago
    const sevenDaysAgo = new Date(startOfDay);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    try {
      const [
        todayAppointments,
        tomorrowAppointments,
        appointmentHistory,
        doctorsList,
        subscription,
        subscriptionHistory,
        hospitalDetails
      ] = await Promise.all([
        // Today's appointment details
        prisma.appointment.findMany({
          where: {
            hospitalId,
            appointmentDate: {
              gte: startOfDay,
              lt: endOfDay
            }
          },
          include: {
            doctor: {
              select: {
                id: true,
                name: true,
                specialization: true,
              }
            }
          },
          orderBy: {
            startTime: 'asc'
          }
        }),
        // Tomorrow's appointment details
        prisma.appointment.findMany({
          where: {
            hospitalId,
            appointmentDate: {
              gte: startOfTomorrow,
              lt: endOfTomorrow
            }
          },
          include: {
            doctor: {
              select: {
                id: true,
                name: true,
                specialization: true,
              }
            }
          },
          orderBy: {
            startTime: 'asc'
          }
        }),
        // Last 7 days appointment history
        prisma.appointment.groupBy({
          by: ['appointmentDate', 'status'],
          where: {
            hospitalId,
            appointmentDate: {
              gte: sevenDaysAgo,
              lte: now
            }
          },
          _count: {
            id: true
          }
        }),
        // All doctor details
        prisma.doctor.findMany({
          where: { hospitalId },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            specialization: true,
            qualification: true,
            experience: true,
            status: true,
            schedules: {
              select: {
                dayOfWeek: true,
                timeRanges: true,
                status: true
              }
            }
          }
        }),
        // Current active subscription
        prisma.hospitalSubscription.findFirst({
          where: { 
            hospitalId, 
            status: 'ACTIVE',
            endDate: {
              gt: new Date()
            }
          }
        }),
        // Subscription history
        prisma.subscriptionHistory.findMany({
          where: { hospitalId },
          orderBy: { createdAt: 'desc' }
        }),
        // Hospital details
        prisma.hospital.findUnique({
          where: { id: hospitalId }
        })
      ]);

      // Process appointment history by date
      const appointmentsByDate = {};
      appointmentHistory.forEach(entry => {
        const dateStr = entry.appointmentDate.toISOString().split('T')[0];
        if (!appointmentsByDate[dateStr]) {
          appointmentsByDate[dateStr] = {
            date: entry.appointmentDate,
            booked: 0,
            completed: 0,
            cancelled: 0,
            missed: 0,
            total: 0
          };
        }
        appointmentsByDate[dateStr][entry.status.toLowerCase()] = entry._count.id;
        appointmentsByDate[dateStr].total += entry._count.id;
      });

      const stats = {
        hospitalInfo: hospitalDetails,
        appointments: {
          upcoming: {
            today: todayAppointments.map(apt => ({
              id: apt.id,
              patientName: apt.patientName,
              time: apt.startTime,
              status: apt.status,
              doctor: apt.doctor ? {
                id: apt.doctor.id,
                name: apt.doctor.name,
                specialization: apt.doctor.specialization
              } : null
            })),
            tomorrow: tomorrowAppointments.map(apt => ({
              id: apt.id,
              patientName: apt.patientName,
              time: apt.startTime,
              status: apt.status,
              doctor: apt.doctor ? {
                id: apt.doctor.id,
                name: apt.doctor.name,
                specialization: apt.doctor.specialization
              } : null
            }))
          },
          history: Object.values(appointmentsByDate).sort((a, b) => 
            new Date(a.date) - new Date(b.date)
          )
        },
        doctors: doctorsList,
        currentSubscription: subscription ? {
          id: subscription.id,
          expiresAt: subscription.endDate,
          status: subscription.status,
          doctorCount: subscription.doctorCount,
          billingCycle: subscription.billingCycle,
          totalPrice: subscription.totalPrice,
          autoRenew: subscription.autoRenew
        } : null,
        subscriptionHistory: subscriptionHistory.map(sub => ({
          id: sub.id,
          startDate: sub.startDate,
          endDate: sub.endDate,
          status: sub.status || 'ACTIVE',
          doctorCount: sub.doctorCount,
          totalPrice: sub.totalPrice,
          billingCycle: sub.billingCycle
        }))
      };

      // Cache the results for better performance
      try {
        await redisService.setCache(CACHE_KEY, stats, CACHE_EXPIRY);
      } catch (error) {
        console.error('Error caching dashboard stats:', error);
        // Continue without caching if it fails
      }

      return stats;
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      throw new Error('Failed to fetch dashboard statistics');
    }
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