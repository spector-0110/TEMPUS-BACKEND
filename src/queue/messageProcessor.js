const RabbitMQService = require('../services/rabbitmq.service');
const redisService = require('../services/redis.service');
const mailService = require('../services/mail.service');

class MessageProcessor {
  constructor() {
    this.rabbitmqService = RabbitMQService;
    this.initialized = false;
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

    await this.rabbitmqService.createQueue('whatsapp_notifications', {
      deadLetterExchange: true,
      maxLength: 100000
    });

    // Set up consumers
    await this.setupTaskConsumer();
    await this.setupNotificationConsumer();
    await this.setupEmailConsumer();
    await this.setupSMSConsumer();
    await this.setupWhatsAppConsumer();
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
        // Verify mail service connection
        if (!await mailService.verifyConnection()) {
          throw new Error('Mail service unavailable');
        }

        // Handle OTP emails specially
        if (data.subject?.includes('OTP')) {
          const otp = data.content.match(/\d{6}/)[0];
          await mailService.sendOTPEmail(data.to, otp, data.hospitalId);
        } else {
          // Handle regular emails
          await mailService.sendMail(data.to, data.subject, data.content, data.hospitalId);
        }

        // Log success
        await redisService.setCache(`email:success:${Date.now()}`, {
          status: 'sent',
          data,
          timestamp: new Date().toISOString()
        }, 7 * 24 * 60 * 60);

      } catch (error) {
        console.error('Error processing email:', error);
        
        // Log failure with more details
        await redisService.setCache(`email:error:${Date.now()}`, {
          status: 'failed',
          data,
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        }, 7 * 24 * 60 * 60);

        // Throw error to trigger RabbitMQ retry mechanism
        throw error;
      }
    }, {
      maxRetries: 5,
      prefetch: 5,
      retryDelay: 5000, // 5 seconds between retries
      deadLetterExchange: true
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

  async setupWhatsAppConsumer() {
    await this.rabbitmqService.consumeQueue('whatsapp_notifications', async (data) => {
      // Here you would integrate with your WhatsApp service (e.g., Twilio, MessageBird)
      console.log('Processing WhatsApp notification:', data);
      // Store notification status in Redis
      await redisService.setCache(`whatsapp:${Date.now()}`, {
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
    if (!this.initialized) {
      await this.initialize();
      this.initialized = true;
    }

    const { type, ...data } = notificationData;
    const queueName = type.toLowerCase() === 'email' ? 'email_notifications' : 'sms_notifications';
    
    const messageId = await this.rabbitmqService.publishToQueue(queueName, {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      timestamp: new Date().toISOString(),
      ...data
    }, {
      persistent: true,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });

    // Log publish attempt
    await redisService.setCache(`message:published:${messageId}`, {
      queue: queueName,
      data: notificationData,
      timestamp: new Date().toISOString()
    }, 24 * 60 * 60); // 24 hours retention

    return messageId;
  }
}

module.exports = new MessageProcessor();