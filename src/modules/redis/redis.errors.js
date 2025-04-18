class RedisBaseError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

class RedisConnectionError extends RedisBaseError {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
  }
}

class RedisOperationError extends RedisBaseError {
  constructor(message, operation, details = {}) {
    super(message);
    this.operation = operation;
    this.details = details;
  }
}

class CircuitBreakerError extends RedisBaseError {
  constructor(message, state) {
    super(message);
    this.state = state;
  }
}

class RedisCacheError extends RedisBaseError {
  constructor(message, key, operation) {
    super(message);
    this.key = key;
    this.operation = operation;
  }
}

module.exports = {
  RedisBaseError,
  RedisConnectionError,
  RedisOperationError,
  CircuitBreakerError,
  RedisCacheError
};