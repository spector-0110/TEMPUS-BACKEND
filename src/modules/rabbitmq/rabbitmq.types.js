/**
 * @typedef {Object} RabbitMQConfig
 * @property {string[]} clusterNodes - Array of RabbitMQ node URLs
 * @property {number} maxConnectionAttempts - Maximum number of connection retry attempts
 * @property {number} reconnectDelay - Delay between reconnection attempts in ms
 * @property {number} maxChannels - Maximum number of channels in the pool
 * @property {Object} persistenceConfig - Message persistence configuration
 * @property {boolean} persistenceConfig.durable - Whether queues should survive broker restart
 * @property {boolean} persistenceConfig.persistent - Whether messages should survive broker restart
 * @property {boolean} persistenceConfig.noAck - Whether to use message acknowledgments
 * @property {number} persistenceConfig.prefetch - Number of messages to prefetch
 */

/**
 * @typedef {Object} QueueOptions
 * @property {boolean} [durable=true] - Whether the queue should survive broker restart
 * @property {boolean} [autoDelete=false] - Whether to delete queue when last consumer unsubscribes
 * @property {boolean} [exclusive=false] - Whether the queue can be accessed by other connections
 * @property {Object} [arguments] - Optional arguments for the queue
 * @property {string} [deadLetterExchange] - Exchange for dead-lettered messages
 * @property {string} [deadLetterRoutingKey] - Routing key for dead-lettered messages
 * @property {number} [messageTtl] - Message time-to-live in milliseconds
 * @property {number} [maxLength] - Maximum number of messages in queue
 * @property {string} [queueMode='default'] - Queue mode (default or lazy)
 */

/**
 * @typedef {Object} ExchangeOptions
 * @property {boolean} [durable=true] - Whether the exchange should survive broker restart
 * @property {boolean} [autoDelete=false] - Whether to delete exchange when last binding is removed
 * @property {boolean} [internal=false] - Whether the exchange can be used directly by publishers
 * @property {Object} [arguments] - Optional arguments for the exchange
 */

/**
 * @typedef {Object} PublishOptions
 * @property {string} [messageId] - Unique identifier for the message
 * @property {number} [timestamp] - Message timestamp
 * @property {Object} [headers] - Message headers
 * @property {number} [expiration] - Message expiration in milliseconds
 * @property {string} [userId] - User ID
 * @property {string} [appId] - Application ID
 * @property {string} [clusterId] - Cluster ID
 */

/**
 * @typedef {Object} ConsumeOptions
 * @property {boolean} [noAck=false] - Whether to use message acknowledgments
 * @property {boolean} [exclusive=false] - Whether only this consumer can access the queue
 * @property {number} [prefetch] - Number of messages to prefetch
 * @property {number} [maxRetries=3] - Maximum number of retry attempts
 */

/**
 * @typedef {Object} ChannelWrapper
 * @property {Object} channel - The amqplib channel instance
 * @property {number} id - Channel ID in the pool
 * @property {boolean} closed - Whether the channel is closed
 * @property {Date} createdAt - When the channel was created
 * @property {number} messageCount - Number of messages processed
 */

/**
 * @typedef {Object} ConnectionMetrics
 * @property {number} messagesPublished - Total messages published
 * @property {number} messagesConsumed - Total messages consumed
 * @property {number} errors - Total error count
 * @property {number} reconnections - Total reconnection attempts
 * @property {Object} lastError - Last error details
 * @property {Date} lastError.timestamp - When the last error occurred
 * @property {string} lastError.message - Last error message
 */

module.exports = {};  // Types are just for documentation