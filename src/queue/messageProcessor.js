const rabbitmqService = require('../services/rabbitmq.service');
const redisService = require('../services/redis.service');

class MessageProcessor {
  async initialize() {
    // Create queues
    await rabbitmqService.createQueue('tasks');
    await rabbitmqService.createQueue('notifications');
    await rabbitmqService.createQueue('email_notifications');
    await rabbitmqService.createQueue('sms_notifications');

    // Set up consumers
    await this.setupTaskConsumer();
    await this.setupNotificationConsumer();
    await this.setupEmailConsumer();
    await this.setupSMSConsumer();
  }

  async setupTaskConsumer() {
    await rabbitmqService.consumeQueue('tasks', async (data) => {
      const taskId = data.id;
      await redisService.setCache(`task:${taskId}`, data, 24 * 60 * 60); // 24 hours expiry
    });
  }

  async setupNotificationConsumer() {
    await rabbitmqService.consumeQueue('notifications', async (data) => {
      const notificationId = data.id;
      await redisService.setCache(`notification:${notificationId}`, data, 7 * 24 * 60 * 60); // 7 days expiry
    });
  }

  async setupEmailConsumer() {
    await rabbitmqService.consumeQueue('email_notifications', async (data) => {
      // Here you would integrate with your email service (e.g., SendGrid, AWS SES)
      console.log('Processing email notification:', data);
      // Store notification status in Redis
      await redisService.setCache(`email:${Date.now()}`, {
        status: 'sent',
        data,
        timestamp: new Date().toISOString()
      }, 7 * 24 * 60 * 60); // 7 days retention
    });
  }

  async setupSMSConsumer() {
    await rabbitmqService.consumeQueue('sms_notifications', async (data) => {
      // Here you would integrate with your SMS service (e.g., Twilio, MessageBird)
      console.log('Processing SMS notification:', data);
      // Store notification status in Redis
      await redisService.setCache(`sms:${Date.now()}`, {
        status: 'sent',
        data,
        timestamp: new Date().toISOString()
      }, 7 * 24 * 60 * 60); // 7 days retention
    });
  }

  async publishTask(taskData) {
    await rabbitmqService.publishToQueue('tasks', taskData);
  }

  async publishNotification(notificationData) {
    const { type, ...data } = notificationData;
    const queueName = type.toLowerCase() === 'email' ? 'email_notifications' : 'sms_notifications';
    
    await rabbitmqService.publishToQueue(queueName, {
      type,
      timestamp: new Date().toISOString(),
      ...data
    });
  }
}

module.exports = new MessageProcessor();