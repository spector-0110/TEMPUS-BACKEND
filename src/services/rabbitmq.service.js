const rabbitmq = require('../config/rabbitmq.config');

class RabbitMQService {
  constructor() {
    this.initialized = false;
    this.initPromise = null;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 5;
    this.reconnectDelay = 5000;
    this.channelPool = new Map();
    this.MAX_CHANNELS = 10;
    this.lastChannelId = 0;
  }

  /**
   * Ensures the service is initialized
   */
  async initialize() {
    if (!this.initialized) {
      if (!this.initPromise) {
        this.initPromise = this.connectWithRetry();
      }
      await this.initPromise;
    }
    return this.initPromise;
  }

  /**
   * Attempts RabbitMQ connection with retry logic
   */
  async connectWithRetry() {
    while (this.connectionAttempts < this.maxConnectionAttempts) {
      try {
        await rabbitmq.connect();
        const connection = rabbitmq.getConnection();

        connection.on('error', (err) => {
          console.error('RabbitMQ Connection Error:', err);
          this.handleConnectionError();
        });

        connection.on('close', () => {
          console.warn('RabbitMQ Connection Closed');
          this.handleConnectionError();
        });

        this.initialized = true;
        this.connectionAttempts = 0;

        await this.initializeChannelPool();
        console.log('RabbitMQ Connected');
        return;
      } catch (error) {
        this.connectionAttempts++;
        console.error(`RabbitMQ Connection Attempt ${this.connectionAttempts} failed:`, error);
        if (this.connectionAttempts < this.maxConnectionAttempts) {
          const delay = this.reconnectDelay * Math.pow(2, this.connectionAttempts - 1);
          await new Promise(res => setTimeout(res, delay));
        } else {
          this.initPromise = null;
          throw new Error('Max connection attempts reached');
        }
      }
    }
  }

  /**
   * Handles reconnection logic
   */
  async handleConnectionError() {
    this.initialized = false;
    this.initPromise = null;
    this.channelPool.clear();
    try {
      await this.initialize();
    } catch (error) {
      console.error('Failed to reconnect to RabbitMQ:', error);
    }
  }

  /**
   * Initializes a pool of reusable channels
   */
  async initializeChannelPool() {
    const connection = rabbitmq.getConnection();
    for (let i = 0; i < this.MAX_CHANNELS; i++) {
      const channel = await connection.createChannel();
      this.attachChannelHandlers(channel, i);
      this.channelPool.set(i, channel);
    }
  }

  /**
   * Attaches error handlers to channel
   * @param {*} channel 
   * @param {number} id 
   */
  attachChannelHandlers(channel, id) {
    // Remove existing listeners first
    channel.removeAllListeners('error');
    channel.removeAllListeners('close');
    
    // Set max listeners to prevent memory leak warnings
    channel.setMaxListeners(5);
    
    channel.on('error', (err) => {
      console.error(`Channel ${id} Error:`, err);
      this.handleChannelError(id);
    });

    channel.on('close', () => {
      console.warn(`Channel ${id} Closed`);
      this.handleChannelError(id);
    });
  }

  /**
   * Replaces failed channel
   * @param {number} channelId 
   */
  async handleChannelError(channelId) {
    try {
      const oldChannel = this.channelPool.get(channelId);
      if (oldChannel) {
        // Remove all listeners before closing
        oldChannel.removeAllListeners();
        try {
          await oldChannel.close();
        } catch (err) {
          console.warn('Error closing channel:', err);
        }
      }

      // Wait a short delay before creating new channel
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const newChannel = await rabbitmq.getConnection().createChannel();
      this.attachChannelHandlers(newChannel, channelId);
      this.channelPool.set(channelId, newChannel);
    } catch (err) {
      console.error('Error recovering channel:', err);
      this.channelPool.delete(channelId);
    }
  }

  /**
   * Returns a healthy channel from the pool
   */
  async getChannel() {
    await this.initialize();
    for (let i = 0; i < this.MAX_CHANNELS; i++) {
      this.lastChannelId = (this.lastChannelId + 1) % this.MAX_CHANNELS;
      const channel = this.channelPool.get(this.lastChannelId);

      if (channel && !channel.closed) {
        return channel;
      }
    }

    console.warn('No active channel found, creating a temporary one');
    const tempChannel = await rabbitmq.getConnection().createChannel();
    return tempChannel;
  }

  // === Exchange Types ===
  static EXCHANGE_TYPES = {
    DIRECT: 'direct',
    FANOUT: 'fanout',
    TOPIC: 'topic',
    HEADERS: 'headers'
  };

  /**
   * Creates queue with default options
   */
  async createQueue(queueName, options = { durable: true }) {
    const channel = await this.getChannel();
    try {
      // First try to check if queue exists
      await channel.checkQueue(queueName);
      console.log(`Queue ${queueName} already exists, skipping declaration`);
    } catch (error) {
      // Queue doesn't exist, create it with specified options
      await channel.assertQueue(queueName, {
        ...options,
        deadLetterExchange: `${queueName}.dlx`,
        maxLength: 1000000,
        messageTtl: 86400000
      });
    }
  }

  /**
   * Creates exchange
   */
  async createExchange(exchangeName, type = RabbitMQService.EXCHANGE_TYPES.DIRECT) {
    const channel = await this.getChannel();
    await channel.assertExchange(exchangeName, type, { durable: true });
  }

  /**
   * Binds queue to exchange
   */
  async bindQueueToExchange(queueName, exchangeName, routingKey = '') {
    const channel = await this.getChannel();
    await channel.bindQueue(queueName, exchangeName, routingKey);
  }

  /**
   * Publishes a message to a queue
   */
  async publishToQueue(queueName, message, options = {}) {
    const channel = await this.getChannel();
    channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), options);
  }

  /**
   * Publishes a message to an exchange
   */
  async publishToExchange(exchangeName, routingKey, message, options = {}) {
    const channel = await this.getChannel();
    channel.publish(exchangeName, routingKey, Buffer.from(JSON.stringify(message)), options);
  }

  /**
   * Consumes messages from queue
   */
  async consumeQueue(queueName, callback, options = { noAck: false }) {
    const channel = await this.getChannel();
    await channel.consume(queueName, async (msg) => {
      if (!msg) return;
      try {
        const data = JSON.parse(msg.content.toString());
        await callback(data);
        if (!options.noAck) channel.ack(msg);
      } catch (err) {
        console.error('Error processing message:', err);
        if (!options.noAck) channel.nack(msg, false, true);
      }
    }, options);
  }

  /**
   * Creates a Dead Letter Queue
   */
  async createDeadLetterQueue(queueName, deadLetterExchange, deadLetterRoutingKey) {
    const channel = await this.getChannel();
    await channel.assertQueue(queueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': deadLetterExchange,
        'x-dead-letter-routing-key': deadLetterRoutingKey
      }
    });
  }

  /**
   * Creates a delayed queue using TTL and dead-lettering
   */
  async createDelayedQueue(queueName, delayMs) {
    const channel = await this.getChannel();
    await channel.assertQueue(queueName, {
      durable: true,
      arguments: {
        'x-message-ttl': delayMs,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': `${queueName}_processed`
      }
    });
  }

  /**
   * Checks if queue exists
   */
  async checkQueue(queueName) {
    const channel = await this.getChannel();
    return await channel.checkQueue(queueName);
  }

  /**
   * Deletes a queue
   */
  async deleteQueue(queueName) {
    const channel = await this.getChannel();
    await channel.deleteQueue(queueName);
  }

  /**
   * Clears all messages in a queue
   */
  async purgeQueue(queueName) {
    const channel = await this.getChannel();
    await channel.purgeQueue(queueName);
  }

  /**
   * Health check for connection and channels
   */
  async checkHealth() {
    try {
      if (!this.initialized || !rabbitmq.getConnection()) {
        return { status: 'error', message: 'RabbitMQ not connected' };
      }

      const activeChannels = Array.from(this.channelPool.values()).filter(c => c && !c.closed);

      if (activeChannels.length === 0) {
        return { status: 'warning', message: 'No active channels available' };
      }

      return {
        status: 'healthy',
        activeChannels: activeChannels.length,
        totalChannels: this.MAX_CHANNELS
      };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }

  /**
   * Optional cleanup logic
   */
  async close() {
    const connection = rabbitmq.getConnection();
    if (connection) {
      try {
        await connection.close();
        this.initialized = false;
        console.log('RabbitMQ connection closed');
      } catch (err) {
        console.error('Error closing RabbitMQ connection:', err);
      }
    }
  }
}

module.exports = new RabbitMQService();