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
        hospitalId,
        type: 'edit_verification_otp',
        timestamp: new Date().toISOString(),
        otp
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
      `
    });
  }

  async verifyEditOTP(hospitalId, otp) {
    if (!otp) {
      throw new Error('OTP is required');
    }

    await otpService.verifyOTP(hospitalId, otp);
  }

  async updateHospitalDetails(hospitalId, updateData) {


  const pickFields=(source, fields) => {
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
  
  // Invalidate dashboard cache to reflect the updated hospital details immediately
  const CACHE_KEY = `hospital:dashboard:${hospitalId}`;
  await redisService.invalidateCache(CACHE_KEY);

  return updatedHospital;
}

  async getDashboardStats(hospitalId) {
    // Try to get stats from cache first
    const CACHE_KEY = `hospital:dashboard:${hospitalId}`;
    const CACHE_EXPIRY = 600; // 10 minutes cache
    
    try {
      const cachedStats = await redisService.getCache(CACHE_KEY);
      if (cachedStats) {
        return cachedStats;
      }
    } catch (error) {
      console.error('Error fetching dashboard stats from cache:', error);
      // Continue to fetch from database if cache fails
    }

    try {
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);

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
        }),
        // All doctors with their schedules
        prisma.doctor.findMany({
          where: { hospitalId },
          include: {
            schedules: true
          }
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
        }),
        // Subscription history
        prisma.subscriptionHistory.findMany({
          where: { hospitalId },
          orderBy: { createdAt: 'desc' },
          take: 12 // Last 12 entries
        }),
        // Hospital details
        prisma.hospital.findUnique({
          where: { id: hospitalId }
        }),
      ]);

      // Calculate appointment analytics
      const appointmentAnalytics = {
        volumeTrends: this.calculateAppointmentVolumeTrends(appointments),
        statusDistribution: this.calculateStatusDistribution(appointments),
        doctorPerformance: this.calculateDoctorPerformance(appointments),
        peakHours: this.analyzePeakHours(appointments),
        patientFlow: this.analyzePatientFlow(appointments),
        durationAnalysis: this.analyzeAppointmentDurations(appointments)
      };

      // Calculate revenue analytics
      const revenueAnalytics = {
        paymentStatus: this.calculatePaymentStatusOverview(appointments),
        paymentMethods: this.analyzePaymentMethods(appointments),
        revenueTrends: this.calculateRevenueTrends(appointments),
        doctorRevenue: this.calculateDoctorWiseRevenue(appointments),
        paymentTimeline: this.analyzePaymentTimeline(appointments)
      };

      // Calculate operational analytics
      const operationalAnalytics = {
        doctorUtilization: this.calculateDoctorUtilization(doctors, appointments),
        scheduleEfficiency: this.analyzeScheduleEfficiency(doctors, appointments),
        patientDemographics: this.analyzePatientDemographics(appointments),
        visitNotesCompletion: this.analyzeVisitNotesCompletion(appointments)
      };

      // Calculate subscription analytics
      const subscriptionAnalytics = {
        currentStatus: subscription,
        history: this.analyzeSubscriptionHistory(subscriptionHistory),
        doctorTrends: this.analyzeDoctorCountTrends(subscriptionHistory),
        billingPerformance: this.analyzeBillingCyclePerformance(subscriptionHistory)
      };

      // Calculate patient experience analytics
      const experienceAnalytics = {
        waitTime: this.analyzeWaitTimes(appointments),
        cancellationPatterns: this.analyzeCancellationPatterns(appointments),
        retention: this.calculatePatientRetention(appointments),
        completionRates: this.calculateCompletionRates(appointments)
      };

      const stats = {
        hospitalInfo: hospitalDetails,
        doctors:doctors,
        appointment: appointmentAnalytics,
        revenue: revenueAnalytics,
        operational: operationalAnalytics,
        subscription: subscriptionAnalytics,
        patientExperience: experienceAnalytics
      };

      // Cache the results
      try {
        await redisService.setCache(CACHE_KEY, stats, CACHE_EXPIRY);
      } catch (error) {
        console.error('Error caching dashboard stats:', error);
      }

      return stats;
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      throw new Error('Failed to fetch dashboard statistics');
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
        totalTransactions: 0
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

    return {
      upgrades,
      downgrades,
      renewals,
      totalTransactions: sortedHistory.length,
      latestPlan: sortedHistory[sortedHistory.length - 1],
      subscriptionTimeline: sortedHistory.map(sub => ({
        date: sub.createdAt,
        doctorCount: sub.doctorCount,
        planType: sub.planType
      }))
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
}

module.exports = new HospitalService();