const RabbitMQService = require('../services/rabbitmq.service');
const redisService = require('../services/redis.service');
const mailService = require('../services/mail.service');

class MessageProcessor {
  constructor() {
    this.rabbitmqService = RabbitMQService;
  }


  async initialize() {
    // Initialize RabbitMQ service
    await this.rabbitmqService.initialize();

    // Create queues with proper options
    await this.rabbitmqService.createQueue('tasks', {
      deadLetterExchange: true,
      maxLength: 100000
    });

    await this.rabbitmqService.createQueue('notifications', {
      deadLetterExchange: true,
      maxLength: 500000
    });

    await this.rabbitmqService.createQueue('email_notifications', {
      deadLetterExchange: true,
      maxLength: 100000
    });

    await this.rabbitmqService.createQueue('sms_notifications', {
      deadLetterExchange: true,
      maxLength: 100000
    });

    // Set up consumers
    await this.setupTaskConsumer();
    await this.setupNotificationConsumer();
    await this.setupEmailConsumer();
    await this.setupSMSConsumer();
  }

  async setupTaskConsumer() {
    await this.rabbitmqService.consumeQueue('tasks', async (data) => {
      const taskId = data.id;
      await redisService.setCache(`task:${taskId}`, data, 24 * 60 * 60); // 24 hours expiry
    });
  }

  async setupNotificationConsumer() {
    await this.rabbitmqService.consumeQueue('notifications', async (data) => {
      const notificationId = data.id;
      await redisService.setCache(`notification:${notificationId}`, data, 7 * 24 * 60 * 60); // 7 days expiry
    });
  }

  async setupEmailConsumer() {
    await this.rabbitmqService.consumeQueue('email_notifications', async (data) => {
      try {
        // Handle OTP emails specially
        if (data.subject?.includes('OTP')) {
          const otp = data.content.match(/\d{6}/)[0];
          await mailService.sendOTPEmail(data.to, otp, data.hospitalId);
        } else {
          // Handle regular emails
          await mailService.sendMail(data.to, data.subject, data.content, data.hospitalId);
        }
      } catch (error) {
        console.error('Error processing email:', error);
        // Log failure
        await redisService.setCache(`email:error:${Date.now()}`, {
          status: 'failed',
          data,
          error: error.message,
          timestamp: new Date().toISOString()
        }, 7 * 24 * 60 * 60);

        throw error; // Allow RabbitMQ to handle retry
      }
    }, {
      maxRetries: 3, // Retry failed emails up to 3 times
      prefetch: 5 // Process 5 emails at a time
    });
  }

  async setupSMSConsumer() {
    await this.rabbitmqService.consumeQueue('sms_notifications', async (data) => {
      // Here you would integrate with your SMS service (e.g., Twilio, MessageBird)
      console.log('Processing SMS notification:', data);
      // Store notification status in Redis
      await redisService.setCache(`sms:${Date.now()}`, {
        status: 'sent',
        data,
        timestamp: new Date().toISOString()
      }, 7 * 24 * 60 * 60); // 7 days retention
    }, {
      maxRetries: 3,
      prefetch: 10
    });
  }

  async publishTask(taskData) {
    await this.rabbitmqService.publishToQueue('tasks', taskData);
  }

  async publishNotification(notificationData) {
    const { type, ...data } = notificationData;
    const queueName = type.toLowerCase() === 'email' ? 'email_notifications' : 'sms_notifications';
    
    await this.rabbitmqService.publishToQueue(queueName, {
      type,
      timestamp: new Date().toISOString(),
      ...data
    });
  }
}

module.exports = new MessageProcessor();