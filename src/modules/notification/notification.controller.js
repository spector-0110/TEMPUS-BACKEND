const redisService = require('../../services/redis.service');
const rabbitmqService = require('../../services/rabbitmq.service');
const {
  ValidationError,
  NotificationQueueError,
  NotificationCacheError,
  ReminderSchedulingError
} = require('./notification.errors');

class NotificationController {
  constructor() {
    this.initializeQueues();
  }

  async initializeQueues() {
    try {
      // Create notification queues
      await Promise.all([
        rabbitmqService.createQueue('email_notifications'),
        rabbitmqService.createQueue('sms_notifications'),
        rabbitmqService.createDelayedQueue('appointment_reminders', 24 * 60 * 60 * 1000)
      ]);
    } catch (error) {
      console.error('Failed to initialize notification queues:', error);
      throw new NotificationQueueError(
        'Failed to initialize notification queues',
        'multiple',
        error
      );
    }
  }

  async scheduleAppointmentReminder(appointmentData) {
    try {
      if (!appointmentData?.id || !appointmentData.appointmentDate) {
        throw new ValidationError('Invalid appointment data', [
          'Appointment ID and date are required'
        ]);
      }

      // Store appointment data in Redis with 48-hour expiry
      const cacheKey = `appointment:${appointmentData.id}`;
      try {
        await redisService.setCache(cacheKey, appointmentData, 48 * 60 * 60);
      } catch (error) {
        throw new NotificationCacheError(
          'Failed to store appointment data',
          'set',
          error
        );
      }

      // Schedule reminder notification
      try {
        await rabbitmqService.publishToQueue('appointment_reminders', {
          type: 'APPOINTMENT_REMINDER',
          appointmentId: appointmentData.id,
          patientName: appointmentData.patientName,
          mobile: appointmentData.mobile,
          appointmentDate: appointmentData.appointmentDate,
          doctorName: appointmentData.doctorName,
          timestamp: new Date()
        });
      } catch (error) {
        throw new NotificationQueueError(
          'Failed to schedule reminder notification',
          'appointment_reminders',
          error
        );
      }

      return true;
    } catch (error) {
      console.error('Error scheduling reminder:', error);
      if (error instanceof ValidationError ||
          error instanceof NotificationCacheError ||
          error instanceof NotificationQueueError) {
        throw error;
      }
      throw new ReminderSchedulingError(
        'Failed to schedule appointment reminder',
        appointmentData?.id,
        error
      );
    }
  }

  async getAppointmentCache(appointmentId) {
    try {
      if (!appointmentId) {
        throw new ValidationError('Appointment ID is required');
      }

      const cacheKey = `appointment:${appointmentId}`;
      let data;
      try {
        data = await redisService.getCache(cacheKey);
      } catch (error) {
        throw new NotificationCacheError(
          'Failed to retrieve appointment data',
          'get',
          error
        );
      }
      
      if (!data) {
        throw new NotificationCacheError(
          'Appointment data not found',
          'get'
        );
      }

      return data;
    } catch (error) {
      console.error('Error getting appointment cache:', error);
      throw error; // Re-throw our custom errors
    }
  }

  async sendNotification(type, data) {
    try {
      if (!type || !data) {
        throw new ValidationError('Invalid notification request', [
          'Notification type and data are required'
        ]);
      }

      if (!['email', 'sms'].includes(type.toLowerCase())) {
        throw new ValidationError('Invalid notification type', [
          'Type must be either "email" or "sms"'
        ]);
      }

      const queueName = type === 'email' ? 'email_notifications' : 'sms_notifications';
      
      try {
        await rabbitmqService.publishToQueue(queueName, {
          type: type.toUpperCase(),
          timestamp: new Date(),
          data
        });
      } catch (error) {
        throw new NotificationQueueError(
          'Failed to queue notification',
          queueName,
          error
        );
      }

      // Store notification in Redis for tracking
      const notificationKey = `notification:${type}:${Date.now()}`;
      try {
        await redisService.setCache(notificationKey, {
          status: 'sent',
          timestamp: new Date(),
          data
        }, 7 * 24 * 60 * 60); // 7 days retention
      } catch (error) {
        throw new NotificationCacheError(
          'Failed to track notification status',
          'set',
          error
        );
      }

      return true;
    } catch (error) {
      console.error('Error sending notification:', error);
      throw error; // Re-throw our custom errors
    }
  }
}

module.exports = new NotificationController();