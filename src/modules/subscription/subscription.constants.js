const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  PENDING: 'pending'
};

const BILLING_CYCLE = {
  MONTHLY: 'monthly',
  YEARLY: 'yearly'
};

const CACHE_KEYS = {
  SUBSCRIPTION_PLANS: 'subscription:plans',
  HOSPITAL_SUBSCRIPTION: 'subscription:hospital:', // Append hospitalId
  USAGE_STATS: 'subscription:usage:' // Append hospitalId
};

const CACHE_EXPIRY = {
  SUBSCRIPTION_PLANS: 24 * 60 * 60, // 24 hours
  HOSPITAL_SUBSCRIPTION: 30 * 60, // 30 minutes
  USAGE_STATS: 5 * 60 // 5 minutes
};

const DEFAULT_CREDITS = {
  SMS: 1000,
  EMAIL: 5000
};

const ALLOWED_UPDATE_FIELDS = [
  'name',
  'description',
  'monthlyPrice',
  'yearlyPrice',
  'maxDoctors',
  'features'
];

const MIN_SUBSCRIPTION_PRICE = 0;
const MAX_DOCTORS_PER_PLAN = 1000;

module.exports = {
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE,
  CACHE_KEYS,
  CACHE_EXPIRY,
  DEFAULT_CREDITS,
  ALLOWED_UPDATE_FIELDS,
  MIN_SUBSCRIPTION_PRICE,
  MAX_DOCTORS_PER_PLAN
};