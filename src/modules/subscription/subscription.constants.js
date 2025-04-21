const SUBSCRIPTION_STATUS = {
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  SUSPENDED: 'SUSPENDED'
};

const BILLING_CYCLE = {
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY'
};

const NOTIFICATION_STATUS = {
  SENT: 'SENT',
  PENDING: 'PENDING',
  FAILED: 'FAILED'
};

const CACHE_KEYS = {
  HOSPITAL_SUBSCRIPTION: 'hospital:subscription:',
  USAGE_STATS: 'usage:hospital:', // Append hospitalId
};

const CACHE_EXPIRY = {
  HOSPITAL_SUBSCRIPTION: 3600, // 1 hour in seconds
  USAGE_STATS: 5 * 60, // 5 minutes
};

const PRICING = {
  BASE_PRICE_PER_DOCTOR: 5999.99,  // Base price per doctor per month
  YEARLY_DISCOUNT_PERCENTAGE: 20, // 20% discount for yearly subscriptions
  VOLUME_DISCOUNTS: [
    { minDoctors: 50, discount: 10 },  // 10% discount for 50+ doctors
    { minDoctors: 100, discount: 15 }, // 15% discount for 100+ doctors
    { minDoctors: 200, discount: 20 }, // 20% discount for 200+ doctors
  ]
};

const LIMITS = {
  MIN_DOCTORS: 1,
  MAX_DOCTORS: 1000
};

const SUBSCRIPTION_EXPIRY_WARNING_DAYS = 7;

module.exports = {
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE,
  NOTIFICATION_STATUS,
  CACHE_KEYS,
  CACHE_EXPIRY,
  PRICING,
  LIMITS,
  SUBSCRIPTION_EXPIRY_WARNING_DAYS
};