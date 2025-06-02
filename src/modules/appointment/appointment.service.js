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

      console.log('Creating appointment with data:', JSON.stringify(appointmentData, null, 2));
      const appointment = await prisma.appointment.create({
        data: {
          hospitalId: appointmentData.hospitalId,
          doctorId: appointmentData.doctorId,
          patientName: appointmentData.patientName,
          mobile: appointmentData.mobile,
          createdAt:TimezoneUtil.getCurrentIst(),
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
      const trackingLink = trackingUtil.generateTrackingLink(appointment.id, appointment.hospitalId, appointment.doctorId);
      
      // Publish to the appointment created queue with tracking link for notification
      await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_CREATED, { 
        appointment,
        trackingLink
      });
      
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
        new Date(appointment.appointmentDate) < TimezoneUtil.getCurrentIst()) {
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
      const todayIST = TimezoneUtil.getCurrentIst();
      todayIST.setHours(0, 0, 0, 0); // Start of day
      const todayStr = todayIST.toISOString().split('T')[0]; // YYYY-MM-DD format
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
      const todayDate = TimezoneUtil.getCurrentIst();
      todayDate.setHours(0, 0, 0, 0); // Start of day
      
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
          ? new Date(apt.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
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
        refreshedAt: TimezoneUtil.getIstISOString(TimezoneUtil.getCurrentIst())
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

    // Cache the individual appointment
    await redisService.setCache(cacheKey, appointment, CACHE.APPOINTMENT_TTL);
    
    // Invalidate all related caches when appointment data changes
    
    return appointment;
  }


  
  /**
   * Generate a tracking link for an appointment
   */
  generateTrackingLink(appointmentId, hospitalId, doctorId) {
    return trackingUtil.generateTrackingLink(appointmentId, hospitalId, doctorId);
  }
  
  
  /**
   * Invalidate tracking caches for a hospital and doctor
   */
  async invalidateTrackingCaches(hospitalId, doctorId) {
    try {
      // Clear any doctor/hospital specific caches using IST
      const todayIST = TimezoneUtil.getCurrentIst();
      todayIST.setHours(0, 0, 0, 0);
      const todayStr = todayIST.toISOString().split('T')[0]; // YYYY-MM-DD format
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
          dayOfWeek: TimezoneUtil.getCurrentIst().getDay() // Today's day of week in IST (0=Sunday, 6=Saturday)
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

    const cacheKey = `${CACHE.HOSPITAL_APPOINTMENTS_PREFIX}today_tomorrow:${hospitalId}`;

    // Try to get from cache
    const cachedAppointments = await redisService.getCache(cacheKey);
    if (cachedAppointments) {
      return cachedAppointments;
    }

    // Helper to get start of day in IST safely
    const getISTStartOfDay = (date) => {
      const istOffset = 5.5 * 60 * 60000;
      const utcMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
      return new Date(utcMidnight + istOffset);
    };

    const nowIST = TimezoneUtil.getCurrentIst(); // returns IST Date
    const today = getISTStartOfDay(nowIST);
    const tomorrow = getISTStartOfDay(new Date(today.getTime() + 86400000));
    const dayAfterTomorrow = getISTStartOfDay(new Date(tomorrow.getTime() + 86400000));


    // Fetch appointments from today to tomorrow (2-day window)
    const allAppointments = await prisma.appointment.findMany({
      where: {
        hospitalId,
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

    // Match using date string comparison
    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const mapToIST = (appointments) => {
      return appointments.map(apt => ({
        ...apt,
        appointmentDate: (apt.appointmentDate),
        startTime:(apt.startTime),
        endTime: (apt.endTime)
      }));
    };

    const todayAppointments = mapToIST(
      allAppointments.filter(apt =>
        apt.appointmentDate.toISOString().startsWith(todayStr)
      )
    );

    const tomorrowAppointments = mapToIST(
      allAppointments.filter(apt =>
        apt.appointmentDate.toISOString().startsWith(tomorrowStr)
      )
    );
    const appointmentHistory = await this.getAppointmentHistory(hospitalId, 7);

    const result = {
      today: todayAppointments,
      tomorrow: tomorrowAppointments,
      history: appointmentHistory,
      fetchedAt: TimezoneUtil.getIstISOString(TimezoneUtil.getCurrentIst())
    };

    // Cache for 2 minutes
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
      const endDate = TimezoneUtil.getCurrentIst();
      endDate.setDate(endDate.getDate() - 2); // Include today
      endDate.setHours(23, 59, 59, 999); // End of today
      
      const startDate = TimezoneUtil.getCurrentIst();
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
        fetchedAt: TimezoneUtil.getIstISOString(TimezoneUtil.getCurrentIst())
      };

      // Cache for 1 hrs for history data
      await redisService.setCache(cacheKey, result, 3600);

      return result;
    } catch (error) {
      console.error('Error fetching appointment history:', error);
      throw error;
    }
  }
  

  // /**
  //  * Get hospital details by subdomain with doctor availability for appointments
  //  * @param {string} subdomain - The hospital's subdomain
  //  * @returns {Promise<Object>} Hospital details with doctor availability
  //  */

  async getHospitalDetailsBySubdomainForAppointment(subdomain) {
  try {
    const cacheKey = `hospital:public:${subdomain}`;

    // Try to get from cache first
    const cachedDetails = await redisService.getCache(cacheKey);
    if (cachedDetails) {
      return cachedDetails;
    }

    // Fetch hospital details along with active doctors and their schedules
    const hospital = await prisma.hospital.findUnique({
      where: { subdomain },
      select: {
        id: true,
        name: true,
        logo: true,
        themeColor: true,
        address: true,
        contactInfo: true,
        doctors: {
          where: { status: 'active' },
          select: {
            id: true,
            name: true,
            specialization: true,
            qualification: true,
            photo: true,
            schedules: {
              where: { status: 'active' },
              select: {
                dayOfWeek: true,
                timeRanges: true,
                avgConsultationTime: true,
                status: true
              }
            }
          }
        }
      }
    });

    if (!hospital) {
      throw new Error('Hospital not found');
    }

    // Get IST-adjusted start of days for today, tomorrow, and day after
    const getISTStartOfDay = (date) => {
      const istOffset = 5.5 * 60 * 60000;
      const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
      return new Date(utc + istOffset);
    };

    const nowIST = TimezoneUtil.getCurrentIst(); // Should return IST-based Date
    const todayStart = getISTStartOfDay(nowIST);
    const tomorrowStart = getISTStartOfDay(new Date(todayStart.getTime() + 86400000));
    const dayAfterTomorrow = getISTStartOfDay(new Date(tomorrowStart.getTime() + 86400000));

    // Fetch all appointments from today to tomorrow (exclusive of day after)
    const appointments = await prisma.appointment.findMany({
      where: {
        hospitalId: hospital.id,
        appointmentDate: {
          gte: todayStart,
          lt: dayAfterTomorrow
        },
        status: 'booked'
      },
      select: {
        doctorId: true,
        appointmentDate: true,
        startTime: true,
        endTime: true
      }
    });

    // Process each doctor's availability
    const doctorsWithAvailability = await Promise.all(
      hospital.doctors.map(async (doctor) => {
        const todaySchedule = doctor.schedules.find(s => s.dayOfWeek === todayStart.getDay());
        const tomorrowSchedule = doctor.schedules.find(s => s.dayOfWeek === tomorrowStart.getDay());

        const doctorAppointments = appointments.filter(apt => apt.doctorId === doctor.id);
        const todayDateStr = todayStart.toISOString().split('T')[0];
        const tomorrowDateStr = tomorrowStart.toISOString().split('T')[0];

        const todayAppointments = doctorAppointments.filter(apt =>
          apt.appointmentDate.toISOString().startsWith(todayDateStr)
        );
        const tomorrowAppointments = doctorAppointments.filter(apt =>
          apt.appointmentDate.toISOString().startsWith(tomorrowDateStr)
        );

        const availability = {
          today: this.generateSlots(todaySchedule, todayAppointments, todayStart),
          tomorrow: this.generateSlots(tomorrowSchedule, tomorrowAppointments, tomorrowStart),
          summary: {
            totalAvailableSlots: 0,
            hasAvailability: false
          }
        };

        availability.summary.totalAvailableSlots =
          availability.today.availableSlots + availability.tomorrow.availableSlots;
        availability.summary.hasAvailability = availability.summary.totalAvailableSlots > 0;

        return {
          ...doctor,
          availability
        };
      })
    );

    const data = {
      hospital: {
        id: hospital.id,
        name: hospital.name,
        logo: hospital.logo,
        themeColor: hospital.themeColor || '#2563EB',
        address: hospital.address,
        contactInfo: hospital.contactInfo
      },
      doctors: doctorsWithAvailability,
      fetchedAt: TimezoneUtil.getIstISOString(TimezoneUtil.getCurrentIst())
    };

    // Cache for 1 minute
    await redisService.setCache(cacheKey, data, 60);

    console.log('Hospital details with doctor availability cached successfully---------', JSON.stringify(data, null, 2));

    return data;

  } catch (error) {
    console.error('Error getting hospital details by subdomain:', error);
    throw error;
  }
}

// Generate availability slots for a doctor on a given date
  generateSlots = (schedule, dayAppointments, date) => {
    console.log('Generating slots for date----------:', date.toISOString());
    if (!schedule || !schedule.timeRanges || schedule.status !== 'active') {
      return {
        slots: [],
        totalSlots: 0,
        availableSlots: 0,
        occupiedSlots: 0,
        date: date.toISOString().split('T')[0],
        dayName: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date),
      };
    }

    const slots = [];

    // Build a Set of booked slot keys like: "2025-06-02_14:00"
    const bookedSlotSet = new Set(
      dayAppointments.map((apt) => {
        const dateStr = new Date(apt.appointmentDate).toISOString().split('T')[0]; // 'YYYY-MM-DD'
        const timeStr = new Date(apt.startTime).toISOString().split('T')[1].slice(0, 5); // 'HH:mm'
        return `${dateStr}_${timeStr}`;
      })
    );

    for (const range of schedule.timeRanges) {
      let currentTime = new Date(`1970-01-01T${range.start}:00`);
      const endTime = new Date(`1970-01-01T${range.end}:00`);

      while (currentTime < endTime) {
        const slotStart = currentTime.toTimeString().slice(0, 5); // 'HH:mm'
        currentTime = new Date(currentTime.getTime() + schedule.avgConsultationTime * 60000);
        const slotEnd = currentTime.toTimeString().slice(0, 5);

        if (currentTime <= endTime) {
          const dateStr = date.toISOString().split('T')[0]; // 'YYYY-MM-DD'
          const slotKey = `${dateStr}_${slotStart}`;
          const isBooked = bookedSlotSet.has(slotKey);

          slots.push({
            start: slotStart,
            end: slotEnd,
            available: !isBooked,
            date: dateStr,
            timeDisplay: `${slotStart} - ${slotEnd}`,
            reason: isBooked ? 'Already booked' : null,
            blockedBy: isBooked ? 'booked' : null,
          });
        }
      }
    }

    const totalSlots = slots.length;
    const availableSlots = slots.filter((slot) => slot.available).length;

    return {
      slots,
      totalSlots,
      availableSlots,
      occupiedSlots: totalSlots - availableSlots,
      date: date.toISOString().split('T')[0],
      dayName: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date),
    };
  };

}

module.exports = new AppointmentService();