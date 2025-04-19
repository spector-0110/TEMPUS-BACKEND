const RabbitMQService = require('../services/rabbitmq.service');
const redisService = require('../services/redis.service');
const mailService = require('../services/mail.service');

class MessageProcessor {
  constructor() {
    this.rabbitmqService = RabbitMQService;
    this.initialized = false;
  }

  async initialize() {
    try {
      // Initialize RabbitMQ service if not already initialized
      await this.rabbitmqService.initialize();

      // Create queues with proper configuration and error handling
      const queues = {
        'tasks': { maxLength: 100000 },
        'notifications': { maxLength: 500000 },
        'email_notifications': { maxLength: 100000 },
        'sms_notifications': { maxLength: 100000 }
      };

      // Create all queues with proper error handling
      for (const [queueName, options] of Object.entries(queues)) {
        try {
          await this.rabbitmqService.createQueue(queueName, {
            deadLetterExchange: true,
            ...options
          });
        } catch (error) {
          if (!error.message.includes('already exists')) {
            throw error;
          }
        }
      }

      // Set up consumers only after queues are created
      await Promise.all([
        this.setupTaskConsumer(),
        this.setupNotificationConsumer(),
        this.setupEmailConsumer(),
        this.setupSMSConsumer()
      ]);

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize message processor:', error);
      throw error;
    }
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
    }

    const { type, ...data } = notificationData;
    let queueName;
    
    // Map notification type to appropriate queue
    switch(type.toLowerCase()) {
      case 'email':
        queueName = 'email_notifications';
        break;
      case 'sms':
        queueName = 'sms_notifications';
        break;
      default:
        throw new Error(`Unsupported notification type: ${type}`);
    }
    
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