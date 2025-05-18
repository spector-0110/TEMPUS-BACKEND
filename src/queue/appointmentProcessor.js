const rabbitmqService = require('../services/rabbitmq.service');
const redisService = require('../services/redis.service');
const messageService = require('../modules/notification/message.service');
const { QUEUES, APPOINTMENT_STATUS } = require('../modules/appointment/appointment.constants');

class AppointmentProcessor {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      // Create existing queue for backward compatibility
      await rabbitmqService.createQueue('appointment_updates', {
        deadLetterExchange: true,
        maxLength: 100000
      });
      
      // Create new queues with dead letter exchanges
      await rabbitmqService.createQueue(QUEUES.APPOINTMENT_CREATED, {
        deadLetterExchange: true,
        maxLength: 100000
      });
      
      await rabbitmqService.createQueue(QUEUES.APPOINTMENT_UPDATED, {
        deadLetterExchange: true,
        maxLength: 100000
      });
      
      await rabbitmqService.createQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
        deadLetterExchange: true,
        maxLength: 100000
      });
      
      // Set up consumers
      await this.setupAppointmentUpdateConsumer();
      await this.setupConsumers();
      
      this.initialized = true;
      console.log('Appointment processor initialized successfully');
    } catch (error) {
      console.error('Failed to initialize appointment processor:', error);
    }
  }

  async setupAppointmentUpdateConsumer() {
    await rabbitmqService.consumeQueue('appointment_updates', async (data) => {
      try {
        const { appointments, doctor, reason } = data;
        
        // Group appointments by date for notifications
        const appointmentsByDate = this.groupAppointmentsByDate(appointments);
        
        // Send consolidated notifications through message service
        await this.sendNotifications(doctor, appointmentsByDate, reason);

        // Log success
        await redisService.setCache(`appointment:update:${Date.now()}`, {
          status: 'processed',
          data,
          timestamp: new Date().toISOString()
        }, 7 * 24 * 60 * 60);
      } catch (error) {
        console.error('Error processing appointment update:', error);
        throw error;
      }
    }, {
      maxRetries: 3,
      prefetch: 5
    });
  }
  
  async setupConsumers() {
    // Consumer for appointment created events
    await rabbitmqService.consumeQueue(QUEUES.APPOINTMENT_CREATED, async (message) => {
      try {
        console.log('Processing appointment creation:', message.appointment.id);
        
        // Handle appointment creation event
        // This is where additional business logic could be added
        
        // Invalidate any relevant cached lists
        await this.invalidateAppointmentCaches(message.appointment);
        
      } catch (error) {
        console.error('Error processing appointment creation:', error);
      }
    }, { maxRetries: 3 });

    // Consumer for appointment updated events
    await rabbitmqService.consumeQueue(QUEUES.APPOINTMENT_UPDATED, async (message) => {
      try {
        console.log('Processing appointment update:', message.appointment.id);
        
        // Handle status updates
        if (message.previousStatus && message.appointment.status !== message.previousStatus) {
          await this.handleStatusChange(message.appointment, message.previousStatus);
        }
        
        // Handle payment status updates
        if (message.paymentStatusUpdated) {
          await this.handlePaymentStatusChange(message.appointment);
        }
        
        // Handle appointment deletion
        if (message.deleted) {
          await this.handleAppointmentDeletion(message.appointment);
        }
        
        // Invalidate any relevant cached lists
        await this.invalidateAppointmentCaches(message.appointment);
        
      } catch (error) {
        console.error('Error processing appointment update:', error);
      }
    }, { maxRetries: 3 });
    
    // Consumer for appointment notification events
    await rabbitmqService.consumeQueue(QUEUES.APPOINTMENT_NOTIFICATION, async (message) => {
      try {
        console.log('Processing appointment notification:', message.appointmentId);
        
        // Send WhatsApp notification if configured
        await this.sendNotification(message);
        
      } catch (error) {
        console.error('Error processing appointment notification:', error);
      }
    }, { maxRetries: 5 });
  }
  
  async handleStatusChange(appointment, previousStatus) {
    try {
      // Generate appropriate messages based on status change
      let notificationContent = '';
      
      if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
        notificationContent = `Your appointment with Dr. ${appointment.doctor.name} on ${new Date(appointment.appointmentDate).toLocaleDateString()} has been cancelled.`;
      } else if (appointment.status === APPOINTMENT_STATUS.COMPLETED) {
        notificationContent = `Thank you for visiting ${appointment.hospital.name}. Your appointment with Dr. ${appointment.doctor.name} has been marked as completed.`;
        
        // Notify next patient in queue if there is one
        await this.notifyNextPatientInQueue(appointment.hospitalId, appointment.doctorId);
      } else if (appointment.status === APPOINTMENT_STATUS.MISSED) {
        notificationContent = `You missed your appointment with Dr. ${appointment.doctor.name} at ${appointment.hospital.name} on ${new Date(appointment.appointmentDate).toLocaleDateString()}.`;
        
        // Notify next patient in queue if there is one
        await this.notifyNextPatientInQueue(appointment.hospitalId, appointment.doctorId);
      }
      
      if (notificationContent) {
        // Queue notification
        await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
          appointmentId: appointment.id,
          mobile: appointment.mobile,
          hospitalId: appointment.hospitalId,
          content: notificationContent
        });
      }
      
      // Clear any tracking caches to ensure data is fresh
      await this.invalidateTrackingCaches(appointment.hospitalId, appointment.doctorId);
    } catch (error) {
      console.error('Error handling status change:', error);
    }
  }
  
  /**
   * Invalidate tracking caches to ensure queue data is fresh
   */
  async invalidateTrackingCaches(hospitalId, doctorId) {
    try {
      // Clear any doctor/hospital specific caches
      const today = new Date().toISOString().split('T')[0];
      const cachePatterns = [
        `tracking:hospital:${hospitalId}:*`,
        `tracking:doctor:${doctorId}:*`,
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
   * Notify the next patient in the queue when their turn is approaching
   */
  async notifyNextPatientInQueue(hospitalId, doctorId) {
    try {
      // Get today's date
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Find next booked appointment
      const nextAppointment = await prisma.appointment.findFirst({
        where: {
          hospitalId: hospitalId,
          doctorId: doctorId,
          appointmentDate: today,
          status: APPOINTMENT_STATUS.BOOKED
        },
        include: {
          hospital: {
            select: {
              name: true
            }
          },
          doctor: {
            select: {
              name: true
            }
          }
        },
        orderBy: [
          { startTime: 'asc' }
        ]
      });
      
      if (nextAppointment) {
        // Send notification that it's almost their turn
        const notificationContent = `It's almost your turn! Your appointment with Dr. ${nextAppointment.doctor.name} at ${nextAppointment.hospital.name} is coming up next. Please make your way to the clinic if you aren't already there.`;
        
        await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
          appointmentId: nextAppointment.id,
          mobile: nextAppointment.mobile,
          hospitalId: nextAppointment.hospitalId,
          content: notificationContent
        });
      }
    } catch (error) {
      console.error('Error notifying next patient:', error);
    }
  }

  async handlePaymentStatusChange(appointment) {
    try {
      // Generate notification if needed
      if (appointment.paymentStatus === 'paid') {
        const notificationContent = `Payment received for your appointment with Dr. ${appointment.doctor.name} at ${appointment.hospital.name}. Thank you!`;
        
        // Queue notification
        await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
          appointmentId: appointment.id,
          mobile: appointment.mobile,
          hospitalId: appointment.hospitalId,
          content: notificationContent
        });
      }
    } catch (error) {
      console.error('Error handling payment status change:', error);
    }
  }

  async handleAppointmentDeletion(appointment) {
    try {
      // Clear any relevant appointment-specific caches
      await redisService.deleteCache(`appointment:${appointment.id}`);
      
      // Invalidate related list caches
      await this.invalidateAppointmentCaches(appointment);
      
      // Send cancellation notification
      const notificationContent = `Your appointment with Dr. ${appointment.doctor.name} on ${new Date(appointment.appointmentDate).toLocaleDateString()} has been cancelled.`;
      
      // Queue notification
      await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
        appointmentId: appointment.id,
        mobile: appointment.mobile,
        hospitalId: appointment.hospitalId,
        content: notificationContent
      });
    } catch (error) {
      console.error('Error handling appointment deletion:', error);
    }
  }

  async invalidateAppointmentCaches(appointment) {
    try {
      // Pattern to match all possible cache keys for this hospital's appointments
      const hospitalPattern = `hospital_appointments:${appointment.hospitalId}*`;
      
      // Pattern to match all possible cache keys for this doctor's appointments
      const doctorPattern = `doctor_appointments:${appointment.doctorId}*`;
      
      // Delete all matching keys
      await redisService.deleteByPattern(hospitalPattern);
      await redisService.deleteByPattern(doctorPattern);
    } catch (error) {
      console.error('Error invalidating appointment caches:', error);
    }
  }

  async sendNotification(message) {
    try {
      // Send WhatsApp notification
      await messageService.sendMessage('whatsapp', {
        to: message.mobile,
        hospitalId: message.hospitalId,
        content: message.content
      });
    } catch (error) {
      console.error('Error sending appointment notification:', error);
    }
  }
  
  generateDoctorEmailContent(doctor, appointmentsByDate, reason) {
    let appointmentsList = '';
    Object.entries(appointmentsByDate).forEach(([date, appointments]) => {
      appointmentsList += `
        <div style="margin-bottom: 20px;">
          <h3 style="color: #4B5563;">${date}</h3>
          ${appointments.map(apt => `
            <div style="margin-left: 20px;">
              <p><strong>Patient:</strong> ${apt.patientName}</p>
              <p><strong>Time:</strong> ${new Date(apt.scheduledTime).toLocaleTimeString()}</p>
              <p><strong>Duration:</strong> ${apt.duration} minutes</p>
            </div>
          `).join('')}
        </div>
      `;
    });

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563EB;">Schedule Change Notification</h2>
        <p>Dear Dr. ${doctor.name},</p>
        <p>Due to ${reason}, the following appointments have been affected:</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
          ${appointmentsList}
        </div>

        <p>Hospital administration has been notified and will handle the rescheduling process.</p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="color: #64748b; font-size: 12px;">
          This is an automated email from Tempus. Please do not reply to this email.
        </p>
      </div>
    `;
  }

  generateAdminEmailContent(doctor, appointmentsByDate, reason) {
    let appointmentsList = '';
    Object.entries(appointmentsByDate).forEach(([date, appointments]) => {
      appointmentsList += `
        <div style="margin-bottom: 20px;">
          <h3 style="color: #4B5563;">${date}</h3>
          ${appointments.map(apt => `
            <div style="margin-left: 20px;">
              <p><strong>Patient:</strong> ${apt.patientName}</p>
              <p><strong>Contact:</strong> ${apt.patientPhone || 'N/A'}</p>
              <p><strong>Time:</strong> ${new Date(apt.scheduledTime).toLocaleTimeString()}</p>
              <p><strong>Duration:</strong> ${apt.duration} minutes</p>
            </div>
          `).join('')}
        </div>
      `;
    });

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563EB;">Doctor Schedule Change - Action Required</h2>
        <p>Schedule changes have been made for Dr. ${doctor.name} due to ${reason}.</p>
        <p>The following appointments need to be rescheduled:</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
          ${appointmentsList}
        </div>

        <p>Please contact the affected patients to reschedule their appointments.</p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="color: #64748b; font-size: 12px;">
          This is an automated email from Tempus.
        </p>
      </div>
    `;
  }
}

module.exports = new AppointmentProcessor();