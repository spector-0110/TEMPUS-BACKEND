const rabbitmqService = require('../services/rabbitmq.service');
const redisService = require('../services/redis.service');

class MessageProcessor {
  async initialize() {
    // Create queues
    await rabbitmqService.createQueue('tasks');
    await rabbitmqService.createQueue('notifications');

    // Set up consumers
    await this.setupTaskConsumer();
    await this.setupNotificationConsumer();
  }

  async setupTaskConsumer() {
    await rabbitmqService.consumeQueue('tasks', async (data) => {
      // Process task and store result in Redis
      const taskId = data.id;
      await redisService.setCache(`task:${taskId}`, data, 24 * 60 * 60); // 24 hours expiry
    });
  }

  async setupNotificationConsumer() {
    await rabbitmqService.consumeQueue('notifications', async (data) => {
      // Store notification in Redis
      const notificationId = data.id;
      await redisService.setCache(`notification:${notificationId}`, data, 7 * 24 * 60 * 60); // 7 days expiry
    });
  }

  async publishTask(taskData) {
    await rabbitmqService.publishToQueue('tasks', taskData);
  }

  async publishNotification(notificationData) {
    await rabbitmqService.publishToQueue('notifications', notificationData);
  }
}

module.exports = new MessageProcessor();