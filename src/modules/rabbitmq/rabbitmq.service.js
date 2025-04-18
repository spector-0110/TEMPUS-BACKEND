const ConnectionManager = require('./connection.manager');
const ChannelManager = require('./channel.manager');
const { 
  EXCHANGE_TYPES, 
  QUEUE_DEFAULTS, 
  EXCHANGE_DEFAULTS,
  CONSUMER_DEFAULTS,
  PUBLISH_DEFAULTS,
  HEALTH_CHECK
} = require('./rabbitmq.constants');
const { 
  PublishError, 
  ConsumeError, 
  QueueError, 
  ExchangeError 
} = require('./rabbitmq.errors');
const { Logger } = require('./rabbitmq.utils');

class RabbitMQService {
  constructor(config = {}) {
    this.connectionManager = new ConnectionManager(config);
    this.channelManager = new ChannelManager(this.connectionManager, config);
    this.logger = new Logger(process.env.RABBITMQ_LOG_LEVEL);
  }

  async initialize() {
    await this.connectionManager.initialize();
    await this.channelManager.initialize();
  }

  async createQueue(queueName, options = {}) {
    const channel = await this.channelManager.getChannel();
    const queueOptions = {
      ...QUEUE_DEFAULTS,
      ...options
    };

    try {
      // Check if queue exists first
      await channel.checkQueue(queueName);
      this.logger.log('INFO', `Queue ${queueName} already exists`);
    } catch (error) {
      try {
        // Queue doesn't exist, create it
        await channel.assertQueue(queueName, queueOptions);
        
        // Set up dead letter queue if specified
        if (queueOptions.deadLetterExchange) {
          const dlxName = `${queueName}.dlx`;
          const dlqName = `${queueName}.dlq`;
          
          await channel.assertExchange(dlxName, 'direct', { durable: true });
          await channel.assertQueue(dlqName, {
            durable: true,
            deadLetterExchange: '',
            deadLetterRoutingKey: queueName,
            messageTtl: queueOptions.dlxRetention
          });
          await channel.bindQueue(dlqName, dlxName, queueName);
        }

        this.logger.log('INFO', `Queue ${queueName} created successfully`);
      } catch (err) {
        throw new QueueError(`Failed to create queue ${queueName}`, queueName, 'create', err);
      }
    }
  }

  async createExchange(exchangeName, type = EXCHANGE_TYPES.DIRECT, options = {}) {
    const channel = await this.channelManager.getChannel();
    const exchangeOptions = {
      ...EXCHANGE_DEFAULTS,
      ...options
    };

    try {
      await channel.assertExchange(exchangeName, type, exchangeOptions);
      this.logger.log('INFO', `Exchange ${exchangeName} created successfully`);
    } catch (error) {
      throw new ExchangeError(
        `Failed to create exchange ${exchangeName}`,
        exchangeName,
        'create',
        error
      );
    }
  }

  async bindQueueToExchange(queueName, exchangeName, routingKey = '') {
    const channel = await this.channelManager.getChannel();
    try {
      await channel.bindQueue(queueName, exchangeName, routingKey);
      this.logger.log('INFO', `Queue ${queueName} bound to exchange ${exchangeName}`);
    } catch (error) {
      throw new QueueError(
        `Failed to bind queue ${queueName} to exchange ${exchangeName}`,
        queueName,
        'bind',
        error
      );
    }
  }

  async publishToQueue(queueName, message, options = {}) {
    const channel = await this.channelManager.getChannel();
    const publishOptions = {
      ...PUBLISH_DEFAULTS,
      messageId: options.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: options.timestamp || Date.now(),
      headers: {
        'x-first-death-reason': null,
        'x-retry-count': 0,
        ...options.headers
      }
    };

    try {
      const success = channel.sendToQueue(
        queueName,
        Buffer.from(JSON.stringify(message)),
        publishOptions
      );

      if (!success) {
        throw new Error('Channel write buffer is full');
      }

      this.connectionManager.metrics.recordPublish(queueName);
      return publishOptions.messageId;
    } catch (error) {
      throw new PublishError(
        `Failed to publish message to queue ${queueName}`,
        queueName,
        { messageId: publishOptions.messageId },
        error
      );
    }
  }

  async publishToExchange(exchangeName, routingKey, message, options = {}) {
    const channel = await this.channelManager.getChannel();
    const publishOptions = {
      ...PUBLISH_DEFAULTS,
      ...options
    };

    try {
      channel.publish(
        exchangeName,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        publishOptions
      );

      this.connectionManager.metrics.recordPublish(exchangeName);
    } catch (error) {
      throw new PublishError(
        `Failed to publish message to exchange ${exchangeName}`,
        exchangeName,
        { routingKey },
        error
      );
    }
  }

  async consumeQueue(queueName, callback, options = {}) {
    const channel = await this.channelManager.getChannel();
    const consumeOptions = {
      ...CONSUMER_DEFAULTS,
      ...options
    };

    try {
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
          
          this.connectionManager.metrics.recordConsume(queueName);
        } catch (err) {
          this.logger.log('ERROR', 'Error processing message', {
            queue: queueName,
            messageId: msg.properties.messageId
          }, err);

          if (!consumeOptions.noAck) {
            // Handle retries
            const retryCount = (msg.properties.headers['x-retry-count'] || 0) + 1;
            
            if (retryCount <= consumeOptions.maxRetries) {
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

      this.logger.log('INFO', `Started consuming from queue ${queueName}`);
    } catch (error) {
      throw new ConsumeError(
        `Failed to set up consumer for queue ${queueName}`,
        queueName,
        null,
        error
      );
    }
  }

  async checkHealth() {
    try {
      if (!this.connectionManager.isConnected()) {
        return { 
          status: HEALTH_CHECK.STATUS.ERROR, 
          message: 'RabbitMQ not connected',
          metrics: this.connectionManager.getMetrics()
        };
      }

      const activeChannels = this.channelManager.getActiveChannelCount();
      const totalChannels = this.channelManager.getPoolSize();

      const health = {
        status: activeChannels > 0 ? HEALTH_CHECK.STATUS.HEALTHY : HEALTH_CHECK.STATUS.WARNING,
        activeChannels,
        totalChannels,
        metrics: this.connectionManager.getMetrics(),
        connectionState: {
          blocked: this.connectionManager.getConnection().blocked,
          connecting: this.connectionManager.getConnection().connecting
        }
      };

      // Check if we're in a degraded state
      if (activeChannels < totalChannels * HEALTH_CHECK.WARNING_THRESHOLD) {
        health.status = HEALTH_CHECK.STATUS.WARNING;
        health.message = 'Running with reduced channel capacity';
      }

      return health;
    } catch (error) {
      return { 
        status: HEALTH_CHECK.STATUS.ERROR, 
        message: error.message,
        metrics: this.connectionManager.getMetrics()
      };
    }
  }

  async close() {
    await this.channelManager.closeAll();
    await this.connectionManager.close();
  }
}

module.exports = new RabbitMQService();