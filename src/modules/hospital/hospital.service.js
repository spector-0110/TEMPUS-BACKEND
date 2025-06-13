const { prisma } = require('../../services/database.service');
const otpService = require('../../services/otp.service');
const hospitalValidator = require('./hospital.validator');
const subscriptionService = require('../subscription/subscription.service');
const messageService = require('../notification/message.service');
const redisService = require('../../services/redis.service');
const { utcToIst, istToUtc } = require('../../utils/timezone.util');
const { 
  ALLOWED_UPDATE_FIELDS, 
  DEFAULT_THEME_COLOR,
  LICENSE_WARNING_TYPES,
  DOCTOR_LIMIT_WARNING_THRESHOLD,
  SUBSCRIPTION_EXPIRY_WARNING_DAYS,
  ALLOWED_ADDRESS_UPDATE_FIELDS,
  ALLOWED_CONTACT_INFO
} = require('./hospital.constants');

class HospitalService {
  
  async createHospital(supabaseUserId, hospitalData, userEmail) {
    try {
      // Validate using form configuration
      const validationResult = await hospitalValidator.validateFormData(hospitalData);
      
      if (!validationResult.isValid) {
        throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
      }

      const validatedData = validationResult.transformedData;

      // Check if hospital already exists
      const hospitalExists = await this.hospitalExistsBySupabaseId(supabaseUserId);
      if (hospitalExists) {
        throw new Error('Hospital already exists for this user');
      }

      // Use transaction to ensure data consistency with increased timeout (15s)
      const newHospital = await prisma.$transaction(
        async (tx) => {
        try {
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
              address: {
                street: validatedData.street,
                city: validatedData.city,
                district: validatedData.district,
                state: validatedData.state,
                pincode: validatedData.pincode,
                country: validatedData.country || 'India'
              },
              contactInfo: {
                phone: validatedData.phone,
                website: validatedData.website || null
              },
              logo: validatedData.logo,
              themeColor: validatedData.themeColor || DEFAULT_THEME_COLOR,
              establishedDate: validatedData.establishedDate
            }
          });

          // Initialize with basic subscription
          const subscription = await subscriptionService.createSubscription(tx, hospital.id, 1, 'MONTHLY');

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
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #2563EB; font-size: 24px; margin-bottom: 10px;">Welcome to Tiqora!</h2>
              
              <p style="font-size: 16px; color: #111827;">Dear Admin,</p>
              
              <p style="font-size: 16px; color: #111827; line-height: 1.6;">
                Your hospital "<strong>${hospital.name}</strong>" has been successfully registered with <strong>Tiqora</strong>. Here are your details:
              </p>
              
              <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin: 20px 0; border: 1px solid #e5e7eb;">
                <p style="margin: 0; font-size: 16px;"><strong>Hospital Name:</strong> ${hospital.name}</p>
                <p style="margin: 5px 0 0 0; font-size: 16px;"><strong>Subdomain:</strong> ${hospital.subdomain}</p>
                <p style="margin: 5px 0 0 0; font-size: 16px;"><strong>Admin Email:</strong> ${hospital.adminEmail}</p>
                
                ${
                  hospital.address ? `
                    <div style="margin-top: 10px;">
                      <p style="margin: 0; font-size: 16px;"><strong>Address:</strong></p>
                      <p style="margin: 5px 0 0 0; font-size: 16px;">
                        ${hospital.address.street},<br>
                        ${hospital.address.district}, ${hospital.address.state} - ${hospital.address.pincode}<br>
                        ${hospital.address.country}
                      </p>
                    </div>
                  ` : ''
                }
              </div>

              <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin: 20px 0; border: 1px solid #e5e7eb;">
                <p style="margin: 0 0 10px 0; font-size: 16px;"><strong>Your Initial Subscription Details:</strong></p>
                <ul style="margin: 0 0 10px 20px; font-size: 16px; padding-left: 20px;">
                  <li>Doctors Allowed: ${subscription.doctorCount}</li>
                  <li>Valid until: ${subscription.endDate.toLocaleDateString()}</li>
                </ul>
                <p style="font-style: italic; color: #6b7280; font-size: 15px;">You can upgrade your subscription anytime from the dashboard.</p>
              </div>

              <p style="font-size: 16px; color: #111827;">To upgrade your subscription or manage your hospital, visit your hospital dashboard.</p>
            </div>
            `
          });

          return {...hospital, subscription};
        } catch (txError) {
          // Log transaction-specific errors
          console.error('Transaction error in createHospital:', txError);
          throw txError; // Re-throw to be caught by the outer try-catch
        }
      }, {
        maxWait: 15000, // Max time to acquire connection (ms)
        timeout: 15000  // Max time for transaction to complete (ms)
      });
      
      return newHospital;
    } catch (error) {
      console.error('Error creating hospital:', error);
      
      // Re-throw validation errors with their specific structure
      if (error.validationErrors) {
        throw error;
      }
      
      // Handle specific error cases
      if (error.message.includes('Subdomain already in use')) {
        throw new Error('The subdomain is already taken. Please choose a different one.');
      }
      
      // Generic error
      throw new Error(`Failed to create hospital: ${error.message}`);
    }
  }

  async getHospitalDetails(hospitalId) {
    try {
      if (!hospitalId) {
        throw new Error('Hospital ID is required');
      }
      
      const hospital = await prisma.hospital.findUnique({
        where: { id: hospitalId }
      });
      
      if (!hospital) {
        throw new Error('Hospital not found');
      }

      return hospital;
    } catch (error) {
      console.error('Error fetching hospital details:', error);
      throw new Error(`Failed to get hospital details: ${error.message}`);
    }
  }

  async requestEditVerification(hospitalId) {
    try {
      if (!hospitalId) {
        throw new Error('Hospital ID is required');
      }
      
      const hospital = await prisma.hospital.findUnique({
        where: { id: hospitalId },
        select: { adminEmail: true, id: true }
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
          hospitalId,
          type: 'edit_verification_otp',
          timestamp: new Date().toISOString(),
          otp
        },
        content: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;">
          <!-- Tiqora Header -->
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #2563EB; font-size: 24px; margin: 0;">Tiqora</h2>
            <p style="color: #6b7280; font-size: 14px; margin-top: 4px;">Smart Hospital CRM & Queue Management</p>
          </div>

          <!-- Email Content -->
          <h3 style="color: #2563EB; font-size: 20px; margin-bottom: 10px;">OTP Verification Required</h3>

          <p style="font-size: 16px; color: #111827;">Dear Hospital Administrator,</p>

          <p style="font-size: 16px; color: #111827;">Your OTP for editing hospital details is:</p>

          <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0; text-align: center; border-radius: 6px;">
            <h1 style="color: #2563EB; font-size: 36px; letter-spacing: 2px;">${otp}</h1>
          </div>

          <p style="font-size: 16px; color: #111827;">This OTP will expire in <strong>5 minutes</strong>.</p>

          <p style="font-size: 15px; color: #6b7280;">If you did not request this OTP, please ignore this email.</p>

          <!-- Footer -->
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="font-size: 13px; color: #9ca3af; text-align: center;">
            Powered by <strong>Tiqora</strong> • Secure Healthcare CRM
          </p>
        </div>
        `
      });
      
      return { success: true, message: 'OTP sent successfully' };
    } catch (error) {
      console.error('Error requesting edit verification:', error);
      
      if (error.message.includes('Hospital not found')) {
        throw new Error('Hospital not found');
      }
      
      if (error.message.includes('OTP generation failed')) {
        throw new Error('Failed to generate OTP. Please try again.');
      }
      
      throw new Error(`Failed to send verification OTP: ${error.message}`);
    }
  }

  async verifyEditOTP(hospitalId, otp) {
    try {
      if (!hospitalId) {
        throw new Error('Hospital ID is required');
      }
      
      if (!otp) {
        throw new Error('OTP is required');
      }

      await otpService.verifyOTP(hospitalId, otp);
      return { success: true, message: 'OTP verified successfully' };
    } catch (error) {
      console.error('Error verifying OTP:', error);
      
      if (error.message.includes('OTP is required')) {
        throw new Error('OTP is required');
      }
      
      if (error.message.includes('Invalid OTP') || error.message.includes('expired')) {
        throw new Error('Invalid or expired OTP. Please request a new one.');
      }
      
      throw new Error(`Failed to verify OTP: ${error.message}`);
    }
  }

  async updateHospitalDetails(hospitalId, updateData) {
    try {
      if (!hospitalId) {
        throw new Error('Hospital ID is required');
      }
      
      if (!updateData || Object.keys(updateData).length === 0) {
        throw new Error('Update data is required');
      }
      
      const pickFields = (source, fields) => {
        return fields.reduce((result, field) => {
          if (source[field] !== undefined) {
            result[field] = source[field];
          }
          return result;
        }, {});
      }
      
      // 1. Check OTP verification
      const isVerified = await otpService.checkEditVerificationStatus(hospitalId);
      if (!isVerified) throw new Error('OTP verification required for editing');

      // 2. Validate input data
      const { isValid, errors, transformedData } = await hospitalValidator.validateFormData(updateData, true);
      if (!isValid) {
        throw Object.assign(new Error('Validation failed'), { validationErrors: errors });
      }

      // 3. Fetch existing hospital data once
      const currentHospital = await prisma.hospital.findUnique({
        where: { id: hospitalId },
        select: { address: true, contactInfo: true, name: true, subdomain: true, adminEmail: true }
      });
      
      if (!currentHospital) {
        throw new Error('Hospital not found');
      }

      const updatedData = { ...transformedData };

      // 4. Merge address updates if needed
      if (ALLOWED_ADDRESS_UPDATE_FIELDS.some(field => field in updateData)) {
        updatedData.address = {
          ...currentHospital.address,
          ...pickFields(transformedData, ALLOWED_ADDRESS_UPDATE_FIELDS)
        };
      }

      // 5. Merge contact info updates if needed
      if (ALLOWED_CONTACT_INFO.some(field => field in updateData)) {
        updatedData.contactInfo = {
          ...currentHospital.contactInfo,
          ...pickFields(transformedData, ALLOWED_CONTACT_INFO)
        };
      }

      // 6. Sanitize final update data
      const sanitizedData = Object.fromEntries(
        Object.entries(updatedData).filter(([key]) => ALLOWED_UPDATE_FIELDS.includes(key))
      );

      if (Object.keys(sanitizedData).length === 0) {
        throw new Error('No valid fields to update');
      }

      // 7. Update hospital
      const updatedHospital = await prisma.hospital.update({
        where: { id: hospitalId },
        data: sanitizedData
      });

      // 8. Invalidate OTP status
      await otpService.invalidateEditVerificationStatus(hospitalId);

      // 9. Send update email
      await messageService.sendMessage('email', {
        to: updatedHospital.adminEmail,
        subject: 'Hospital Details Updated',
        hospitalId: updatedHospital.id,
        metadata: {
          emailType: 'Details Updatehospital',
          timestamp: new Date().toISOString()
        },
        content: `
         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;">
          <!-- Header Branding -->
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #2563EB; font-size: 24px; margin: 0;">Tiqora</h2>
            <p style="color: #6b7280; font-size: 14px; margin-top: 4px;">Smart Hospital CRM & Appointment Management</p>
          </div>

          <!-- Main Content -->
          <h3 style="color: #2563EB; font-size: 20px; margin-bottom: 10px;">Hospital Details Updated</h3>

          <p style="font-size: 16px; color: #111827;">Dear Admin,</p>

          <p style="font-size: 16px; color: #111827; line-height: 1.6;">
            Your hospital "<strong>${updatedHospital.name}</strong>" details have been successfully updated in <strong>Tiqora</strong>. Below are the updated details:
          </p>

          <!-- Info Block -->
          <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin: 20px 0; border: 1px solid #e5e7eb;">
            <p style="margin: 0 0 10px 0; font-size: 16px;"><strong>Hospital Name:</strong> ${updatedHospital.name}</p>
            <p style="margin: 0 0 10px 0; font-size: 16px;"><strong>Subdomain:</strong> ${updatedHospital.subdomain}</p>
            <p style="margin: 0 0 10px 0; font-size: 16px;"><strong>Admin Email:</strong> ${updatedHospital.adminEmail}</p>
            
            ${updatedHospital.address ? `
              <div style="margin-top: 10px;">
                <p style="margin: 0; font-size: 16px;"><strong>Address:</strong></p>
                <p style="margin: 5px 0 0 0; font-size: 16px;">${updatedHospital.address}</p>
              </div>
            ` : ''}
          </div>

          <p style="font-size: 16px; color: #111827;">You can view and manage your hospital settings through the dashboard.</p>

          <!-- Footer -->
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="font-size: 13px; color: #9ca3af; text-align: center;">
            Powered by <strong>Tiqora</strong> • Simplifying Healthcare with Technology
          </p>
        </div>
        `
      });
      
      // Invalidate dashboard cache to reflect the updated hospital details immediately
      const CACHE_KEY = `hospital:dashboard:${hospitalId}`;
      await redisService.invalidateCache(CACHE_KEY);

      return updatedHospital;
    } catch (error) {
      console.error('Error updating hospital details:', error);
      
      // Re-throw validation errors with their specific structure
      if (error.validationErrors) {
        throw error;
      }
      
      // Handle specific cases with clear messages
      if (error.message.includes('OTP verification required')) {
        throw new Error('OTP verification required for editing. Please verify your OTP first.');
      }
      
      if (error.message.includes('No valid fields')) {
        throw new Error('No valid fields to update. Please check the allowed fields.');
      }
      
      if (error.message.includes('Hospital not found')) {
        throw new Error('Hospital not found');
      }
      
      throw new Error(`Failed to update hospital details: ${error.message}`);
    }
  }


  async getDashboardStats(hospitalId) {
    try {
      if (!hospitalId) {
        throw new Error('Hospital ID is required');
      }      
      // Try to get stats from cache first
      const CACHE_KEY = `hospital:dashboard:${hospitalId}`;
      const CACHE_EXPIRY = 600; // 10 minutes cache
      
      try {
        const cachedStats = await redisService.getCache(CACHE_KEY);
        if (cachedStats) {
          return cachedStats;
        }
      } catch (cacheError) {
        console.error('Error fetching dashboard stats from cache:', cacheError);
        // Continue to fetch from database if cache fails
      }

      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);

      // Use Promise.all with individual try/catch blocks for better error handling
      const [
        appointments,
        doctors,
        subscription,
        subscriptionHistory,
        hospitalDetails,
      ] = await Promise.all([
        // All appointments in last 30 days
        prisma.appointment.findMany({
          where: { 
            hospitalId,
            createdAt: {
              gte: thirtyDaysAgo
            }
          },
          include: {
            doctor: {
              select: {
                id: true,
                name: true,
                specialization: true
              }
            }
          }
        }).catch(err => {
          console.error('Error fetching appointments:', err);
          return []; // Return empty array on failure
        }),
        
        // All doctors with their schedules
        prisma.doctor.findMany({
          where: { hospitalId },
          include: {
            schedules: true
          }
        }).catch(err => {
          console.error('Error fetching doctors:', err);
          return []; // Return empty array on failure
        }),
        
        // Current subscription
        prisma.hospitalSubscription.findFirst({
          where: { 
            hospitalId, 
            status: 'ACTIVE',
            endDate: {
              gt: new Date()
            }
          }
        }).catch(err => {
          console.error('Error fetching subscription:', err);
          return null; // Return null on failure
        }),
        
        // Subscription history
        prisma.subscriptionHistory.findMany({
          where: { hospitalId },
          orderBy: { createdAt: 'desc' },
          take: 12 // Last 12 entries
        }).catch(err => {
          console.error('Error fetching subscription history:', err);
          return []; // Return empty array on failure
        }),
        
        // Hospital details
        prisma.hospital.findUnique({
          where: { id: hospitalId }
        }).catch(err => {
          console.error('Error fetching hospital details:', err);
          throw new Error('Hospital not found'); // Critical failure
        }),
      ]);

      // Check if hospital exists
      if (!hospitalDetails) {
        throw new Error('Hospital not found');
      }

      // Calculate analytics with defensive programming
      let appointmentAnalytics = {};
      try {
        appointmentAnalytics = {
          volumeTrends: this.calculateAppointmentVolumeTrends(appointments),
          statusDistribution: this.calculateStatusDistribution(appointments),
          doctorPerformance: this.calculateDoctorPerformance(appointments),
          peakHours: this.analyzePeakHours(appointments),
          patientFlow: this.analyzePatientFlow(appointments),
          durationAnalysis: this.analyzeAppointmentDurations(appointments)
        };
      } catch (analyticsError) {
        console.error('Error calculating appointment analytics:', analyticsError);
        appointmentAnalytics = { error: 'Failed to calculate appointment analytics' };
      }

      // Calculate revenue analytics with defensive programming
      let revenueAnalytics = {};
      try {
        revenueAnalytics = {
          paymentStatus: this.calculatePaymentStatusOverview(appointments),
          paymentMethods: this.analyzePaymentMethods(appointments),
          revenueTrends: this.calculateRevenueTrends(appointments),
          doctorRevenue: this.calculateDoctorWiseRevenue(appointments),
          paymentTimeline: this.analyzePaymentTimeline(appointments)
        };
      } catch (revenueError) {
        console.error('Error calculating revenue analytics:', revenueError);
        revenueAnalytics = { error: 'Failed to calculate revenue analytics' };
      }

      // Calculate operational analytics with defensive programming
      let operationalAnalytics = {};
      try {
        operationalAnalytics = {
          doctorUtilization: this.calculateDoctorUtilization(doctors, appointments),
          scheduleEfficiency: this.analyzeScheduleEfficiency(doctors, appointments),
          patientDemographics: this.analyzePatientDemographics(appointments),
          visitNotesCompletion: this.analyzeVisitNotesCompletion(appointments)
        };
      } catch (operationalError) {
        console.error('Error calculating operational analytics:', operationalError);
        operationalAnalytics = { error: 'Failed to calculate operational analytics' };
      }

      // Calculate subscription analytics with defensive programming
      let subscriptionAnalytics = {};
      try {
        subscriptionAnalytics = {
          currentStatus: subscription,
          history: this.analyzeSubscriptionHistory(subscriptionHistory),
          doctorTrends: this.analyzeDoctorCountTrends(subscriptionHistory),
          billingPerformance: this.analyzeBillingCyclePerformance(subscriptionHistory)
        };
      } catch (subscriptionError) {
        console.error('Error calculating subscription analytics:', subscriptionError);
        subscriptionAnalytics = { error: 'Failed to calculate subscription analytics' };
      }

      // Calculate patient experience analytics with defensive programming
      let experienceAnalytics = {};
      try {
        experienceAnalytics = {
          waitTime: this.analyzeWaitTimes(appointments),
          cancellationPatterns: this.analyzeCancellationPatterns(appointments),
          retention: this.calculatePatientRetention(appointments),
          completionRates: this.calculateCompletionRates(appointments)
        };
      } catch (experienceError) {
        console.error('Error calculating patient experience analytics:', experienceError);
        experienceAnalytics = { error: 'Failed to calculate patient experience analytics' };
      }

      const stats = {
        hospitalInfo: hospitalDetails,
        doctors: doctors,
        appointment: appointmentAnalytics,
        revenue: revenueAnalytics,
        operational: operationalAnalytics,
        subscription: subscriptionAnalytics,
        patientExperience: experienceAnalytics
      };

      // Cache the results
      try {
        await redisService.setCache(CACHE_KEY, stats, CACHE_EXPIRY);
      } catch (cacheError) {
        console.error('Error caching dashboard stats:', cacheError);
        // Non-critical error, continue without caching
      }

      return stats;
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      
      // Handle specific errors
      if (error.message.includes('Hospital not found')) {
        throw new Error('Hospital not found');
      }
      
      if (error.message.includes('Hospital ID is required')) {
        throw new Error('Hospital ID is required');
      }
      
      // Generic error with details for debugging
      throw new Error(`Failed to fetch dashboard statistics: ${error.message}`);
    }
  }

  // Helper methods for analytics calculations
  calculateAppointmentVolumeTrends(appointments) {
    const daily = {};
    const weekly = {};
    const monthly = {};

    appointments.forEach(apt => {
      const date = utcToIst(apt.appointmentDate);
      const dayKey = date.toISOString().split('T')[0];
      const weekKey = `${date.getFullYear()}-W${this.getWeekNumber(date)}`;
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      daily[dayKey] = (daily[dayKey] || 0) + 1;
      weekly[weekKey] = (weekly[weekKey] || 0) + 1;
      monthly[monthKey] = (monthly[monthKey] || 0) + 1;
    });

    return { daily, weekly, monthly };
  }

  calculateStatusDistribution(appointments) {
    return appointments.reduce((acc, apt) => {
      acc[apt.status] = (acc[apt.status] || 0) + 1;
      return acc;
    }, {});
  }

  calculateDoctorPerformance(appointments) {
    const performance = {};
    appointments.forEach(apt => {
      const doctorId = apt.doctorId;
      if (!performance[doctorId]) {
        performance[doctorId] = {
          total: 0,
          completed: 0,
          cancelled: 0,
          doctor: apt.doctor
        };
      }
      performance[doctorId].total++;
      if (apt.status === 'COMPLETED') performance[doctorId].completed++;
      if (apt.status === 'CANCELLED') performance[doctorId].cancelled++;
    });
    return performance;
  }

  analyzePeakHours(appointments) {
    const hourlyDistribution = {};
    const dailyDistribution = {};
    
    appointments.forEach(apt => {
      const date = utcToIst(apt.appointmentDate);
      const hour = date.getHours();
      const day = date.getDay();

      hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
      dailyDistribution[day] = (dailyDistribution[day] || 0) + 1;
    });

    return {
      hourly: hourlyDistribution,
      daily: dailyDistribution
    };
  }

  analyzePatientFlow(appointments) {
    const patientVisits = {};
    appointments.forEach(apt => {
      const mobile = apt.mobile;
      patientVisits[mobile] = (patientVisits[mobile] || 0) + 1;
    });

    const newPatients = Object.values(patientVisits).filter(visits => visits === 1).length;
    const returningPatients = Object.values(patientVisits).filter(visits => visits > 1).length;

    return {
      new: newPatients,
      returning: returningPatients,
      totalPatients: Object.keys(patientVisits).length
    };
  }

  analyzeAppointmentDurations(appointments) {
    const durations = appointments
      .filter(apt => apt.status === 'COMPLETED' && apt.actualStartTime && apt.actualEndTime)
      .map(apt => {
        const scheduled = apt.scheduledDuration || 15; // default 15 minutes
        const actualStart = utcToIst(apt.actualStartTime);
        const actualEnd = utcToIst(apt.actualEndTime);
        const actual = (actualEnd - actualStart) / 60000; // in minutes
        return { scheduled, actual };
      });

    if (durations.length === 0) return { averageScheduled: 15, averageActual: null, variance: null };

    const averageScheduled = durations.reduce((sum, d) => sum + d.scheduled, 0) / durations.length;
    const averageActual = durations.reduce((sum, d) => sum + d.actual, 0) / durations.length;
    const variance = durations.reduce((sum, d) => sum + Math.abs(d.actual - d.scheduled), 0) / durations.length;

    return { averageScheduled, averageActual, variance };
  }

  calculatePaymentStatusOverview(appointments) {
    return appointments.reduce((acc, apt) => {
      acc[apt.paymentStatus] = {
        count: (acc[apt.paymentStatus]?.count || 0) + 1,
        amount: (acc[apt.paymentStatus]?.amount || 0) + (apt.amount || 0)
      };
      return acc;
    }, {});
  }

  analyzePaymentMethods(appointments) {
    return appointments
      .filter(apt => apt.paymentStatus === 'PAID')
      .reduce((acc, apt) => {
        acc[apt.paymentMethod] = {
          count: (acc[apt.paymentMethod]?.count || 0) + 1,
          amount: (acc[apt.paymentMethod]?.amount || 0) + (apt.amount || 0)
        };
        return acc;
      }, {});
  }

  calculateRevenueTrends(appointments) {
    const daily = {};
    const weekly = {};
    const monthly = {};

    appointments
      .filter(apt => apt.paymentStatus === 'PAID')
      .forEach(apt => {
        const date = utcToIst(apt.paymentDate || apt.createdAt);
        const dayKey = date.toISOString().split('T')[0];
        const weekKey = `${date.getFullYear()}-W${this.getWeekNumber(date)}`;
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        daily[dayKey] = (daily[dayKey] || 0) + (apt.amount || 0);
        weekly[weekKey] = (weekly[weekKey] || 0) + (apt.amount || 0);
        monthly[monthKey] = (monthly[monthKey] || 0) + (apt.amount || 0);
      });

    return { daily, weekly, monthly };
  }

  calculateDoctorWiseRevenue(appointments) {
    return appointments
      .filter(apt => apt.paymentStatus === 'PAID')
      .reduce((acc, apt) => {
        const doctorId = apt.doctorId;
        if (!acc[doctorId]) {
          acc[doctorId] = {
            total: 0,
            count: 0,
            doctor: apt.doctor
          };
        }
        acc[doctorId].total += (apt.amount || 0);
        acc[doctorId].count++;
        acc[doctorId].average = acc[doctorId].total / acc[doctorId].count;
        return acc;
      }, {});
  }

  analyzePaymentTimeline(appointments) {
    const timelines = appointments
      .filter(apt => apt.paymentStatus === 'PAID' && apt.paymentDate)
      .map(apt => {
        const bookingToPayment = (new Date(apt.paymentDate) - new Date(apt.createdAt)) / (1000 * 60); // minutes
        return bookingToPayment;
      });

    if (timelines.length === 0) return { average: null, distribution: {} };

    const average = timelines.reduce((sum, time) => sum + time, 0) / timelines.length;
    const distribution = {
      immediate: timelines.filter(t => t <= 5).length,
      within1Hour: timelines.filter(t => t > 5 && t <= 60).length,
      within24Hours: timelines.filter(t => t > 60 && t <= 1440).length,
      after24Hours: timelines.filter(t => t > 1440).length
    };

    return { average, distribution };
  }

  calculateDoctorUtilization(doctors, appointments) {
    const utilization = {};
    
    doctors.forEach(doctor => {
      const doctorAppointments = appointments.filter(apt => apt.doctorId === doctor.id);
      const totalSlots = this.calculateTotalAvailableSlots(doctor.schedules);
      const bookedSlots = doctorAppointments.length;
      const completedAppointments = doctorAppointments.filter(apt => apt.status === 'COMPLETED').length;

      utilization[doctor.id] = {
        doctor: {
          id: doctor.id,
          name: doctor.name,
          specialization: doctor.specialization
        },
        totalSlots,
        bookedSlots,
        completedAppointments,
        utilization: totalSlots ? (bookedSlots / totalSlots) * 100 : 0,
        completionRate: bookedSlots ? (completedAppointments / bookedSlots) * 100 : 0
      };
    });

    return utilization;
  }

  calculateTotalAvailableSlots(schedules) {
    return schedules.reduce((total, schedule) => {
      if (!schedule.timeRanges) return total;
      
      return total + schedule.timeRanges.reduce((slots, range) => {
        const start = new Date(`1970-01-01T${range.start}`);
        const end = new Date(`1970-01-01T${range.end}`);
        const duration = schedule.avgConsultationTime || 15; // default 15 minutes
        return slots + Math.floor((end - start) / (duration * 60000));
      }, 0);
    }, 0);
  }

  analyzeScheduleEfficiency(doctors, appointments) {
    const efficiency = {};
    
    doctors.forEach(doctor => {
      const doctorAppointments = appointments.filter(apt => apt.doctorId === doctor.id);
      const gaps = this.findScheduleGaps(doctor.schedules, doctorAppointments);
      const recommendations = this.generateScheduleRecommendations(doctor.schedules, gaps);

      efficiency[doctor.id] = {
        doctor: {
          id: doctor.id,
          name: doctor.name
        },
        gaps,
        recommendations
      };
    });

    return efficiency;
  }

  findScheduleGaps(schedules, appointments) {
    const appointmentsByDay = appointments.reduce((acc, apt) => {
      const day = utcToIst(apt.appointmentDate).getDay();
      if (!acc[day]) acc[day] = [];
      acc[day].push(apt);
      return acc;
    }, {});

    const gaps = {};
    
    schedules.forEach(schedule => {
      const dayAppointments = appointmentsByDay[schedule.dayOfWeek] || [];
      const timeRanges = schedule.timeRanges || [];
      
      timeRanges.forEach(range => {
        const rangeStart = new Date(`1970-01-01T${range.start}Z`);
        const rangeEnd = new Date(`1970-01-01T${range.end}Z`);
        const duration = schedule.avgConsultationTime || 15;
        
        const slots = Math.floor((rangeEnd - rangeStart) / (duration * 60000));
        const bookedSlots = dayAppointments.filter(apt => {
          const aptTime = utcToIst(apt.startTime);
          return aptTime >= rangeStart && aptTime < rangeEnd;
        }).length;

        if (bookedSlots < slots) {
          gaps[schedule.dayOfWeek] = {
            ...gaps[schedule.dayOfWeek],
            [range.start]: slots - bookedSlots
          };
        }
      });
    });

    return gaps;
  }

  generateScheduleRecommendations(schedules, gaps) {
    const recommendations = [];
    
    // Analyze gaps and generate recommendations
    Object.entries(gaps).forEach(([day, dayGaps]) => {
      Object.entries(dayGaps).forEach(([startTime, emptySlots]) => {
        if (emptySlots > 5) {
          recommendations.push({
            day: parseInt(day),
            startTime,
            suggestion: `Consider reducing schedule duration or increasing marketing for ${emptySlots} empty slots`
          });
        }
      });
    });

    // Analyze schedule distribution
    const scheduledDays = schedules.map(s => s.dayOfWeek);
    if (scheduledDays.length < 5) {
      recommendations.push({
        type: 'coverage',
        suggestion: 'Consider adding more working days to improve availability'
      });
    }

    return recommendations;
  }

  analyzePatientDemographics(appointments) {
    const ageGroups = {
      'Under 18': 0,
      '18-30': 0,
      '31-50': 0,
      '51-70': 0,
      'Over 70': 0
    };

    appointments.forEach(apt => {
      if (!apt.patientAge) return;
      
      if (apt.patientAge < 18) ageGroups['Under 18']++;
      else if (apt.patientAge <= 30) ageGroups['18-30']++;
      else if (apt.patientAge <= 50) ageGroups['31-50']++;
      else if (apt.patientAge <= 70) ageGroups['51-70']++;
      else ageGroups['Over 70']++;
    });

    return {
      ageDistribution: ageGroups,
      total: Object.values(ageGroups).reduce((sum, count) => sum + count, 0)
    };
  }

  analyzeVisitNotesCompletion(appointments) {
    const completedAppointments = appointments.filter(apt => apt.status === 'COMPLETED');
    const withNotes = completedAppointments.filter(apt => apt.visitNotes && apt.visitNotes.length > 0);

    return {
      total: completedAppointments.length,
      withNotes: withNotes.length,
      completionRate: completedAppointments.length ? 
        (withNotes.length / completedAppointments.length) * 100 : 0,
      byDoctor: this.calculateNotesCompletionByDoctor(completedAppointments)
    };
  }

  calculateNotesCompletionByDoctor(appointments) {
    return appointments.reduce((acc, apt) => {
      const doctorId = apt.doctorId;
      if (!acc[doctorId]) {
        acc[doctorId] = {
          total: 0,
          withNotes: 0,
          doctor: apt.doctor
        };
      }
      acc[doctorId].total++;
      if (apt.visitNotes && apt.visitNotes.length > 0) {
        acc[doctorId].withNotes++;
      }
      acc[doctorId].completionRate = (acc[doctorId].withNotes / acc[doctorId].total) * 100;
      return acc;
    }, {});
  }

  analyzeCancellationPatterns(appointments) {
    const cancelledAppointments = appointments.filter(apt => apt.status === 'CANCELLED');
    
    return {
      total: cancelledAppointments.length,
      rate: appointments.length ? (cancelledAppointments.length / appointments.length) * 100 : 0,
      byReason: this.groupCancellationsByReason(cancelledAppointments),
      byTiming: this.analyzeCancellationTiming(cancelledAppointments)
    };
  }

  groupCancellationsByReason(cancelledAppointments) {
    return cancelledAppointments.reduce((acc, apt) => {
      const reason = apt.cancellationReason || 'Not Specified';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
  }

  analyzeCancellationTiming(cancelledAppointments) {
    return cancelledAppointments.reduce((acc, apt) => {
      const appointmentDate = utcToIst(apt.appointmentDate);
      const cancelledAt = utcToIst(apt.cancelledAt);
      const hoursBeforeAppointment = (appointmentDate - cancelledAt) / (1000 * 60 * 60);

      if (hoursBeforeAppointment <= 1) acc.lastHour = (acc.lastHour || 0) + 1;
      else if (hoursBeforeAppointment <= 24) acc.sameDay = (acc.sameDay || 0) + 1;
      else if (hoursBeforeAppointment <= 48) acc.dayBefore = (acc.dayBefore || 0) + 1;
      else acc.earlier = (acc.earlier || 0) + 1;

      return acc;
    }, {});
  }

  calculatePatientRetention(appointments) {
    const patientVisits = {};
    appointments.forEach(apt => {
      const mobile = apt.mobile;
      if (!patientVisits[mobile]) {
        patientVisits[mobile] = {
          visits: 1,
          firstVisit: apt.appointmentDate,
          lastVisit: apt.appointmentDate
        };
      } else {
        patientVisits[mobile].visits++;
        patientVisits[mobile].lastVisit = apt.appointmentDate;
      }
    });

    const returnRate = Object.values(patientVisits).filter(p => p.visits > 1).length / 
                      Object.keys(patientVisits).length * 100;

    return {
      totalPatients: Object.keys(patientVisits).length,
      returnRate,
      visitFrequency: this.calculateVisitFrequency(patientVisits)
    };
  }

  calculateVisitFrequency(patientVisits) {
    return {
      oneVisit: Object.values(patientVisits).filter(p => p.visits === 1).length,
      twoVisits: Object.values(patientVisits).filter(p => p.visits === 2).length,
      threeToFive: Object.values(patientVisits).filter(p => p.visits >= 3 && p.visits <= 5).length,
      moreThanFive: Object.values(patientVisits).filter(p => p.visits > 5).length
    };
  }

  calculateCompletionRates(appointments) {
    const total = appointments.length;
    const completed = appointments.filter(apt => apt.status === 'COMPLETED').length;
    const noShow = appointments.filter(apt => apt.status === 'NO_SHOW').length;
    const cancelled = appointments.filter(apt => apt.status === 'CANCELLED').length;

    return {
      total,
      completed,
      noShow,
      cancelled,
      completionRate: total ? (completed / total) * 100 : 0,
      noShowRate: total ? (noShow / total) * 100 : 0,
      cancellationRate: total ? (cancelled / total) * 100 : 0
    };
  }

  checkSubscriptionWarnings(subscription) {
    const warnings = [];
    
    if (!subscription) {
      return [{
        type: LICENSE_WARNING_TYPES.NO_SUBSCRIPTION,
        message: 'No active subscription found'
      }];
    }

    const today = new Date();
    const endDate = new Date(subscription.endDate);
    const daysUntilExpiry = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

    // Check expiry warning
    if (daysUntilExpiry <= SUBSCRIPTION_EXPIRY_WARNING_DAYS) {
      warnings.push({
        type: LICENSE_WARNING_TYPES.EXPIRING_SOON,
        message: `Subscription expires in ${daysUntilExpiry} days`,
        daysRemaining: daysUntilExpiry
      });
    }

    // Check doctor limit warning
    const doctorLimit = subscription.doctorCount;
    const currentDoctorCount = subscription.currentDoctorCount || 0;
    const limitThreshold = (currentDoctorCount / doctorLimit) * 100;

    if (limitThreshold >= DOCTOR_LIMIT_WARNING_THRESHOLD) {
      warnings.push({
        type: LICENSE_WARNING_TYPES.DOCTOR_LIMIT,
        message: `Doctor limit threshold reached (${Math.round(limitThreshold)}% of ${doctorLimit} doctors)`,
        currentCount: currentDoctorCount,
        limit: doctorLimit,
        usagePercentage: limitThreshold
      });
    }

    return warnings;
  }

  analyzeWaitTimes(appointments) {
    const waitTimes = appointments
      .filter(apt => apt.status === 'COMPLETED' && apt.scheduledStartTime && apt.actualStartTime)
      .map(apt => {
        const scheduledStart = utcToIst(apt.scheduledStartTime);
        const actualStart = utcToIst(apt.actualStartTime);
        return (actualStart - scheduledStart) / (1000 * 60); // Convert to minutes
      });

    if (waitTimes.length === 0) {
      return {
        averageWaitTime: 0,
        maxWaitTime: 0,
        distribution: {
          onTime: 0,
          upto15Min: 0,
          upto30Min: 0,
          moreThan30Min: 0
        }
      };
    }

    const averageWaitTime = waitTimes.reduce((sum, time) => sum + time, 0) / waitTimes.length;
    const maxWaitTime = Math.max(...waitTimes);

    const distribution = {
      onTime: waitTimes.filter(time => time <= 0).length,
      upto15Min: waitTimes.filter(time => time > 0 && time <= 15).length,
      upto30Min: waitTimes.filter(time => time > 15 && time <= 30).length,
      moreThan30Min: waitTimes.filter(time => time > 30).length
    };

    return {
      averageWaitTime,
      maxWaitTime,
      distribution,
      totalSamples: waitTimes.length
    };
  }

  analyzeSubscriptionHistory(subscriptionHistory) {
    if (!subscriptionHistory || subscriptionHistory.length === 0) {
      return {
        upgrades: 0,
        downgrades: 0,
        renewals: 0,
        totalTransactions: 0,
        history: []
      };
    }

    // Sort by date to analyze transitions
    const sortedHistory = [...subscriptionHistory].sort((a, b) => 
      new Date(a.createdAt) - new Date(b.createdAt)
    );

    let upgrades = 0;
    let downgrades = 0;
    let renewals = 0;

    for (let i = 1; i < sortedHistory.length; i++) {
      const prev = sortedHistory[i - 1];
      const curr = sortedHistory[i];

      if (curr.doctorCount > prev.doctorCount) {
        upgrades++;
      } else if (curr.doctorCount < prev.doctorCount) {
        downgrades++;
      } else {
        renewals++;
      }
    }

    const history = sortedHistory.map(sub => ({
      id: sub.id,
      subscriptionId: sub.subscriptionId,
      hospitalId: sub.hospitalId,
      doctorCount: sub.doctorCount,
      billingCycle: sub.billingCycle,
      totalPrice: sub.totalPrice,
      startDate: sub.startDate,
      endDate: sub.endDate,
      paymentStatus: sub.paymentStatus,
      paymentMethod: sub.paymentMethod,
      // Simplified payment details
      paymentDetails: sub.paymentDetails ? {
        id: sub.paymentDetails.id,
        amount: sub.paymentDetails.amount,
        method: sub.paymentDetails.method,
        status: sub.paymentDetails.status,
        email: sub.paymentDetails.email,
        contact: sub.paymentDetails.contact,
      } : null,
      createdAt: sub.createdAt
    }));

    return {
      upgrades,
      downgrades,
      renewals,
      totalTransactions: sortedHistory.length,
      history
    };
  }

  analyzeDoctorCountTrends(subscriptionHistory) {
    if (!subscriptionHistory || subscriptionHistory.length === 0) {
      return {
        trend: 'NO_DATA',
        growth: 0,
        timeline: []
      };
    }

    const sortedHistory = [...subscriptionHistory].sort((a, b) => 
      new Date(a.createdAt) - new Date(b.createdAt)
    );

    const timeline = sortedHistory.map(sub => ({
      date: sub.createdAt,
      doctorCount: sub.doctorCount
    }));

    const firstCount = sortedHistory[0].doctorCount;
    const lastCount = sortedHistory[sortedHistory.length - 1].doctorCount;
    const growth = ((lastCount - firstCount) / firstCount) * 100;

    let trend = 'STABLE';
    if (growth > 10) trend = 'GROWING';
    if (growth < -10) trend = 'DECLINING';

    return {
      trend,
      growth,
      timeline,
      currentCount: lastCount,
      initialCount: firstCount,
      maxCount: Math.max(...sortedHistory.map(s => s.doctorCount)),
      minCount: Math.min(...sortedHistory.map(s => s.doctorCount))
    };
  }

  analyzeBillingCyclePerformance(subscriptionHistory) {
    if (!subscriptionHistory || subscriptionHistory.length === 0) {
      return {
        cycleDistribution: {},
        renewalRate: 0,
        averageCycleDuration: 0
      };
    }

    const cycleDistribution = subscriptionHistory.reduce((acc, sub) => {
      const cycle = sub.billingCycle || 'UNKNOWN';
      acc[cycle] = (acc[cycle] || 0) + 1;
      return acc;
    }, {});

    // Calculate renewal rate
    const totalPossibleRenewals = subscriptionHistory.length - 1;
    const actualRenewals = subscriptionHistory.filter(sub => sub.renewedFromId).length;
    const renewalRate = totalPossibleRenewals > 0 ? 
      (actualRenewals / totalPossibleRenewals) * 100 : 0;

    // Calculate average cycle duration
    const cycleDurations = subscriptionHistory
      .filter(sub => sub.startDate && sub.endDate)
      .map(sub => {
        const start = new Date(sub.startDate);
        const end = new Date(sub.endDate);
        return (end - start) / (1000 * 60 * 60 * 24); // Convert to days
      });

    const averageCycleDuration = cycleDurations.length > 0 ?
      cycleDurations.reduce((sum, duration) => sum + duration, 0) / cycleDurations.length : 0;

    return {
      cycleDistribution,
      renewalRate,
      averageCycleDuration,
      totalSubscriptions: subscriptionHistory.length,
      successfulRenewals: actualRenewals,
      cyclePreference: Object.entries(cycleDistribution)
        .sort(([,a], [,b]) => b - a)[0]?.[0] || 'UNKNOWN'
    };
  }

  // Helper function for week number calculation
  getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  async hospitalExistsBySupabaseId(supabaseUserId) {
    try {
      if (!supabaseUserId) {
        throw new Error('Supabase User ID is required');
      }
      
      const hospital = await prisma.hospital.findUnique({
        where: { supabaseUserId },
        select: { id: true }
      });
      return Boolean(hospital);
    } catch (error) {
      console.error('Error checking if hospital exists by Supabase ID:', error);
      throw new Error(`Failed to check hospital existence: ${error.message}`);
    }
  }

}

module.exports = new HospitalService();