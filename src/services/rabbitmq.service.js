const rabbitmq = require('../config/rabbitmq.config');

class RabbitMQService {
  constructor() {
    this.initialized = false;
    this.initPromise = null;
  }

  async initialize() {
    if (!this.initialized) {
      if (!this.initPromise) {
        this.initPromise = rabbitmq.connect()
          .then(() => {
            this.initialized = true;
            console.log('RabbitMQ Connected');
          })
          .catch(error => {
            this.initPromise = null;
            throw error;
          });
      }
      await this.initPromise;
    }
    return this.initPromise;
  }

  // Exchange Types
  static EXCHANGE_TYPES = {
    DIRECT: 'direct',
    FANOUT: 'fanout',
    TOPIC: 'topic',
    HEADERS: 'headers'
  };

  // Queue Operations
  async createQueue(queueName, options = { durable: true }) {
    try {
      await this.initialize();
      const channel = rabbitmq.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }
      await channel.assertQueue(queueName, options);
    } catch (error) {
      console.error('Error creating queue:', error);
      throw error;
    }
  }

  // Exchange Operations
  async createExchange(exchangeName, type = RabbitMQService.EXCHANGE_TYPES.DIRECT) {
    try {
      await this.initialize();
      const channel = rabbitmq.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }
      await channel.assertExchange(exchangeName, type, { durable: true });
    } catch (error) {
      console.error('Error creating exchange:', error);
      throw error;
    }
  }

  async bindQueueToExchange(queueName, exchangeName, routingKey = '') {
    try {
      await this.initialize();
      const channel = rabbitmq.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }
      await channel.bindQueue(queueName, exchangeName, routingKey);
    } catch (error) {
      console.error('Error binding queue to exchange:', error);
      throw error;
    }
  }

  // Publishing Messages
  async publishToQueue(queueName, message, options = {}) {
    try {
      await this.initialize();
      const channel = rabbitmq.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }
      const messageBuffer = Buffer.from(JSON.stringify(message));
      await channel.sendToQueue(queueName, messageBuffer, options);
    } catch (error) {
      console.error('Error publishing to queue:', error);
      throw error;
    }
  }

  async publishToExchange(exchangeName, routingKey, message, options = {}) {
    try {
      await this.initialize();
      const channel = rabbitmq.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }
      const messageBuffer = Buffer.from(JSON.stringify(message));
      await channel.publish(exchangeName, routingKey, messageBuffer, options);
    } catch (error) {
      console.error('Error publishing to exchange:', error);
      throw error;
    }
  }

  // Consuming Messages
  async consumeQueue(queueName, callback, options = { noAck: false }) {
    try {
      await this.initialize();
      const channel = rabbitmq.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }
      await channel.consume(queueName, async (message) => {
        try {
          const data = JSON.parse(message.content.toString());
          await callback(data);
          if (!options.noAck) {
            await channel.ack(message);
          }
        } catch (error) {
          console.error('Error processing message:', error);
          if (!options.noAck) {
            // Negative acknowledge the message
            await channel.nack(message, false, true);
          }
        }
      });
    } catch (error) {
      console.error('Error setting up consumer:', error);
      throw error;
    }
  }

  // Advanced Queue Operations
  async createDeadLetterQueue(queueName, deadLetterExchange, deadLetterRoutingKey) {
    try {
      await this.initialize();
      const channel = rabbitmq.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }
      await channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': deadLetterExchange,
          'x-dead-letter-routing-key': deadLetterRoutingKey
        }
      });
    } catch (error) {
      console.error('Error creating dead letter queue:', error);
      throw error;
    }
  }

  async createDelayedQueue(queueName, delayMs) {
    try {
      await this.initialize();
      const channel = rabbitmq.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }
      await channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-message-ttl': delayMs,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': `${queueName}_processed`
        }
      });
    } catch (error) {
      console.error('Error creating delayed queue:', error);
      throw error;
    }
  }

  // Utility Methods
  async checkQueue(queueName) {
    try {
      await this.initialize();
      const channel = rabbitmq.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }
      return await channel.checkQueue(queueName);
    } catch (error) {
      console.error('Error checking queue:', error);
      throw error;
    }
  }

  async deleteQueue(queueName) {
    try {
      await this.initialize();
      const channel = rabbitmq.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }
      await channel.deleteQueue(queueName);
    } catch (error) {
      console.error('Error deleting queue:', error);
      throw error;
    }
  }

  async purgeQueue(queueName) {
    try {
      await this.initialize();
      const channel = rabbitmq.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
      }
      await channel.purgeQueue(queueName);
    } catch (error) {
      console.error('Error purging queue:', error);
      throw error;
    }
  }
}

module.exports = new RabbitMQService();