const rabbitmqService = require('../services/rabbitmq.service');
const redisService = require('../services/redis.service');
const messageService = require('../modules/notification/message.service');
const TimezoneUtil = require('../utils/timezone.util');
const { QUEUES, APPOINTMENT_STATUS,APPOINTMENT_PAYMENT_STATUS } = require('../modules/appointment/appointment.constants');
const appointmentService = require('../modules/appointment/appointment.service');

class AppointmentProcessor {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      
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
      // await this.setupAppointmentUpdateConsumer();
      await this.setupConsumers();
      
      this.initialized = true;
      console.log('Appointment processor initialized successfully');
    } catch (error) {
      console.error('Failed to initialize appointment processor:', error);
    }
  }

  // async setupAppointmentUpdateConsumer() {
  //   await rabbitmqService.consumeQueue('appointment_updates', async (data) => {
  //     try {
  //       const { appointments, doctor, reason } = data;
        
  //       // Group appointments by date for notifications
  //       const appointmentsByDate = this.groupAppointmentsByDate(appointments);
        
  //       // Send consolidated notifications through message service
  //       await this.sendNotifications(doctor, appointmentsByDate, reason);

  //       // Log success
  //       await redisService.setCache(`appointment:update:${Date.now()}`, {
  //         status: 'processed',
  //         data,
  //         timestamp: new Date().toISOString()
  //       }, 7 * 24 * 60 * 60);
  //     } catch (error) {
  //       console.error('Error processing appointment update:', error);
  //       throw error;
  //     }
  //   }, {
  //     maxRetries: 3,
  //     prefetch: 5
  //   });
  // }
  
  async setupConsumers() {
    // Consumer for appointment created events
    await rabbitmqService.consumeQueue(QUEUES.APPOINTMENT_CREATED, async (message) => {
      try {
        console.log('Processing appointment creation:', message.appointment.id);
        
        // Send welcome notification with tracking link
        await this.sendAppointmentCreationNotification(message.appointment, message.trackingLink);
        
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
        notificationContent = `Your appointment with Dr. ${appointment.doctor.name} has been cancelled.`;
      } else if (appointment.status === APPOINTMENT_STATUS.COMPLETED) {
        notificationContent = `Thank you for visiting Dr. ${appointment.doctor.name}. We hope you had a good experience.`;
        
        // Update queue positions after completion
        await appointmentService.updateQueuePositions(
          appointment.hospitalId,
          appointment.doctorId,
          appointment.appointmentDate
        );

        // Notify next patient
        // await this.notifyNextPatientInQueue(appointment.hospitalId, appointment.doctorId);
      }
      
      if (notificationContent) {
        await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
          appointmentId: appointment.id,
          name: appointment.patientName,
          mobile: appointment.mobile,
          hospitalId: appointment.hospitalId,
          content: notificationContent
        });
      }
      
      // Clear any tracking caches to ensure data is fresh
      await this.invalidateAppointmentCaches(appointment);

    } catch (error) {
      console.error('Error handling status change:', error);
    }
  }

  /**
   * Notify the next patient in the queue when their turn is approaching
   */
  async notifyNextPatientInQueue(hospitalId, doctorId) {
    try {
      // Get today's date in IST
      const today = TimezoneUtil.getCurrentIst();
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
          { paymentAt: 'asc' },
          { createdAt: 'asc' }
        ]
      });
      
      if (nextAppointment) {
        // Get their current queue position
        const queueInfo = await appointmentService.getQueuePosition(nextAppointment.id);
        
        const notificationContent = `It's almost your turn! You are ${queueInfo.position === 1 ? 'next' : `${queueInfo.position}th`} in line to see Dr. ${nextAppointment.doctor.name}. Estimated waiting time: ${queueInfo.estimatedWaitingTime} minutes.`;
        
        await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
          appointmentId: nextAppointment.id,
          name: nextAppointment.patientName,
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
      if (appointment.paymentStatus === APPOINTMENT_PAYMENT_STATUS.PAID) {
        const notificationContent = `Payment received for your appointment with Dr. ${appointment.doctor.name} at ${appointment.hospital.name}. Thank you!`;
        
        // Queue notification
        await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
          appointmentId: appointment.id,
          name: appointment.patientName,
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

      // Send cancellation notification
      const notificationContent = `Your appointment with Dr. ${appointment.doctor.name} on ${new Date(appointment.appointmentDate).toLocaleDateString()} has been cancelled.`;
      
      // Queue notification
      await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
        appointmentId: appointment.id,
        name: appointment.patientName,
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

  async sendAppointmentCreationNotification(appointment, trackingLink) {
    try {
      // Format appointment date and time for the message using IST
      const appointmentDate = appointment.appointmentDate;
      
      const startTime = new Date(appointment.startTime).toISOString().split('T')[1].split('.')[0];
      
      // Construct the WhatsApp message
      const notificationContent = `Thank you for booking an appointment with ${appointment.hospital.name}!

        Your appointment with Dr. ${appointment.doctor.name} is confirmed for ${appointmentDate} at ${startTime}.

        Track your appointment queue status: ${trackingLink}
        • Check your position in the queue
        • See how many patients are ahead of you
        • Get notified when it's your turn
        • View the full day's appointment schedule

        Need to reschedule or cancel? Click the tracking link above.

        We look forward to seeing you!`;
      
      // Send WhatsApp message
      await messageService.sendMessage('whatsapp', {
        to: appointment.mobile,
        hospitalId: appointment.hospitalId,
        content: notificationContent
      });
      
      console.log(`Appointment creation notification sent to ${appointment.mobile} for appointment ${appointment.id}`);
    } catch (error) {
      console.error('Error sending appointment creation notification:', error);
      // Don't throw - notification failure shouldn't break appointment creation processing
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
  
}

module.exports = new AppointmentProcessor();