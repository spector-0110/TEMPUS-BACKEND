const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const rabbitmqService = require('../../services/rabbitmq.service');
const messageService = require('../notification/message.service');
const trackingUtil = require('../../utils/tracking.util');
const TimezoneUtil = require('../../utils/timezone.util');
const { APPOINTMENT_STATUS, APPOINTMENT_PAYMENT_STATUS, CACHE, QUEUES ,APPOINTMENT_PAYMENT_METHOD} = require('./appointment.constants');

/**
 * Service layer for appointment-related operations
 */
class AppointmentService {
  /**
   * Create a new appointment
   */
  async createAppointment(appointmentData) {
    try {
      // Create the appointment in database
      const appointment = await prisma.appointment.create({
        data: {
          hospitalId: appointmentData.hospitalId,
          doctorId: appointmentData.doctorId,
          patientName: appointmentData.patientName,
          mobile: appointmentData.mobile,
          age: appointmentData.age,
          appointmentDate: new Date(appointmentData.appointmentDate),
          startTime: appointmentData.startTime ? new Date(`1970-01-01T${appointmentData.startTime}:00`) : null,
          endTime: appointmentData.endTime ? new Date(`1970-01-01T${appointmentData.endTime}:00`) : null,
          status: APPOINTMENT_STATUS.BOOKED,
          paymentStatus: appointmentData.paymentStatus ? appointmentData.paymentStatus : APPOINTMENT_PAYMENT_STATUS.UNPAID,
          paymentMethod: appointmentData.paymentMethod ? appointmentData.paymentMethod : null,
        },
        include: {
          hospital: true,
          doctor: true
        }
      });

      // Cache the appointment
      await this.cacheAppointment(appointment,appointmentData.hospitalId);

      // Generate tracking link
      const trackingLink = this.generateTrackingLink(appointment.id, appointment.hospitalId, appointment.doctorId);
      
      // Publish to the appointment created queue
      await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_CREATED, { appointment });
      
      // Send notification
      await this.sendAppointmentNotification(appointment, trackingLink);
      
      // Return only essential information for user-facing appointment creation
      return {
        id: appointment.id,
        patientName: appointment.patientName,
        mobile: appointment.mobile,
        age: appointment.age,
        appointmentDate: appointment.appointmentDate,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        status: appointment.status,
        paymentStatus: appointment.paymentStatus,
        hospital: {
          name: appointment.hospital.name,
          logo: appointment.hospital.logo,
          address: appointment.hospital.address,
          contactInfo: appointment.hospital.contactInfo,
        },
        doctor: {
          name: appointment.doctor.name,
          specialization: appointment.doctor.specialization,
          qualification: appointment.doctor.qualification,
          experience: appointment.doctor.experience,
          age: appointment.doctor.age,
          photo: appointment.doctor.photo
        },
        trackingLink
      };
    } catch (error) {
      console.error('Error creating appointment:', error);
      throw error;
    }
  }

  /**
   * Update an appointment's status
   */
  async updateAppointmentStatus(appointmentId, status) {
    // Validate the status transition
    if (!Object.values(APPOINTMENT_STATUS).includes(status)) {
      throw new Error(`Invalid appointment status: ${status}`);
    }
    
    // Get current appointment
    const currentAppointment = await this.getAppointmentById(appointmentId);
    
    // Validate status transition
    if (!this.isValidStatusTransition(currentAppointment.status, status)) {
      throw new Error(`Invalid status transition from ${currentAppointment.status} to ${status}`);
    }

    // Update the appointment
    const appointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status },
      include: {
        hospital: true,
        doctor: true
      }
    });
    
    // Update cache
    await this.cacheAppointment(appointment);
    
    // Invalidate tracking caches to ensure fresh queue data
    await this.invalidateTrackingCaches(appointment.hospitalId, appointment.doctorId);
    
    // Publish to the appointment updated queue
    await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_UPDATED, { 
      appointment,
      previousStatus: currentAppointment.status 
    });
    
    return appointment;
  }
  
  /**
   * Update an appointment's payment status and method
   */
  async updatePaymentStatus(appointmentId, paymentStatus, paymentMethod) {
    
    const updateData = {};
    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (paymentMethod) updateData.paymentMethod = paymentMethod;

    // Update the appointment
    const appointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: updateData,
      include: {
        hospital: true,
        doctor: true
      }
    });
    
    // Update cache
    await this.cacheAppointment(appointment);
    
    // Publish to the appointment updated queue
    await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_UPDATED, { 
      appointment,
      paymentStatusUpdated: true
    });
    
    return appointment;
  }
  
  /**
   * Get all appointments with optional filtering
   */
  async getAllAppointments(filters = {}) {
    const { hospitalId, doctorId, date, status } = filters;
    
    // Try to get from cache first if filtering by hospital or doctor
    let cacheKey = null;
    if (hospitalId) {
      cacheKey = `${CACHE.HOSPITAL_APPOINTMENTS_PREFIX}${hospitalId}`;
      if (doctorId) {
        cacheKey += `:${doctorId}`;
      }
      if (date) {
        cacheKey += `:${date}`;
      }
      if (status) {
        cacheKey += `:${status}`;
      }
      
      const cachedAppointments = await redisService.getCache(cacheKey);
      if (cachedAppointments) {
        return cachedAppointments;
      }
    }
    
    // Build query filters
    const where = {};
    if (hospitalId) where.hospitalId = hospitalId;
    if (doctorId) where.doctorId = doctorId;
    if (date) where.appointmentDate = new Date(date);
    if (status) where.status = status;
    
    // Get appointments from database
    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        hospital: {
          select: {
            id: true,
            name: true,
            logo: true
          }
        },
        doctor: {
          select: {
            id: true,
            name: true,
            specialization: true,
            photo: true
          }
        }
      },
      orderBy: [
        { appointmentDate: 'asc' },
        { startTime: 'asc' }
      ]
    });
    
    // Cache results if we have a cache key
    if (cacheKey) {
      await redisService.setCache(cacheKey, appointments, CACHE.LIST_TTL);
    }
    
    return appointments;
  }
  
  /**
   * Get appointment by ID
   */
  async getAppointmentById(appointmentId) {
    // Try to get from cache first
    const cacheKey = `${CACHE.APPOINTMENT_PREFIX}${appointmentId}`;
    const cachedAppointment = await redisService.getCache(cacheKey);
    if (cachedAppointment) {
      return cachedAppointment;
    }
    
    // Get from database
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        hospital: {
          select: {
            id: true,
            name: true,
            logo: true,
            themeColor: true,
            address: true,
            contactInfo: true
          }
        },
        doctor: {
          select: {
            id: true,
            name: true,
            specialization: true,
            photo: true
          }
        }
      }
    });
    
    if (!appointment) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }
    
    // Cache the appointment
    await this.cacheAppointment(appointment);
    
    return appointment;
  }
  
  /**
   * Delete an appointment by ID
   */
  async deleteAppointment(appointmentId) {
    // Get appointment first to ensure it exists and for notifications
    const appointment = await this.getAppointmentById(appointmentId);
    
    // Only allow deletion if appointment is booked and not in the past (using IST)
    if (appointment.status !== APPOINTMENT_STATUS.BOOKED || 
        new Date(appointment.appointmentDate) < TimezoneUtil.getTodayIST()) {
      throw new Error('Cannot delete appointment that is not in booked status or is in the past');
    }
    
    // Delete the appointment
    await prisma.appointment.delete({
      where: { id: appointmentId }
    });
    
    // Clear from cache
    await redisService.deleteCache(`${CACHE.APPOINTMENT_PREFIX}${appointmentId}`);
    
    // Publish to the appointment updated queue
    await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_UPDATED, { 
      appointment,
      deleted: true
    });
    
    return { success: true, message: 'Appointment deleted successfully' };
  }
  
  /**
   * Get appointment and queue information by tracking token
   * @param {string} token - The tracking token
   * @param {boolean} skipCache - Whether to bypass cache and get fresh data
   */
  async getAppointmentByTrackingToken(token, skipCache = false) {
    try {
      // Verify and decode the token
      const { appointmentId, hospitalId, doctorId } = trackingUtil.verifyToken(token);
      
      // Check if we have cached queue data (short TTL for freshness)
      const todayIST = TimezoneUtil.getTodayIST();
      const todayStr = TimezoneUtil.formatDateIST(todayIST, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
      const trackingCacheKey = `tracking:queue:${hospitalId}:${doctorId}:${todayStr}:${appointmentId}`;
      
      if (!skipCache) {
        const cachedTracking = await redisService.getCache(trackingCacheKey);
        
        if (cachedTracking) {
          return cachedTracking;
        }
      }
      
      // Get the current appointment
      const appointment = await this.getAppointmentById(appointmentId);
      
      if (!appointment) {
        throw new Error(`Appointment not found: ${appointmentId}`);
      }
      
      // Get today's appointments for the same doctor to build the queue using IST
      const todayDate = TimezoneUtil.getTodayIST();
      
      // Use a short cache for today's appointments
      const queueCacheKey = `tracking:queue:${hospitalId}:${doctorId}:${todayStr}`;
      let todayAppointments = await redisService.getCache(queueCacheKey);
      
      if (!todayAppointments) {
        todayAppointments = await prisma.appointment.findMany({
          where: {
            hospitalId: hospitalId,
            doctorId: doctorId,
            appointmentDate: todayDate,
            status: {
              in: [APPOINTMENT_STATUS.BOOKED, APPOINTMENT_STATUS.COMPLETED]
            }
          },
          select: {
            id: true,
            patientName: true,
            startTime: true,
            status: true,
            appointmentDate: true
          },
          orderBy: [
            { startTime: 'asc' }
          ]
        });
        
        // Cache for 300  seconds to ensure fresh data but prevent hammering database
        await redisService.setCache(queueCacheKey, todayAppointments, 300);
      }
      
      // Find current appointment position in queue
      let queuePosition = 0;
      let appointmentsAhead = 0;
      let isPatientTurn = false;
      
      const queueInfo = todayAppointments.map((apt, index) => {
        const formattedTime = apt.startTime
          ? TimezoneUtil.formatTimeIST(apt.startTime, { hour: '2-digit', minute: '2-digit', hour12: true })
          : 'Not specified';
          
        if (apt.id === appointmentId) {
          queuePosition = index + 1;
          isPatientTurn = index === 0 && apt.status === APPOINTMENT_STATUS.BOOKED;
        } else if (apt.status === APPOINTMENT_STATUS.BOOKED && queuePosition === 0) {
          appointmentsAhead++;
        }
        
        // Only return the minimal required information
        return {
          isCurrentAppointment: apt.id === appointmentId,
          patientName: apt.id === appointmentId ? apt.patientName : `Patient ${index + 1}`, // Only show full name for own appointment
          time: formattedTime,
          status: apt.status
        };
      });
      
      // Create a simplified appointment response with only necessary info
      const trackingInfo = {
        appointment: {
          id: appointment.id,
          patientName: appointment.patientName,
          appointmentDate: appointment.appointmentDate,
          startTime: appointment.startTime,
          status: appointment.status,
          paymentStatus: appointment.paymentStatus
        },
        doctor: {
          name: appointment.doctor.name,
          specialization: appointment.doctor.specialization,
          photo: appointment.doctor.photo
        },
        hospital: {
          name: appointment.hospital.name,
          logo: appointment.hospital.logo,
          themeColor: appointment.hospital.themeColor || '#2563EB'
        },
        queue: {
          position: queuePosition,
          appointmentsAhead: appointmentsAhead,
          isPatientTurn: isPatientTurn,
          totalAppointmentsToday: todayAppointments.length,
          appointments: queueInfo
        },
        refreshedAt: TimezoneUtil.toISTISOString(TimezoneUtil.getCurrentDateIST())
      };
      
      // Cache the tracking result for 60 seconds
      await redisService.setCache(trackingCacheKey, trackingInfo, 60);
      
      return trackingInfo;
    } catch (error) {
      console.error('Error decoding tracking token:', error);
      throw new Error('Invalid or expired tracking token');
    }
  }
  
  /**
   * Cache an appointment
   */
  async cacheAppointment(appointment,hospitalId) {
    const cacheKey = `${CACHE.APPOINTMENT_PREFIX}${appointment.id}`;

    const cacheDelKey = `${CACHE.HOSPITAL_APPOINTMENTS_PREFIX}today_tomorrow:${hospitalId}`;

    await redisService.setCache(cacheKey, appointment, CACHE.APPOINTMENT_TTL);
    await redisService.deleteCache(cacheDelKey);
    return appointment;
  }
  
  /**
   * Generate a tracking link for an appointment
   */
  generateTrackingLink(appointmentId, hospitalId, doctorId) {
    return trackingUtil.generateTrackingLink(appointmentId, hospitalId, doctorId);
  }
  
  /**
   * Send WhatsApp notification for an appointment
   */
  async sendAppointmentNotification(appointment, trackingLink) {
    try {
      // Format appointment date and time for the message using IST
      const appointmentDate = TimezoneUtil.formatDateIST(appointment.appointmentDate, { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      
      const startTime = appointment.startTime 
        ? TimezoneUtil.formatTimeIST(appointment.startTime, { hour: '2-digit', minute: '2-digit', hour12: true })
        : 'N/A';
      
      // Construct the WhatsApp message
      const message = {
        to: appointment.mobile,
        hospitalId: appointment.hospitalId,
        content: `Thank you for booking an appointment with ${appointment.hospital.name}!

          Your appointment with Dr. ${appointment.doctor.name} is confirmed for ${appointmentDate} at ${startTime}.

          Track your appointment queue status: ${trackingLink}
          • Check your position in the queue
          • See how many patients are ahead of you
          • Get notified when it's your turn
          • View the full day's appointment schedule

          Need to reschedule or cancel? Click the tracking link above.

          We look forward to seeing you!`
        };
      
      // Send WhatsApp message
      const messageId = await messageService.sendMessage('whatsapp', message);
      
      // Also send notification to hospital
      const hospitalMessage = {
        hospitalId: appointment.hospitalId,
        content: `New appointment booked:

        Patient: ${appointment.patientName}
        Doctor: ${appointment.doctor.name}
        Date: ${appointmentDate}
        Time: ${startTime}
        Mobile: ${appointment.mobile}
        Status: ${appointment.status}
        Payment: ${appointment.paymentStatus}`
      };
      
      await messageService.sendMessage('email', {
        to: appointment.hospital.contactInfo?.email || 'admin@hospital.com',
        subject: `New Appointment - ${appointment.patientName}`,
        content: hospitalMessage.content,
        hospitalId: appointment.hospitalId
      });
      
      // Update appointment notification status
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { notificationStatus: 'sent' }
      });
      
      return messageId;
    } catch (error) {
      console.error('Error sending appointment notification:', error);
      // Don't throw - notification failure shouldn't break appointment creation
    }
  }
  
  /**
   * Invalidate tracking caches for a hospital and doctor
   */
  async invalidateTrackingCaches(hospitalId, doctorId) {
    try {
      // Clear any doctor/hospital specific caches using IST
      const todayIST = TimezoneUtil.formatDateIST(TimezoneUtil.getCurrentDateIST(), { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
      const cachePatterns = [
        `tracking:queue:${hospitalId}:${doctorId}:${todayIST}*`
      ];
      
      for (const pattern of cachePatterns) {
        await redisService.deleteByPattern(pattern);
      }
    } catch (error) {
      console.error('Error invalidating tracking caches:', error);
    }
  }
  
  /**
   * Validate if a status transition is allowed~
   */
  isValidStatusTransition(currentStatus, newStatus) {
    // Define allowed status transitions
    const allowedTransitions = {
      [APPOINTMENT_STATUS.BOOKED]: [
        APPOINTMENT_STATUS.COMPLETED,
        APPOINTMENT_STATUS.CANCELLED,
        APPOINTMENT_STATUS.MISSED
      ],
      [APPOINTMENT_STATUS.CANCELLED]: [],
      [APPOINTMENT_STATUS.COMPLETED]: [],
      [APPOINTMENT_STATUS.MISSED]: [
        APPOINTMENT_STATUS.COMPLETED,
        APPOINTMENT_STATUS.CANCELLED
      ]
    };
    
    // Allow transition to same status
    if (currentStatus === newStatus) {
      return true;
    }
    
    // Check if transition is allowed
    return allowedTransitions[currentStatus]?.includes(newStatus) || false;
  }
  
  /**
   * Calculate estimated waiting time based on appointment queue position and doctor's avg consultation time
   * @param {string} hospitalId - Hospital ID
   * @param {string} doctorId - Doctor ID
   * @param {number} appointmentsAhead - Number of appointments ahead in queue
   * @returns {object} Estimated waiting time in minutes
   */
  async calculateEstimatedWaitingTime(hospitalId, doctorId, appointmentsAhead) {
    try {
      // Default consultation time (15 minutes) if doctor's schedule not found
      let avgConsultationTime = 15;
      
      // Get doctor's schedule to find consultation time using IST day of week
      const doctorSchedule = await prisma.doctorSchedule.findFirst({
        where: {
          doctorId: doctorId,
          hospitalId: hospitalId,
          status: 'active',
          dayOfWeek: TimezoneUtil.getCurrentDayOfWeekIST() // Today's day of week in IST
        }
      });
      
      if (doctorSchedule?.avgConsultationTime) {
        avgConsultationTime = doctorSchedule.avgConsultationTime;
      }
      
      // Calculate estimated waiting time
      const estimatedMinutes = appointmentsAhead * avgConsultationTime;
      const waitHours = Math.floor(estimatedMinutes / 60);
      const waitMinutes = estimatedMinutes % 60;
      
      return {
        estimatedMinutes,
        formattedTime: waitHours > 0 ? 
          `${waitHours} hour${waitHours > 1 ? 's' : ''} ${waitMinutes} minute${waitMinutes !== 1 ? 's' : ''}` : 
          `${waitMinutes} minute${waitMinutes !== 1 ? 's' : ''}`
      };
    } catch (error) {
      console.error('Error calculating estimated waiting time:', error);
      return {
        estimatedMinutes: appointmentsAhead * 15, // Default to 15 minutes per appointment
        formattedTime: `${appointmentsAhead * 15} minutes (estimated)`
      };
    }
  }

  /**
   * Get today's and tomorrow's appointments for a hospital
   * @param {string} hospitalId - Hospital ID
   * @returns {object} Object containing today's and tomorrow's appointments
   */
  async getTodayAndTomorrowandPastWeekAppointments(hospitalId) {
    try {
      if (!hospitalId) {
        throw new Error('Hospital ID is required');
      }

      // Cache key for today and tomorrow appointments with 2-minute TTL
      const cacheKey = `${CACHE.HOSPITAL_APPOINTMENTS_PREFIX}today_tomorrow:${hospitalId}`;
      
      // Try to get from cache first
      const cachedAppointments = await redisService.getCache(cacheKey);
      if (cachedAppointments) {
        return cachedAppointments;
      }

      // Get today's date in IST
      const today = TimezoneUtil.getTodayIST();
      
      // Get tomorrow's date in IST
      const tomorrow = TimezoneUtil.getTomorrowIST();
      
      // Get day after tomorrow to create proper range
      const dayAfterTomorrow = TimezoneUtil.getDatePlusDaysIST(2);

      // Fetch both today's and tomorrow's appointments in a single query
      const allAppointments = await prisma.appointment.findMany({
        where: {
          hospitalId: hospitalId,
          appointmentDate: {
            gte: today,
            lt: dayAfterTomorrow
          }
        },
        include: {
          doctor: {
            select: {
              id: true,
              name: true,
              specialization: true,
              photo: true
            }
          }
        },
        orderBy: [
          { appointmentDate: 'asc' },
          { startTime: 'asc' }
        ]
      });

      // Separate today's and tomorrow's appointments
      const todayAppointments = allAppointments.filter(apt => {
        const aptDate = new Date(apt.appointmentDate);
        aptDate.setHours(0, 0, 0, 0);
        return aptDate.getTime() === today.getTime();
      });
      
      const tomorrowAppointments = allAppointments.filter(apt => {
        const aptDate = new Date(apt.appointmentDate);
        aptDate.setHours(0, 0, 0, 0);
        return aptDate.getTime() === tomorrow.getTime();
      });

      const appointmentHistory= await this.getAppointmentHistory(hospitalId, 7);

      const result = {
        today: todayAppointments,
        tomorrow: tomorrowAppointments,
        history: appointmentHistory,
        fetchedAt: TimezoneUtil.toISTISOString(TimezoneUtil.getCurrentDateIST())
      };

      // Cache for 2 minutes (120 seconds)
      await redisService.setCache(cacheKey, result, 120);
      
      return result;

    } catch (error) {
      console.error('Error fetching today and tomorrow appointments:', error);
      throw error;
    }
  }

  /**
   * Get appointment history for the last 30 days for a hospital
   * @param {string} hospitalId - Hospital ID
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {array} Array of appointments from the last 30 days
   */
  async getAppointmentHistory(hospitalId, days = 30) {
    try {
      if (!hospitalId) {
        throw new Error('Hospital ID is required');
      }

      // Cache key for appointment history
      const cacheKey = `${CACHE.HOSPITAL_APPOINTMENTS_PREFIX}history:${hospitalId}:${days}days`;
      
      // Try to get from cache first
      const cachedHistory = await redisService.getCache(cacheKey);
      if (cachedHistory) {
        return cachedHistory;
      }

      // Calculate date range in IST (last N days)
      const endDate = TimezoneUtil.getCurrentDateIST();
      endDate.setDate(endDate.getDate() - 2); // Include today
      endDate.setHours(23, 59, 59, 999); // End of today
      
      const startDate = TimezoneUtil.getCurrentDateIST();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0); // Start of the day N days ago

      // Fetch appointment history
      const appointmentHistory = await prisma.appointment.findMany({
        where: {
          hospitalId: hospitalId,
          appointmentDate: {
            gte: startDate,
            lte: endDate
          }
        },
        include: {
          doctor: {
            select: {
              id: true,
              name: true,
              specialization: true,
              photo: true
            }
          }
        },
        orderBy: [
          { appointmentDate: 'desc' },
          { startTime: 'desc' }
        ]
      });

      // Group appointments by status for summary
      const statusSummary = appointmentHistory.reduce((acc, appointment) => {
        acc[appointment.status] = (acc[appointment.status] || 0) + 1;
        return acc;
      }, {});

      const result = {
        appointments: appointmentHistory,
        summary: {
          total: appointmentHistory.length,
          dateRange: {
            from: startDate.toISOString(),
            to: endDate.toISOString()
          },
          statusBreakdown: statusSummary
        },
        fetchedAt: TimezoneUtil.toISTISOString(TimezoneUtil.getCurrentDateIST())
      };

      // Cache for 5 minutes for history data
      await redisService.setCache(cacheKey, result, 600);

      return result;
    } catch (error) {
      console.error('Error fetching appointment history:', error);
      throw error;
    }
  }
  
  /**
   * Get hospital details by subdomain for appointment booking
   * @param {string} subdomain - Hospital subdomain
   * @returns {object} Hospital details with available doctors and schedules
   */
  async getHospitalDetailsBySubdomainForAppointment(subdomain) {

    try {
      // Cache key for hospital public details
      const cacheKey = `hospital:public:${subdomain}`;
      
      // Try to get from cache first
      const cachedDetails = await redisService.getCache(cacheKey);
      if (cachedDetails) {
        return cachedDetails;
      }

      // Get hospital by subdomain
      const hospital = await prisma.hospital.findUnique({
        where: { subdomain: subdomain },
        select: {
          id: true,
          name: true,
          logo: true,
          address: true,
          contactInfo: true
        }
      });

      if (!hospital) {
        throw new Error('Hospital not found');
      }

      // Get active doctors with their schedules for the next 2 days in IST
      const today = TimezoneUtil.getCurrentDateIST();
      const tomorrow = TimezoneUtil.getTomorrowIST();
      
      const activeDoctors = await prisma.doctor.findMany({
        where: {
          hospitalId: hospital.id,
          status: 'active'
        },
        select: {
          id: true,
          name: true,
          specialization: true,
          qualification: true,
          experience: true,
          photo: true,
          schedules: {
            where: {
              status: 'active',
              dayOfWeek: {
                in: [TimezoneUtil.getDayOfWeekIST(today), TimezoneUtil.getDayOfWeekIST(tomorrow)]
              }
            },
            select: {
              id: true,
              dayOfWeek: true,
              timeRanges: true,
              avgConsultationTime: true,
              status: true
            }
          }
        }
      });

      // Calculate available slots for each doctor for today and tomorrow
      const doctorsWithAvailability = await Promise.all(
        activeDoctors.map(async (doctor) => {
          const availability = await this.calculateDoctorAvailability(hospital.id, doctor.id, doctor.schedules);
          return {
            ...doctor,
            availability
          };
        })
      );

      const result = {
        hospital: {
          id: hospital.id,
          name: hospital.name,
          logo: hospital.logo,
          themeColor: hospital.themeColor || '#2563EB',
          address: hospital.address,
          contactInfo: hospital.contactInfo
        },
        doctors: doctorsWithAvailability,
        fetchedAt: TimezoneUtil.toISTISOString(TimezoneUtil.getCurrentDateIST())
      };

      // Cache for 5 minutes
      await redisService.setCache(cacheKey, result, 300);
      
      return result;
    } catch (error) {
      console.error('Error fetching hospital details by subdomain:', error);
      throw error;
    }
  }

  /**
   * Calculate doctor availability for today and tomorrow
   * @param {string} hospitalId - Hospital ID
   * @param {string} doctorId - Doctor ID
   * @param {array} schedules - Doctor schedules
   * @returns {object} Availability object with today and tomorrow slots
   */
  async calculateDoctorAvailability(hospitalId, doctorId, schedules) {
    try {
      const today = TimezoneUtil.getCurrentDateIST();
      const tomorrow = TimezoneUtil.getTomorrowIST();
      const dayAfterTomorrow = TimezoneUtil.getDatePlusDaysIST(2);
            
      const todaySchedule = schedules.find(s => s.dayOfWeek === TimezoneUtil.getDayOfWeekIST(today));
      const tomorrowSchedule = schedules.find(s => s.dayOfWeek === TimezoneUtil.getDayOfWeekIST(tomorrow));

      // Get existing appointments for today and tomorrow
      // Only consider 'booked' and 'completed' appointments as occupied slots
      // 'cancelled' and 'missed' appointments free up the slots
      const existingAppointments = await prisma.appointment.findMany({
        where: {
          hospitalId,
          doctorId,
          appointmentDate: {
            gte: today,
            lt: dayAfterTomorrow
          },
          status: {
            in: [APPOINTMENT_STATUS.BOOKED] // Only these statuses block slots
          }
        },
        select: {
          appointmentDate: true,
          startTime: true,
          endTime: true,
          status: true
        }
      });


      const todaySlots = todaySchedule ? this.generateAvailableSlots(todaySchedule, today, existingAppointments) : [];
      const tomorrowSlots = tomorrowSchedule ? this.generateAvailableSlots(tomorrowSchedule, tomorrow, existingAppointments) : [];

      // Calculate summary statistics
      const todayAvailable = todaySlots.filter(slot => slot.available).length;
      const tomorrowAvailable = tomorrowSlots.filter(slot => slot.available).length;

      return {
        today: {
          slots: todaySlots,
          totalSlots: todaySlots.length,
          availableSlots: todayAvailable,
          occupiedSlots: todaySlots.length - todayAvailable,
          date: TimezoneUtil.formatDateIST(today, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-'),
          dayName: TimezoneUtil.formatDateIST(today, { weekday: 'long' })
        },
        tomorrow: {
          slots: tomorrowSlots,
          totalSlots: tomorrowSlots.length,
          availableSlots: tomorrowAvailable,
          occupiedSlots: tomorrowSlots.length - tomorrowAvailable,
          date: TimezoneUtil.formatDateIST(tomorrow, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-'),
          dayName: TimezoneUtil.formatDateIST(tomorrow, { weekday: 'long' })
        },
        summary: {
          totalAvailableSlots: todayAvailable + tomorrowAvailable,
          hasAvailability: (todayAvailable + tomorrowAvailable) > 0
        }
      };
    } catch (error) {
      console.error('Error calculating doctor availability:', error);
      return { 
        today: { slots: [], totalSlots: 0, availableSlots: 0, occupiedSlots: 0 }, 
        tomorrow: { slots: [], totalSlots: 0, availableSlots: 0, occupiedSlots: 0 },
        summary: { totalAvailableSlots: 0, hasAvailability: false }
      };
    }
  }

  /**
   * Generate available time slots for a doctor on a specific date
   * @param {object} schedule - Doctor schedule for the day
   * @param {Date} date - Date for which to generate slots
   * @param {array} existingAppointments - Existing appointments (only booked/completed)
   * @returns {array} Array of time slots with availability status
   */
  generateAvailableSlots(schedule, date, existingAppointments) {
    const slots = [];
    const consultationTime = schedule.avgConsultationTime || 5; // Default 5 minutes
    
    // Filter existing appointments for this date
    const dayAppointments = existingAppointments.filter(apt => {
      const aptDate = new Date(apt.appointmentDate);
      aptDate.setHours(0, 0, 0, 0); // Normalize to start of day
      const filterDate = new Date(date);
      filterDate.setHours(0, 0, 0, 0); // Normalize to start of day
      return aptDate.getTime() === filterDate.getTime();
    });

    // Convert existing appointments to occupied time slots
    const occupiedSlots = dayAppointments.map(apt => {
      const startTime = apt.startTime ? new Date(apt.startTime) : null;
      if (!startTime) return null;
      
      return {
        start: `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`,
        end: apt.endTime ? 
          (() => {
            const endTime = new Date(apt.endTime);
            return `${String(endTime.getHours()).padStart(2, '0')}:${String(endTime.getMinutes()).padStart(2, '0')}`;
          })() :
          this.addMinutesToTime(`${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`, consultationTime),
        status: apt.status
      };
    }).filter(slot => slot !== null);

    // Generate slots for each time range in the schedule
    schedule.timeRanges.forEach(range => {
      const startHour = parseInt(range.start.split(':')[0]);
      const startMinute = parseInt(range.start.split(':')[1]);
      const endHour = parseInt(range.end.split(':')[0]);
      const endMinute = parseInt(range.end.split(':')[1]);

      let currentTime = new Date(date);
      currentTime.setHours(startHour, startMinute, 0, 0);
      
      const endTime = new Date(date);
      endTime.setHours(endHour, endMinute, 0, 0);

      // Skip past slots for today using IST
      const nowIST = TimezoneUtil.getCurrentDateIST();
      if (TimezoneUtil.isTodayIST(date) && currentTime <= nowIST) {
        // Round up to next available slot
        const minutesToAdd = consultationTime - (nowIST.getMinutes() % consultationTime);
        currentTime = new Date(nowIST.getTime() + minutesToAdd * 60000);
        currentTime.setSeconds(0, 0);
        
        // If the rounded time is past the schedule end time, skip this range
        if (currentTime >= endTime) {
          return;
        }
      }

      // Generate all slots within the time range
      while (currentTime < endTime) {
        const slotStart = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
        const slotEndTime = new Date(currentTime.getTime() + consultationTime * 60000);
        
        // Skip if slot extends beyond schedule end time
        if (slotEndTime > endTime) {
          break;
        }
        
        // For today's slots, skip if the slot time has already passed
        if (TimezoneUtil.isTodayIST(date)) {
          const nowIST = TimezoneUtil.getCurrentDateIST();
          const slotDateTime = TimezoneUtil.createDateWithTimeIST(date, slotStart);
          
          // Skip slots that have already passed (with a 5-minute buffer)
          if (slotDateTime.getTime() <= nowIST.getTime() + (5 * 60 * 1000)) {
            currentTime.setMinutes(currentTime.getMinutes() + consultationTime);
            continue;
          }
        }
        
        const slotEnd = `${String(slotEndTime.getHours()).padStart(2, '0')}:${String(slotEndTime.getMinutes()).padStart(2, '0')}`;

        // Check if slot is occupied by booked or completed appointments
        const occupiedSlot = occupiedSlots.find(occupied => {
          return (slotStart >= occupied.start && slotStart < occupied.end) ||
                 (slotEnd > occupied.start && slotEnd <= occupied.end) ||
                 (slotStart <= occupied.start && slotEnd >= occupied.end);
        });

        const isAvailable = !occupiedSlot;
        
        // Create slot object with detailed information
        const slot = {
          start: slotStart,
          end: slotEnd,
          available: isAvailable,
          date: TimezoneUtil.formatDateIST(date, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-'),
          timeDisplay: this.formatTimeDisplay(slotStart, slotEnd)
        };

        // Add reason if slot is not available
        if (!isAvailable) {
          slot.reason = occupiedSlot.status === 'booked' ? 'Already booked' : 'Appointment completed';
          slot.blockedBy = occupiedSlot.status;
        }

        slots.push(slot);
        currentTime.setMinutes(currentTime.getMinutes() + consultationTime);
      }
    });

    return slots;
  }

  /**
   * Format time display for user-friendly presentation
   * @param {string} startTime - Start time in HH:MM format
   * @param {string} endTime - End time in HH:MM format
   * @returns {string} Formatted time display
   */
  formatTimeDisplay(startTime, endTime) {
    const formatTime = (time) => {
      const [hours, minutes] = time.split(':').map(Number);
      const date = TimezoneUtil.getCurrentDateIST();
      date.setHours(hours, minutes);
      return TimezoneUtil.formatTimeIST(date, { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: true 
      });
    };

    return `${formatTime(startTime)} - ${formatTime(endTime)}`;
  }

  /**
   * Helper method to add minutes to time string
   * @param {string} timeStr - Time in HH:MM format
   * @param {number} minutes - Minutes to add
   * @returns {string} New time in HH:MM format
   */
  addMinutesToTime(timeStr, minutes) {
    const [hours, mins] = timeStr.split(':').map(Number);
    const date = TimezoneUtil.getCurrentDateIST();
    date.setHours(hours, mins);
    date.setMinutes(date.getMinutes() + minutes);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

}

module.exports = new AppointmentService();