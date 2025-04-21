const SUBSCRIPTION_STATUS = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  PENDING: 'PENDING'
};

const BILLING_CYCLE = {
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY'
};

const MESSAGE_STATUS = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED'
};

const MESSAGE_TYPE = {
  SMS: 'SMS',
  EMAIL: 'EMAIL'
};

const MESSAGE_TEMPLATE = {
  OTP: 'OTP',
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  SUBSCRIPTION_NOTIFICATION: 'SUBSCRIPTION_NOTIFICATION',
  GENERAL_NOTIFICATION: 'GENERAL_NOTIFICATION'
};

const CACHE_KEYS = {
  HOSPITAL_SUBSCRIPTION: 'subscription:hospital:', // Append hospitalId
  USAGE_STATS: 'usage:hospital:', // Append hospitalId
};

const CACHE_EXPIRY = {
  HOSPITAL_SUBSCRIPTION: 30 * 60, // 30 minutes
  USAGE_STATS: 5 * 60, // 5 minutes
};

const PRICING = {
  BASE_PRICE_PER_DOCTOR: 5999, // Base price per doctor
  YEARLY_DISCOUNT_PERCENTAGE: 20, // 20% discount for yearly billing
  VOLUME_DISCOUNTS: [
    { minDoctors: 5, discount: 5 }, // 5% off for 5+ doctors
    { minDoctors: 10, discount: 10 }, // 10% off for 10+ doctors
    { minDoctors: 20, discount: 15 }, // 15% off for 20+ doctors
    { minDoctors: 50, discount: 20 }, // 20% off for 50+ doctors
  ]
};

const LIMITS = {
  MIN_DOCTORS: 1,
  MAX_DOCTORS: 1000,
  MAX_RETRY_ATTEMPTS: 3,
  MESSAGE_BATCH_SIZE: 100
};

const SUBSCRIPTION_EXPIRY_WARNING_DAYS = 7;

module.exports = {
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE,
  MESSAGE_STATUS,
  MESSAGE_TYPE,
  MESSAGE_TEMPLATE,
  CACHE_KEYS,
  CACHE_EXPIRY,
  PRICING,
  LIMITS,
  SUBSCRIPTION_EXPIRY_WARNING_DAYS
};