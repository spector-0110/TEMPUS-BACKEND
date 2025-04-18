const redisService = require('../../services/redis.service');
const rabbitmqService = require('../../services/rabbitmq.service');

class NotificationController {
  constructor() {
    this.initializeQueues();
  }

  async initializeQueues() {
    // Create notification queues
    await rabbitmqService.createQueue('email_notifications');
    await rabbitmqService.createQueue('sms_notifications');
    
    // Create delayed queue for reminders (24 hours)
    await rabbitmqService.createDelayedQueue('appointment_reminders', 24 * 60 * 60 * 1000);
  }

  async scheduleAppointmentReminder(appointmentData) {
    try {
      // Store appointment data in Redis with 48-hour expiry
      const cacheKey = `appointment:${appointmentData.id}`;
      await redisService.setCache(cacheKey, appointmentData, 48 * 60 * 60);

      // Schedule reminder notification
      await rabbitmqService.publishToQueue('appointment_reminders', {
        type: 'APPOINTMENT_REMINDER',
        appointmentId: appointmentData.id,
        patientName: appointmentData.patientName,
        mobile: appointmentData.mobile,
        appointmentDate: appointmentData.appointmentDate,
        doctorName: appointmentData.doctorName
      });

      return true;
    } catch (error) {
      console.error('Error scheduling reminder:', error);
      throw error;
    }
  }

  async getAppointmentCache(appointmentId) {
    try {
      const cacheKey = `appointment:${appointmentId}`;
      return await redisService.getCache(cacheKey);
    } catch (error) {
      console.error('Error getting appointment cache:', error);
      throw error;
    }
  }

  async sendNotification(type, data) {
    try {
      const queueName = type === 'email' ? 'email_notifications' : 'sms_notifications';
      await rabbitmqService.publishToQueue(queueName, {
        type: type.toUpperCase(),
        timestamp: new Date(),
        data
      });

      // Store notification in Redis for tracking
      const notificationKey = `notification:${type}:${Date.now()}`;
      await redisService.setCache(notificationKey, {
        status: 'sent',
        timestamp: new Date(),
        data
      }, 7 * 24 * 60 * 60); // 7 days retention

      return true;
    } catch (error) {
      console.error('Error sending notification:', error);
      throw error;
    }
  }
}

module.exports = new NotificationController();