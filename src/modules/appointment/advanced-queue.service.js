const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const TimezoneUtil = require('../../utils/timezone.util');
const trackingUtil = require('../../utils/tracking.util');
const { APPOINTMENT_STATUS } = require('./appointment.constants');

/**
 * Enhanced QueueService for appointment queue management with advanced caching
 * 
 * Features:
 * - Multi-level caching for hospital, doctor, and appointment data
 * - Uses doctor's actual average consultation time from schedule
 * - IST time zone handling for all operations
 * - Efficient cache invalidation logic
 */
class AdvancedQueueService {
  constructor() {
    // Cache configuration
    this.CACHE_TTL = {
      TRACKING: 60,             // 30 seconds for tracking info
      QUEUE_POSITION: 60,       // 60 seconds for queue position
      DOCTOR_SCHEDULE: 600,     // 10 minutes for doctor schedule
      APPOINTMENTS: 600         // 2 minutes for appointment lists
    };
    
    this.CACHE_PREFIX = {
      TRACKING: 'queue:tracking:',
      POSITION: 'queue:position:',
      TIME_SLOT: 'queue:timeslot:',
      DOCTOR_SCHEDULE: 'queue:schedule:',
      DOCTOR_DAY_SCHEDULE: 'queue:day_schedule:'
    };

    // Default values
    this.DEFAULT_CONSULTATION_TIME = 4; // minutes (fallback if no schedule found)
  }

  /**
   * Get cached queue info or compute and cache it
   * @param {string} token - The tracking token
   * @param {boolean} skipCache - Whether to bypass cache
   * @returns {Promise<Object>} Queue information
   */
  async getQueueInfo(token, skipCache = false) {
    const cacheKey = `${this.CACHE_PREFIX.TRACKING}${token}`;
    
    try {
      // Try to get from cache first, unless skipCache is true
      if (!skipCache) {
        const cachedData = await redisService.get(cacheKey);
        if (cachedData) {
          return cachedData;
        }
      }
  
      // If not in cache or skipCache is true, compute it
      const queueInfo = await this._computeQueueInfo(token);
      
      // Cache the result
      await redisService.set(cacheKey, queueInfo, this.CACHE_TTL.TRACKING);
      
      return queueInfo;
    } catch (error) {
      // Log Redis-related errors but allow token verification errors to propagate up
      if (error.message.includes('Redis') || error.message.includes('Circuit breaker')) {
        console.error('Redis error in getQueueInfo:', error);
        
        // If Redis fails, try to compute without using Redis cache
        return await this._computeQueueInfo(token, true);
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Compute queue information without caching
   * @param {string} token - The tracking token
   * @param {boolean} bypassRedis - Whether to bypass Redis operations (used in case of Redis failure)
   * @returns {Promise<Object>} Queue information
   */
  async _computeQueueInfo(token, bypassRedis = false) {
    // Verify and decode the token
    const tokenData = trackingUtil.verifyToken(token);
    
    if (!tokenData || !tokenData.appointmentId || !tokenData.hospitalId || !tokenData.doctorId) {
      throw new Error('Invalid tracking token structure');
    }
    
    const { appointmentId, hospitalId, doctorId } = tokenData;

    // Use a proper cache key format consistent with our cache prefix convention
    const cacheKey = `appointment:${appointmentId}`;

    let appointment;

    const cachedAppointment = await redisService.get(cacheKey);

    if (cachedAppointment) {
      appointment = cachedAppointment;
    } else {
        appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
            doctor: {
            select: {
                id: true,
                name: true,
                specialization: true,
                experience: true,
                qualification: true,
                photo: true
            }
            },
            hospital: {
            select: {
                id: true,
                name: true,
                logo: true,
                contactInfo: true,
                themeColor: true
            }
            }
        }
        });
        
        // Cache the appointment data after retrieving it from the database
        if (appointment) {
          await redisService.set(cacheKey, appointment, this.CACHE_TTL.APPOINTMENTS);
        }
    }

    // Get the current appointment with essential detail
    
    if (!appointment) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }

    // Get queue position and wait time
    const queueInfo = await this.calculateQueuePosition(appointment);
    
    return {
      success: true,
      message: "Appointment and queue information retrieved successfully",
      data: {
        appointment: {
          id: appointment.id,
          patientName: appointment.patientName,
          appointmentDate: appointment.appointmentDate,
          startTime: appointment.startTime,
          status: appointment.status.toLowerCase(),
          paymentStatus: appointment.paymentStatus.toLowerCase()
        },
        doctor: {
          id: appointment.doctor.id,
          name: appointment.doctor.name,
          specialization: appointment.doctor.specialization,
          photo: appointment.doctor.photo
        },
        hospital: {
          id: appointment.hospital.id,
          name: appointment.hospital.name,
          logo: appointment.hospital.logo,
          themeColor: appointment.hospital.themeColor || "#2563EB"
        },
        queue: {
          position: queueInfo.position,
          appointmentsAhead: queueInfo.appointmentsAhead,
          isPatientTurn: queueInfo.position === 1,
          estimatedWaitTime: queueInfo.estimatedWaitTime,
          estimatedWaitTimeIST: queueInfo.estimatedWaitTimeIST,
          queueStatus: queueInfo.queueStatus
        },
        refreshedAt: TimezoneUtil.getIstISOString(TimezoneUtil.getCurrentIst())
      }
    };
  }

  /**
   * Get appointment and queue information by tracking token
   * @param {string} token - The tracking token
   * @param {boolean} skipCache - Whether to bypass cache
   * @returns {Promise<Object>} Complete tracking information
   */
  async getAppointmentByTrackingToken(token, skipCache = false) {
    try {
      // Validate token format first to avoid unnecessary processing
      if (!token || typeof token !== 'string' || token.trim() === '') {
        const error = new Error('Invalid tracking token format');
        error.code = 'INVALID_FORMAT';
        throw error;
      }
      const res= await this.getQueueInfo(token, skipCache);
      console.log('Queue info retrieved successfully:', res);
      
      return res;
    } catch (error) {
      console.error('Error getting appointment by tracking token:', error);
      
      // Preserve original error and add code for better client handling
      const enhancedError = new Error(error.message || 'Invalid or expired tracking token');
      
      // Provide more specific error message and code based on error type
      if (error.name === 'TokenExpiredError') {
        enhancedError.message = 'Your tracking token has expired. Please request a new one.';
        enhancedError.code = 'TOKEN_EXPIRED';
      } else if (error.name === 'JsonWebTokenError') {
        enhancedError.message = 'Invalid tracking token. Please check the link and try again.';
        enhancedError.code = 'INVALID_TOKEN';
      } else if (error.code) {
        enhancedError.code = error.code;
      } else {
        enhancedError.code = 'TOKEN_ERROR';
      }
      
      throw enhancedError;
    }
  }

  /**
   * Get the doctor's schedule for a specific day
   * @param {string} doctorId - The doctor's ID
   * @param {Date|string} appointmentDate - The appointment date (Date object or ISO string)
   * @param {string} hospitalId - The hospital's ID
   * @returns {Promise<Object|null>} Doctor's schedule for that day with avgConsultationTime
   */
  async getDoctorDaySchedule(doctorId, appointmentDate, hospitalId) {
    // Ensure appointmentDate is a valid Date object
    let dateObj;
    try {
      if (!(appointmentDate instanceof Date)) {
        // Convert string to Date if it's not already a Date object
        dateObj = new Date(appointmentDate);
        if (isNaN(dateObj.getTime())) {
          throw new Error('Invalid date format');
        }
      } else {
        dateObj = appointmentDate;
      }
    } catch (error) {
      console.error('Invalid appointmentDate:', appointmentDate, error);
      throw new Error(`Invalid appointment date format: ${appointmentDate}`);
    }

    try {
      // Use get instead of getCache (which doesn't exist in the redisService)
      const cachedStats = await redisService.get(`hospital:dashboard:${hospitalId}`);
      if (cachedStats) {
        const data = typeof cachedStats === 'string' ? JSON.parse(cachedStats) : cachedStats;
        const doctor = data?.doctors?.find((doctor) => doctor.id === doctorId);
        if (doctor && doctor.schedules && Array.isArray(doctor.schedules) && doctor.schedules.length > dateObj.getDay()) {
          const doctorSchedule = doctor.schedules[dateObj.getDay()];
          if (doctorSchedule) {
            const { id, ...doctorScheduleData } = doctorSchedule;
            return doctorScheduleData;
          }
        }
      }
    } catch (error) {
      console.error('Error getting cached hospital dashboard data:', error);
      // Continue to fallback method if cache retrieval fails
    }
    
    const dayOfWeek = dateObj.getDay(); // 0-6, 0 is Sunday
    const dateString = dateObj.toISOString().split('T')[0];
    const cacheKey = `${this.CACHE_PREFIX.DOCTOR_DAY_SCHEDULE}${doctorId}:${dateString}:schedule`;
    
    // Try to get from cache first
    try {
      const cachedSchedule = await redisService.get(cacheKey);
      if (cachedSchedule) {
        // Redis service already parses JSON, no need to parse again
        return cachedSchedule;
      }
    } catch (error) {
      console.warn(`Error retrieving cached schedule for doctor ${doctorId}:`, error.message);
      // Continue to database lookup if cache retrieval fails
    }

    // Query for doctor's schedule for this day of week
    const schedule = await prisma.doctorSchedule.findFirst({
      where: {
        doctorId,
        dayOfWeek,
        status: 'active'
      },
      select: {
        avgConsultationTime: true,
        timeRanges: true,
        status: true
      }
    });

    // Cache the result - redisService.set already handles JSON.stringify
    if (schedule) {
      await redisService.set(cacheKey, schedule, this.CACHE_TTL.DOCTOR_SCHEDULE);
    }
    
    return schedule;
  }

  /**
   * Calculate queue position and wait time for an appointment
   * @param {Object} appointment - The appointment object
   * @returns {Promise<Object>} Queue position information with IST wait time
   */
  async calculateQueuePosition(appointment) {
    // Generate a unique cache key for this appointment's position
    const positionCacheKey = `${this.CACHE_PREFIX.POSITION}${appointment.id}:${appointment.hospitalId}:${appointment.doctorId}`;
    
    // Try to get position from cache first
    const cachedPosition = await redisService.get(positionCacheKey);
    if (cachedPosition) {
      return cachedPosition;
    }
    
    // If not in cache, calculate the position
    const startTime = new Date(appointment.startTime);
    const appointmentDateTime = new Date(appointment.appointmentDate);
    appointmentDateTime.setHours(startTime.getHours(), startTime.getMinutes(), 0, 0);
    
    // Get current time in IST
    const currentTimeIST = TimezoneUtil.getCurrentIst();
    
    // Find all appointments with the same start time
    const sameTimeAppointments = await prisma.appointment.findMany({
      where: {
        hospitalId: appointment.hospitalId,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        startTime: startTime,
        status: {
          in: [APPOINTMENT_STATUS.BOOKED, APPOINTMENT_STATUS.COMPLETED]
        }
      },
      orderBy: [
        // Primary sort: payment timestamp
        { paymentAt: 'asc' },
        // Secondary sort: creation time
        { createdAt: 'asc' }
      ]
    });

    // Find position in queue
    const appointmentIndex = sameTimeAppointments.findIndex(apt => apt.id === appointment.id);
    if (appointmentIndex === -1) {
      throw new Error('Appointment not found in queue');
    }

    const position = appointmentIndex + 1;
    const appointmentsAhead = appointmentIndex;
    
    // Get the doctor's consultation time from their schedule for this day
    let doctorSchedule;
    try {
      doctorSchedule = await this.getDoctorDaySchedule(
        appointment.doctorId, 
        appointment.appointmentDate,
        appointment.hospitalId
      );
    } catch (error) {
      console.warn('Error fetching doctor schedule, using default consultation time:', error.message);
      doctorSchedule = null;
    }
    
    // Calculate estimated wait time using doctor's avg consultation time if available
    const consultationTime = doctorSchedule?.avgConsultationTime || this.DEFAULT_CONSULTATION_TIME;
    
    // Calculate time-based wait estimate based on current time vs. appointment time
    let estimatedWaitTime = 0;
    
    // Convert appointment date and start time to a full datetime in IST for comparison
    // Check if appointment is in the future
    if (currentTimeIST < appointmentDateTime) {
      // Calculate minutes until appointment
      const diffMs = appointmentDateTime.getTime() - currentTimeIST.getTime();
      const diffMinutes = Math.ceil(diffMs / (1000 * 60));
      
      // Add waiting time for patients ahead in queue
      estimatedWaitTime = diffMinutes + (appointmentsAhead * consultationTime);
    } else {
      // If appointment time has already passed, just consider patients ahead
      estimatedWaitTime = appointmentsAhead * consultationTime;
    }

    // Generate IST wait time string (HH:MM format)
    const waitHours = Math.floor(estimatedWaitTime / 60);
    const waitMinutes = estimatedWaitTime % 60;
    let estimatedWaitTimeIST = '';
    
    if (waitHours > 0) {
      estimatedWaitTimeIST += `${waitHours} hour${waitHours > 1 ? 's' : ''}`;
    }
    
    if (waitMinutes > 0) {
      if (waitHours > 0) estimatedWaitTimeIST += ' ';
      estimatedWaitTimeIST += `${waitMinutes} minute${waitMinutes > 1 ? 's' : ''}`;
    }
    
    if (estimatedWaitTimeIST === '') {
      estimatedWaitTimeIST = 'No wait';
    }

    // Generate queue status message
    let queueStatus = 'Your turn is now!';
    if (appointmentsAhead > 0) {
      queueStatus = `${appointmentsAhead} patient${appointmentsAhead > 1 ? 's' : ''} ahead of you`;
    }

    const result = {
      position,
      appointmentsAhead,
      estimatedWaitTime,
      estimatedWaitTimeIST,
      queueStatus,
      isPatientTurn: position === 1
    };

    // Cache the position result - redisService.set already handles JSON.stringify
    await redisService.set(positionCacheKey, result, this.CACHE_TTL.QUEUE_POSITION);

    return result;
  }

  /**
   * Get all appointments in a specific time slot
   * @param {string} hospitalId - Hospital ID
   * @param {string} doctorId - Doctor ID
   * @param {Date} appointmentDate - Appointment date
   * @param {Date} startTime - Start time of the slot
   * @returns {Promise<Array>} List of appointments in the slot
   */
  async getAppointmentsInTimeSlot(hospitalId, doctorId, appointmentDate, startTime) {
    const dateString = appointmentDate.toISOString().split('T')[0];
    const timeString = startTime.toISOString().split('T')[1].substring(0, 5);
    const cacheKey = `${this.CACHE_PREFIX.TIME_SLOT}${hospitalId}:${doctorId}:${dateString}:${timeString}`;
    
    // Try to get from cache first
    try {
      const cachedAppointments = await redisService.get(cacheKey);
      if (cachedAppointments) {
        // Redis service already handles JSON parsing
        return cachedAppointments;
      }
    } catch (error) {
      console.warn('Error retrieving cached appointments:', error.message);
      // Continue to database lookup if cache retrieval fails
    }

    const appointments = await prisma.appointment.findMany({
      where: {
        hospitalId,
        doctorId,
        appointmentDate,
        startTime,
        status: {
          in: [APPOINTMENT_STATUS.BOOKED, APPOINTMENT_STATUS.COMPLETED]
        }
      },
      orderBy: [
        { paymentAt: 'asc' },
        { createdAt: 'asc' }
      ]
    });

    // Cache the result - redisService.set already handles JSON.stringify
    await redisService.set(cacheKey, appointments, this.CACHE_TTL.APPOINTMENTS);
    
    return appointments;
  }

  /**
   * Invalidate all caches related to a specific appointment
   * @param {string} appointmentId - Appointment ID
   * @param {string} hospitalId - Hospital ID
   * @param {string} doctorId - Doctor ID
   * @param {Date} appointmentDate - Appointment date
   * @param {Date} startTime - Appointment start time
   * @returns {Promise<void>}
   */
  async invalidateAppointmentCache(appointmentId, hospitalId, doctorId, appointmentDate, startTime) {
    const dateString = appointmentDate.toISOString().split('T')[0];
    const timeString = startTime ? startTime.toISOString().split('T')[1].substring(0, 5) : '';
    
    // Prepare patterns for deletion
    const patterns = [
      // Individual appointment position cache
      `${this.CACHE_PREFIX.POSITION}${appointmentId}:*`,
      
      // Time slot caches
      `${this.CACHE_PREFIX.TIME_SLOT}${hospitalId}:${doctorId}:${dateString}:${timeString}`,
      
      // Daily schedule cache
      `${this.CACHE_PREFIX.DOCTOR_DAY_SCHEDULE}${doctorId}:${dateString}:*`,
      
      // Count cache for the day
      `${this.CACHE_PREFIX.DOCTOR_DAY_SCHEDULE}${doctorId}:${dateString}:count`
    ];

    // Delete all matching patterns
    await Promise.all(patterns.map(pattern => redisService.deleteByPattern(pattern)));
  }

  /**
   * Invalidate all caches for a specific doctor on a specific date
   * @param {string} hospitalId - Hospital ID
   * @param {string} doctorId - Doctor ID
   * @param {Date} appointmentDate - Appointment date
   * @returns {Promise<void>}
   */
  async invalidateQueueCache(hospitalId, doctorId, appointmentDate) {
    try {
      const dateString = appointmentDate.toISOString().split('T')[0];
      
      // Prepare patterns for deletion
      const patterns = [
        // All tracking tokens for this hospital + doctor
        `${this.CACHE_PREFIX.TRACKING}*${hospitalId}*${doctorId}*`,
        
        // All position caches for appointments with this doctor
        `${this.CACHE_PREFIX.POSITION}*:${hospitalId}:${doctorId}`,
        
        // Time slot caches for this date
        `${this.CACHE_PREFIX.TIME_SLOT}${hospitalId}:${doctorId}:${dateString}:*`,
        
        // Doctor schedule cache
        `${this.CACHE_PREFIX.DOCTOR_DAY_SCHEDULE}${doctorId}:${dateString}:*`
      ];

      // Delete all matching patterns
      await Promise.all(patterns.map(pattern => redisService.deleteByPattern(pattern)));
    } catch (error) {
      console.error('Error invalidating queue cache:', error);
    }
  }

  /**
   * Publish queue update for WebSocket notifications
   * @param {string} hospitalId - Hospital ID
   * @param {string} doctorId - Doctor ID
   * @param {Date} appointmentDate - Appointment date
   * @param {string} reason - Reason for update (optional)
   * @returns {Promise<void>}
   */
  async publishQueueUpdate(hospitalId, doctorId, appointmentDate, reason = 'queue_updated') {
    try {
      // First invalidate cache
      await this.invalidateQueueCache(hospitalId, doctorId, appointmentDate);

      const updateData = {
        hospitalId,
        doctorId,
        date: appointmentDate.toISOString().split('T')[0],
        timestamp: TimezoneUtil.getCurrentIst().toISOString(),
        reason
      };

      // Publish update to Redis for WebSocket service to pick up
      await redisService.publish('queue:updates', updateData);
    } catch (error) {
      console.error('Error publishing queue update:', error);
    }
  }
}

module.exports = new AdvancedQueueService();
