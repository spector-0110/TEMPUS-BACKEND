const redisService = require('../../services/redis.service');
const rabbitmqService = require('../../services/rabbitmq.service');
const mailService = require('../../services/mail.service');
const watsappService = require('../../services/whatsapp.service');

const MESSAGE_TYPE = {
  EMAIL: 'email',
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
  OTP: 'otp'
};


class MessageService {

  constructor() {
    this.initialized = false;
    this.queues = {
      email: 'notifications.email',
      sms: 'notifications.sms',
      whatsapp: 'notifications.whatsapp',
      otp: 'notifications.otp'
    };
  }

  async initialize() {
    if (this.initialized) return;
    try {
      // Initialize all queues with dead letter exchanges, one by one with error handling
      for (const [queueType, queueName] of Object.entries(this.queues)) {
        try {
          await rabbitmqService.createQueue(queueName, {
            deadLetterExchange: true,
            maxLength: 500000
          });
          console.log(`Queue ${queueName} initialized successfully`);
        } catch (queueError) {
          console.error(`Failed to initialize queue ${queueName}:`, queueError);
          // Continue with other queues instead of failing completely
        }
      }
      
      // Setup consumers for each queue
      await this.setupQueueConsumers();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize MessageService:', error);
      throw error;
    }
  }

  async setupQueueConsumers() {
    // Helper function to set up a consumer with error handling
    const setupConsumer = async (queueName, handler, options) => {
      try {
        await rabbitmqService.consumeQueue(queueName, handler, options);
        console.log(`Consumer for ${queueName} set up successfully`);
      } catch (error) {
        console.error(`Failed to set up consumer for ${queueName}:`, error);
      }
    };
  
    // Email queue consumer
    await setupConsumer(this.queues.email, async (message) => {
      const { to, subject, content, hospitalId } = message;
      await mailService.sendMail(to, subject, content, hospitalId);
    }, { maxRetries: 3, prefetch: 10 });
  
    // OTP queue consumer with higher priority
    await setupConsumer(this.queues.otp, async (message) => {
      const { to, subject, content, hospitalId } = message;
      await mailService.sendMail(to, subject, content, hospitalId);
    }, { maxRetries: 3, prefetch: 5, priority: 10 });
  
    // SMS queue consumer
    await setupConsumer(this.queues.sms, async (message) => {
      // SMS implementation
      // For example, using a third-party SMS service   
      
      
      console.log('Processing SMS:', message);
    }, { maxRetries: 3, prefetch: 10 });
  
    // WhatsApp queue consumer
    await setupConsumer(this.queues.whatsapp, async (message) => {
      // WhatsApp implementation
      console.log('Processing WhatsApp:', message);
      watsappService.sendChatMessage(message.to, message.content);

      
    }, { maxRetries: 3, prefetch: 10 });
  }

  async sendMessage(type, data) {
    if (!this.initialized) {
      await this.initialize();
    }

    const messageId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Select appropriate queue
    let queueName;
    switch (type.toLowerCase()) {
      case MESSAGE_TYPE.EMAIL:{

        queueName = this.queues.email;
        break;
      }
      case MESSAGE_TYPE.SMS:
        queueName = this.queues.sms;
        break;
      case MESSAGE_TYPE.WHATSAPP:
        queueName = this.queues.whatsapp;
        break;
      case 'otp':
        queueName = this.queues.otp;
        break;
      default:
        throw new Error(`Unsupported message type: ${type}`);
    }

    // Publish message to queue
    await rabbitmqService.publishToQueue(queueName, {
      ...data,
      id: messageId,
      timestamp: new Date().toISOString()
    }, {
      messageId,
      persistent: true,
      priority: type === 'otp' ? 10 : 0
    });

    // Track message status in Redis for 24 hours
    await redisService.setCache(`message:${messageId}`, {
      status: 'queued',
      type,
      timestamp: new Date().toISOString(),
      data
    }, 24 * 60 * 60);

    return messageId;
  }

  async getMessageStatus(messageId) {
    return await redisService.getCache(`message:${messageId}`);
  }
}

module.exports = new MessageService();