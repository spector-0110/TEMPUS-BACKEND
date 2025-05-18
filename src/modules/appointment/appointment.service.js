const prisma = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const rabbitmqService = require('../../services/rabbitmq.service');
const messageService = require('../notification/message.service');
const trackingUtil = require('../../utils/tracking.util');
const { APPOINTMENT_STATUS, APPOINTMENT_PAYMENT_STATUS, CACHE, QUEUES } = require('./appointment.constants');

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
          paymentStatus: APPOINTMENT_PAYMENT_STATUS.PENDING
        },
        include: {
          hospital: true,
          doctor: true
        }
      });

      // Cache the appointment
      await this.cacheAppointment(appointment);

      // Generate tracking link
      const trackingLink = this.generateTrackingLink(appointment.id, appointment.hospitalId, appointment.doctorId);
      
      // Publish to the appointment created queue
      await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_CREATED, { appointment });
      
      // Send notification
      await this.sendAppointmentNotification(appointment, trackingLink);
      
      return { ...appointment, trackingLink };
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
   * Update an appointment's payment status
   */
  async updatePaymentStatus(appointmentId, paymentStatus) {
    // Validate the payment status
    if (!Object.values(APPOINTMENT_PAYMENT_STATUS).includes(paymentStatus)) {
      throw new Error(`Invalid payment status: ${paymentStatus}`);
    }

    // Update the appointment
    const appointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { paymentStatus },
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
    
    // Only allow deletion if appointment is booked and not in the past
    if (appointment.status !== APPOINTMENT_STATUS.BOOKED || 
        new Date(appointment.appointmentDate) < new Date()) {
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
      const today = new Date().toISOString().split('T')[0];
      const trackingCacheKey = `tracking:queue:${hospitalId}:${doctorId}:${today}:${appointmentId}`;
      
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
      
      // Get today's appointments for the same doctor to build the queue
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      
      // Use a short cache for today's appointments
      const queueCacheKey = `tracking:queue:${hospitalId}:${doctorId}:${today}`;
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
        
        // Cache for just 30 seconds to ensure fresh data but prevent hammering database
        await redisService.setCache(queueCacheKey, todayAppointments, 30);
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
        refreshedAt: new Date().toISOString()
      };
      
      // Cache the tracking result for 30 seconds
      await redisService.setCache(trackingCacheKey, trackingInfo, 30);
      
      return trackingInfo;
    } catch (error) {
      console.error('Error decoding tracking token:', error);
      throw new Error('Invalid or expired tracking token');
    }
  }
  
  /**
   * Verify a tracking token and return the decoded data
   */
  verifyTrackingToken(token) {
    return trackingUtil.verifyToken(token);
  }
  
  /**
   * Cache an appointment
   */
  async cacheAppointment(appointment) {
    const cacheKey = `${CACHE.APPOINTMENT_PREFIX}${appointment.id}`;
    await redisService.setCache(cacheKey, appointment, CACHE.APPOINTMENT_TTL);
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
      // Format appointment date and time for the message
      const appointmentDate = new Date(appointment.appointmentDate)
        .toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      
      const startTime = appointment.startTime 
        ? new Date(appointment.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
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
      // Clear any doctor/hospital specific caches
      const today = new Date().toISOString().split('T')[0];
      const cachePatterns = [
        `tracking:queue:${hospitalId}:${doctorId}:${today}*`
      ];
      
      for (const pattern of cachePatterns) {
        await redisService.deleteByPattern(pattern);
      }
    } catch (error) {
      console.error('Error invalidating tracking caches:', error);
    }
  }
  
  /**
   * Validate if a status transition is allowed
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
      [APPOINTMENT_STATUS.MISSED]: []
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
      
      // Get doctor's schedule to find consultation time
      const doctorSchedule = await prisma.doctorSchedule.findFirst({
        where: {
          doctorId: doctorId,
          hospitalId: hospitalId,
          status: 'active',
          dayOfWeek: new Date().getDay() // Today's day of week
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
}

module.exports = new AppointmentService();