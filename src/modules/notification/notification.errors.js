class NotificationBaseError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends NotificationBaseError {
  constructor(message, validationErrors = []) {
    super(message);
    this.validationErrors = validationErrors;
  }
}

class NotificationQueueError extends NotificationBaseError {
  constructor(message, queueName, originalError = null) {
    super(message);
    this.queueName = queueName;
    this.originalError = originalError;
  }
}

class NotificationCacheError extends NotificationBaseError {
  constructor(message, operation, originalError = null) {
    super(message);
    this.operation = operation;
    this.originalError = originalError;
  }
}

class ReminderSchedulingError extends NotificationBaseError {
  constructor(message, appointmentId, originalError = null) {
    super(message);
    this.appointmentId = appointmentId;
    this.originalError = originalError;
  }
}

module.exports = {
  NotificationBaseError,
  ValidationError,
  NotificationQueueError,
  NotificationCacheError,
  ReminderSchedulingError
};