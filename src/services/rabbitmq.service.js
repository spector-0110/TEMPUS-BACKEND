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

    // Cluster configuration
    this.clusterNodes = process.env.RABBITMQ_CLUSTER_NODES ? 
      process.env.RABBITMQ_CLUSTER_NODES.split(',') : 
      [process.env.RABBITMQ_URL || 'amqp://localhost'];

    // Message persistence configuration
    this.persistenceConfig = {
      durable: true,
      persistent: true,
      noAck: false,
      prefetch: parseInt(process.env.RABBITMQ_PREFETCH || '10')
    };

    // Metrics tracking
    this.metrics = {
      messagesPublished: 0,
      messagesConsumed: 0,
      errors: 0,
      reconnections: 0,
      lastError: null
    };

    // Logger configuration
    this.LOG_LEVELS = {
      ERROR: 0,
      WARN: 1,
      INFO: 2,
      DEBUG: 3
    };
    this.logLevel = this.LOG_LEVELS[process.env.RABBITMQ_LOG_LEVEL] || this.LOG_LEVELS.INFO;
  }

  log(level, message, context = {}, error = null) {
    if (this.LOG_LEVELS[level] > this.logLevel) return;

    const logObject = {
      timestamp: new Date().toISOString(),
      service: 'RabbitMQService',
      level,
      message,
      ...context
    };

    if (error) {
      logObject.error = {
        message: error.message,
        stack: error.stack
      };
      this.metrics.errors++;
      this.metrics.lastError = {
        timestamp: new Date().toISOString(),
        message: error.message
      };
    }

    if (process.env.NODE_ENV === 'production') {
      console[level.toLowerCase()](JSON.stringify(logObject));
    } else {
      console[level.toLowerCase()](`[RabbitMQ][${logObject.timestamp}][${level}] ${message}`, context);
    }
  }

  async initialize() {
    if (!this.initialized) {
      if (!this.initPromise) {
        this.initPromise = this.connectWithRetry();
      }
      await this.initPromise;
    }
    return this.initPromise;
  }

  async connectWithRetry() {
    while (this.connectionAttempts < this.maxConnectionAttempts) {
      try {
        // Try connecting to each node in the cluster
        for (const node of this.clusterNodes) {
          try {
            await rabbitmq.connect(node);
            const connection = rabbitmq.getConnection();
            
            this.setupConnectionHandlers(connection);
            this.initialized = true;
            this.connectionAttempts = 0;
            
            await this.initializeChannelPool();
            this.log('INFO', 'RabbitMQ Connected', { node });
            return;
          } catch (nodeError) {
            this.log('WARN', `Failed to connect to node ${node}`, {}, nodeError);
            continue;
          }
        }

        throw new Error('Failed to connect to all cluster nodes');
      } catch (error) {
        this.connectionAttempts++;
        this.log('ERROR', `Connection Attempt ${this.connectionAttempts} failed`, {}, error);
        
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

  setupConnectionHandlers(connection) {
    connection.on('error', (err) => {
      this.log('ERROR', 'Connection Error', {}, err);
      this.handleConnectionError();
    });

    connection.on('close', () => {
      this.log('WARN', 'Connection Closed');
      this.handleConnectionError();
    });

    // Handle blocked/unblocked events (happens when RabbitMQ is under high memory pressure)
    connection.on('blocked', (reason) => {
      this.log('WARN', 'Connection blocked', { reason });
    });

    connection.on('unblocked', () => {
      this.log('INFO', 'Connection unblocked');
    });
  }

  async handleConnectionError() {
    this.initialized = false;
    this.initPromise = null;
    this.channelPool.clear();
    try {
      await this.initialize();
    } catch (error) {
      this.log('ERROR', 'Failed to reconnect to RabbitMQ', {}, error);
    }
  }

  async initializeChannelPool() {
    const connection = rabbitmq.getConnection();
    for (let i = 0; i < this.MAX_CHANNELS; i++) {
      const channel = await connection.createChannel();
      this.attachChannelHandlers(channel, i);
      this.channelPool.set(i, channel);
    }
  }

  attachChannelHandlers(channel, id) {
    // Remove existing listeners first
    channel.removeAllListeners('error');
    channel.removeAllListeners('close');
    
    // Set max listeners to prevent memory leak warnings
    channel.setMaxListeners(5);
    
    channel.on('error', (err) => {
      this.log('ERROR', `Channel ${id} Error`, {}, err);
      this.handleChannelError(id);
    });

    channel.on('close', () => {
      this.log('WARN', `Channel ${id} Closed`);
      this.handleChannelError(id);
    });
  }

  async handleChannelError(channelId) {
    try {
      const oldChannel = this.channelPool.get(channelId);
      if (oldChannel) {
        // Remove all listeners before closing
        oldChannel.removeAllListeners();
        try {
          await oldChannel.close();
        } catch (err) {
          this.log('WARN', 'Error closing channel', {}, err);
        }
      }

      // Wait a short delay before creating new channel
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const newChannel = await rabbitmq.getConnection().createChannel();
      this.attachChannelHandlers(newChannel, channelId);
      this.channelPool.set(channelId, newChannel);
    } catch (err) {
      this.log('ERROR', 'Error recovering channel', {}, err);
      this.channelPool.delete(channelId);
    }
  }

  async getChannel() {
    await this.initialize();
    for (let i = 0; i < this.MAX_CHANNELS; i++) {
      this.lastChannelId = (this.lastChannelId + 1) % this.MAX_CHANNELS;
      const channel = this.channelPool.get(this.lastChannelId);

      if (channel && !channel.closed) {
        return channel;
      }
    }

    this.log('WARN', 'No active channel found, creating a temporary one');
    const tempChannel = await rabbitmq.getConnection().createChannel();
    return tempChannel;
  }

  static EXCHANGE_TYPES = {
    DIRECT: 'direct',
    FANOUT: 'fanout',
    TOPIC: 'topic',
    HEADERS: 'headers'
  };

  async createQueue(queueName, options = {}) {
    const channel = await this.getChannel();
    const queueOptions = {
      ...this.persistenceConfig,
      ...options,
      // Additional queue options for better reliability
      deadLetterExchange: options.deadLetterExchange === true ? `${queueName}.dlx` : options.deadLetterExchange,
      maxLength: options.maxLength || 1000000,
      messageTtl: options.messageTtl || 86400000, // 24 hours
      // Enable queue mirroring for high availability
      'x-ha-policy': 'all',
      // Lazy queues - messages will be written to disk more aggressively
      'x-queue-mode': options.lazy ? 'lazy' : 'default'
    };
  
    try {
      // Just assert the queue - this will create it if it doesn't exist
      // or return the existing one if it does
      const { queue } = await channel.assertQueue(queueName, queueOptions);
      this.log('INFO', `Queue ${queueName} asserted successfully`);
      
      // Setup dead letter exchange and queue if requested
      if (queueOptions.deadLetterExchange) {
        const dlxName = queueOptions.deadLetterExchange;
        const dlqName = `${queueName}.dlq`;
        
        await channel.assertExchange(dlxName, 'direct', { durable: true });
        await channel.assertQueue(dlqName, {
          durable: true,
          deadLetterExchange: '',
          deadLetterRoutingKey: queueName,
          messageTtl:  24 *60 * 60 * 1000 // 24 hour retention for dead letters
        });
        await channel.bindQueue(dlqName, dlxName, queueName);
      }
      return queue;
    } catch (error) {
      this.log('ERROR', `Failed to create queue ${queueName}`, {}, error);
      throw error;
    }
  }

  async createExchange(exchangeName, type = RabbitMQService.EXCHANGE_TYPES.DIRECT) {
    const channel = await this.getChannel();
    await channel.assertExchange(exchangeName, type, { durable: true });
  }

  async bindQueueToExchange(queueName, exchangeName, routingKey = '') {
    const channel = await this.getChannel();
    await channel.bindQueue(queueName, exchangeName, routingKey);
  }

  async publishToQueue(queueName, message, options = {}) {
    const channel = await this.getChannel();
    const publishOptions = {
      persistent: true,
      messageId: options.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: options.timestamp || Date.now(),
      headers: {
        'x-first-death-reason': null,
        'x-retry-count': 0,
        ...options.headers
      }
    };

    try {
      channel.sendToQueue(
        queueName, 
        Buffer.from(JSON.stringify(message)), 
        publishOptions
      );
      
      this.metrics.messagesPublished++;
      return true;
    } catch (error) {
      this.log('ERROR', 'Failed to publish message', {
        queue: queueName,
        messageId: publishOptions.messageId
      }, error);
      throw error;
    }
  }

  async publishToExchange(exchangeName, routingKey, message, options = {}) {
    const channel = await this.getChannel();
    channel.publish(exchangeName, routingKey, Buffer.from(JSON.stringify(message)), options);
  }

  async consumeQueue(queueName, callback, options = {}) {
    const channel = await this.getChannel();
    const consumeOptions = {
      ...this.persistenceConfig,
      ...options
    };

    // Set channel prefetch
    await channel.prefetch(consumeOptions.prefetch);

    await channel.consume(queueName, async (msg) => {
      if (!msg) return;
      
      try {
        const data = JSON.parse(msg.content.toString());
        await callback(data);
        
        if (!consumeOptions.noAck) {
          channel.ack(msg);
        }
        
        this.metrics.messagesConsumed++;
      } catch (err) {
        this.log('ERROR', 'Error processing message', {
          queue: queueName,
          messageId: msg.properties.messageId
        }, err);

        if (!consumeOptions.noAck) {
          // Reject the message and requeue if under retry limit
          const retryCount = (msg.properties.headers['x-retry-count'] || 0) + 1;
          if (retryCount <= (options.maxRetries || 3)) {
            const headers = {
              ...msg.properties.headers,
              'x-retry-count': retryCount,
              'x-first-failed-at': msg.properties.headers['x-first-failed-at'] || new Date().toISOString()
            };
            
            channel.nack(msg, false, true);
          } else {
            // Send to dead letter queue if retry limit exceeded
            channel.nack(msg, false, false);
          }
        }
      }
    }, consumeOptions);
  }

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

  async checkQueue(queueName) {
    const channel = await this.getChannel();
    return await channel.checkQueue(queueName);
  }

  async deleteQueue(queueName) {
    const channel = await this.getChannel();
    await channel.deleteQueue(queueName);
  }

  async purgeQueue(queueName) {
    const channel = await this.getChannel();
    await channel.purgeQueue(queueName);
  }

  /**
   * Purge multiple queues at once
   * @param {Array<string>} queueNames - Array of queue names to purge
   * @returns {Promise<Object>} Results of purge operations
   */
  async purgeAllQueues(queueNames = []) {
    try {
      this.log('INFO', 'Starting to purge multiple queues', { queueNames });
      
      const results = [];
      const errors = [];
      
      // Purge queues in parallel for better performance
      const purgePromises = queueNames.map(async (queueName) => {
        try {
          await this.purgeQueue(queueName);
          results.push({ queue: queueName, status: 'success' });
          this.log('INFO', 'Queue purged successfully', { queueName });
        } catch (error) {
          const errorInfo = { 
            queue: queueName, 
            status: 'error', 
            error: error.message 
          };
          errors.push(errorInfo);
          this.log('ERROR', 'Failed to purge queue', { queueName }, error);
        }
      });

      // Wait for all purge operations to complete
      await Promise.allSettled(purgePromises);

      const summary = {
        totalQueues: queueNames.length,
        successful: results.length,
        failed: errors.length,
        timestamp: new Date().toISOString()
      };

      this.log('INFO', 'Queue purge operation completed', summary);

      return {
        success: errors.length === 0,
        summary,
        results,
        errors
      };

    } catch (error) {
      this.log('ERROR', 'Critical error during queue purge operation', {}, error);
      throw error;
    }
  }

  /**
   * Purge all notification and appointment queues
   * @returns {Promise<Object>} Results of purge operations
   */
  async purgeAllAppointmentQueues() {
    const defaultQueues = [
      'notifications.email',
      'notifications.sms', 
      'notifications.otp',
      'notifications.whatsapp',
      'appointments.updated',
      'appointments.notification',
      'notifications',
      'appointments.created'
    ];

    return this.purgeAllQueues(defaultQueues);
  }

  async getQueueInfo(queueName) {
    const channel = await this.getChannel();
    try {
      return await channel.checkQueue(queueName);
    } catch (error) {
      this.log('ERROR', 'Failed to get queue info', { queueName }, error);
      return null;
    }
  }

  async checkHealth() {
    try {
      if (!this.initialized || !rabbitmq.getConnection()) {
        return { 
          status: 'error', 
          message: 'RabbitMQ not connected',
          metrics: this.metrics
        };
      }

      const connection = rabbitmq.getConnection();
      const activeChannels = Array.from(this.channelPool.values())
        .filter(c => c && !c.closed).length;

      const health = {
        status: activeChannels > 0 ? 'healthy' : 'warning',
        activeChannels,
        totalChannels: this.MAX_CHANNELS,
        clusterNodes: this.clusterNodes,
        metrics: this.metrics,
        connectionState: {
          blocked: connection.blocked,
          connecting: connection.connecting,
          serverProperties: connection.serverProperties
        }
      };

      // Check if we're in a degraded state
      if (activeChannels < this.MAX_CHANNELS * 0.5) {
        health.status = 'warning';
        health.message = 'Running with reduced channel capacity';
      }

      return health;
    } catch (error) {
      return { 
        status: 'error', 
        message: error.message,
        metrics: this.metrics
      };
    }
  }

  async close() {
    const connection = rabbitmq.getConnection();
    if (connection) {
      try {
        await connection.close();
        this.initialized = false;
        this.log('INFO', 'RabbitMQ connection closed');
      } catch (err) {
        this.log('ERROR', 'Error closing RabbitMQ connection', {}, err);
      }
    }
  }
}

module.exports = new RabbitMQService();