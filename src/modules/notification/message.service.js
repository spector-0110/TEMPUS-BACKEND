const redisService = require('../../services/redis.service');
const rabbitmqService = require('../../services/rabbitmq.service');
const mailService = require('../../services/mail.service');

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
      // Initialize all queues with dead letter exchanges
      await Promise.all(Object.values(this.queues).map(queue => 
        rabbitmqService.createQueue(queue, {
          deadLetterExchange: true,
          maxLength: 500000
        })
      ));

      // Setup consumers for each queue
      await this.setupQueueConsumers();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize MessageService:', error);
      throw error;
    }
  }

  async setupQueueConsumers() {
    // Email queue consumer
    await rabbitmqService.consumeQueue(this.queues.email, async (message) => {
      const { to, subject, content, hospitalId } = message;
      await mailService.sendMail(to, subject, content, hospitalId);
    }, { maxRetries: 3, prefetch: 10 });

    // OTP queue consumer with higher priority
    await rabbitmqService.consumeQueue(this.queues.otp, async (message) => {
      const { to, otp, hospitalId } = message;
      await mailService.sendOTPEmail(to, otp, hospitalId);
    }, { maxRetries: 3, prefetch: 5, priority: 10 });

    // SMS queue consumer
    await rabbitmqService.consumeQueue(this.queues.sms, async (message) => {
      // SMS implementation
      console.log('Processing SMS:', message);
    }, { maxRetries: 3, prefetch: 10 });

    // WhatsApp queue consumer
    await rabbitmqService.consumeQueue(this.queues.whatsapp, async (message) => {
      // WhatsApp implementation
      console.log('Processing WhatsApp:', message);
    }, { maxRetries: 3, prefetch: 10 });
  }

  async sendMessage(type, data) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Validate quota
    const hasQuota = await this.checkQuota(data.hospitalId, type);
    if (!hasQuota) {
      throw new Error(`Message quota exceeded for ${type}`);
    }

    const messageId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Select appropriate queue
    let queueName;
    switch (type.toLowerCase()) {
      case MESSAGE_TYPE.EMAIL:
        queueName = this.queues.email;
        break;
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