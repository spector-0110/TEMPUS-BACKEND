const rabbitmq = require('../config/rabbitmq.config');
const redis = require('../config/redis.config');

class MessageProcessor {
  async initialize() {
    // Create queues
    await rabbitmq.createQueue('tasks');
    await rabbitmq.createQueue('notifications');

    // Set up consumers
    await this.setupTaskConsumer();
    await this.setupNotificationConsumer();
  }

  async setupTaskConsumer() {
    await rabbitmq.consumeQueue('tasks', async (data) => {
      // Process task and store result in Redis
      const taskId = data.id;
      await redis.set(`task:${taskId}`, JSON.stringify(data));
      
      // Example: Set expiry for task data (24 hours)
      await redis.expire(`task:${taskId}`, 24 * 60 * 60);
    });
  }

  async setupNotificationConsumer() {
    await rabbitmq.consumeQueue('notifications', async (data) => {
      // Store notification in Redis
      const notificationId = data.id;
      await redis.set(`notification:${notificationId}`, JSON.stringify(data));
      
      // Example: Set expiry for notifications (7 days)
      await redis.expire(`notification:${notificationId}`, 7 * 24 * 60 * 60);
    });
  }

  async publishTask(taskData) {
    await rabbitmq.publishToQueue('tasks', taskData);
  }

  async publishNotification(notificationData) {
    await rabbitmq.publishToQueue('notifications', notificationData);
  }
}

module.exports = new MessageProcessor();