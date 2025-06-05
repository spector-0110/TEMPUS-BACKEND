const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const rabbitmqService = require('../../services/rabbitmq.service');
const trackingUtil = require('../../utils/tracking.util');
const TimezoneUtil = require('../../utils/timezone.util');
const { APPOINTMENT_STATUS, APPOINTMENT_PAYMENT_STATUS, CACHE, QUEUES } = require('./appointment.constants');
const queueService = require('./advanced-queue.service');
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
          paymentAt: null,
          hospital: {
            connect: { id: appointmentData.hospitalId }
          },
          doctor: {
            connect: { id: appointmentData.doctorId }
          }
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

    await queueService.publishQueueUpdate(hospitalId, doctorId, appointment.appointmentDate);

    
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
    
    updateData.paymentAt = TimezoneUtil.getCurrentIst(); // Set payment time to current IST time

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

    await queueService.publishQueueUpdate(hospitalId, doctorId, appointment.appointmentDate);
    
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
    if (appointment.status !== APPOINTMENT_STATUS.BOOKED ) {
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
   * Get appointment history for past days for a hospital (excluding today)
   * @param {string} hospitalId - Hospital ID
   * @param {number} days - Number of days to look back, excluding today (default: 7)
   * @returns {object} Object containing appointments and summary from the specified past days
   */
  async getAppointmentHistory(hospitalId, days = 7) {
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

      // Get current IST date using utility
      const nowIST = TimezoneUtil.getCurrentIst();

      const yesterday = new Date(nowIST);
      yesterday.setDate(yesterday.getDate() - 1);
    
      const sevenDaysAgo = new Date(nowIST);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);


      // Query
      const appointmentHistory = await prisma.appointment.findMany({
        where: {
          hospitalId: hospitalId,
          appointmentDate: {
            gte: sevenDaysAgo,
            lte: yesterday,
          },
        },
        include: {
          doctor: {
            select: {
              id: true,
              name: true,
              specialization: true,
              photo: true,
            },
          },
        },
        orderBy: [
          { appointmentDate: 'desc' },
          { startTime: 'desc' },
        ],
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
            from: sevenDaysAgo.toISOString(),
            to: yesterday.toISOString()
          },
          statusBreakdown: statusSummary
        },
        fetchedAt: TimezoneUtil.getIstISOString(TimezoneUtil.getCurrentIst())
      };

      // Cache for 1 hrs for history data
      //await redisService.setCache(cacheKey, result, 3600);

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

    return data;

  } catch (error) {
    console.error('Error getting hospital details by subdomain:', error);
    throw error;
  }
}

// Generate availability slots for a doctor on a given date
  generateSlots = (schedule, dayAppointments, date) => {
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
    const HOUR_IN_MINUTES = 60;
    
    // Create a map of hour slots and their appointments
    const appointmentsByHour = new Map();

    // Group appointments by hour slot
    dayAppointments.forEach((apt) => {
      const dateStr = new Date(apt.appointmentDate).toISOString().split('T')[0];
      const hour = new Date(apt.startTime).getHours();
      const slotKey = `${dateStr}_${String(hour).padStart(2, '0')}:00`;
      
      if (!appointmentsByHour.has(slotKey)) {
        appointmentsByHour.set(slotKey, []);
      }
      appointmentsByHour.get(slotKey).push(apt);
    });

    // Calculate max capacity for a one-hour slot based on avgConsultationTime
    const slotMaxCapacity = Math.floor(HOUR_IN_MINUTES / schedule.avgConsultationTime);

    for (const range of schedule.timeRanges) {
      let currentTime = new Date(`1970-01-01T${range.start}:00`);
      const endTime = new Date(`1970-01-01T${range.end}:00`);

      while (currentTime < endTime) {
        const slotStart = currentTime.toTimeString().slice(0, 5);
        const nextHour = new Date(currentTime.getTime() + HOUR_IN_MINUTES * 60000);
        const slotEnd = nextHour <= endTime ? 
          nextHour.toTimeString().slice(0, 5) : 
          range.end;

        const dateStr = date.toISOString().split('T')[0];
        const slotKey = `${dateStr}_${slotStart}`;
        
        // Get appointments in this slot
        const appointmentsInSlot = appointmentsByHour.get(slotKey) || [];
        const patientCount = appointmentsInSlot.length;
        const isAvailable = patientCount < slotMaxCapacity;

        slots.push({
          start: slotStart,
          end: slotEnd,
          available: isAvailable,
          date: dateStr,
          timeDisplay: `${slotStart} - ${slotEnd}`,
          reason: !isAvailable ? 'Slot is fully booked' : null,
          blockedBy: !isAvailable ? 'capacity' : null,
          patientCount,
          maxCapacity: slotMaxCapacity
        });

        // Move to next hour or end of range
        currentTime = nextHour <= endTime ? nextHour : endTime;
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