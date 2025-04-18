const { ERROR_CODES } = require('./rabbitmq.constants');

class RabbitMQError extends Error {
  constructor(code, message, originalError = null) {
    super(message);
    this.name = 'RabbitMQError';
    this.code = code;
    this.timestamp = new Date();
    this.originalError = originalError;
  }
}

class ConnectionError extends RabbitMQError {
  constructor(message, originalError = null) {
    super(ERROR_CODES.CONNECTION_ERROR, message, originalError);
    this.name = 'RabbitMQConnectionError';
  }
}

class ChannelError extends RabbitMQError {
  constructor(message, channelId = null, originalError = null) {
    super(ERROR_CODES.CHANNEL_ERROR, message, originalError);
    this.name = 'RabbitMQChannelError';
    this.channelId = channelId;
  }
}

class PublishError extends RabbitMQError {
  constructor(message, queueOrExchange, messageDetails = null, originalError = null) {
    super(ERROR_CODES.PUBLISH_ERROR, message, originalError);
    this.name = 'RabbitMQPublishError';
    this.target = queueOrExchange;
    this.messageDetails = messageDetails;
  }
}

class ConsumeError extends RabbitMQError {
  constructor(message, queueName, consumerTag = null, originalError = null) {
    super(ERROR_CODES.CONSUME_ERROR, message, originalError);
    this.name = 'RabbitMQConsumeError';
    this.queueName = queueName;
    this.consumerTag = consumerTag;
  }
}

class QueueError extends RabbitMQError {
  constructor(message, queueName, operation, originalError = null) {
    super(ERROR_CODES.QUEUE_ERROR, message, originalError);
    this.name = 'RabbitMQQueueError';
    this.queueName = queueName;
    this.operation = operation;
  }
}

class ExchangeError extends RabbitMQError {
  constructor(message, exchangeName, operation, originalError = null) {
    super(ERROR_CODES.EXCHANGE_ERROR, message, originalError);
    this.name = 'RabbitMQExchangeError';
    this.exchangeName = exchangeName;
    this.operation = operation;
  }
}

module.exports = {
  RabbitMQError,
  ConnectionError,
  ChannelError,
  PublishError,
  ConsumeError,
  QueueError,
  ExchangeError
};