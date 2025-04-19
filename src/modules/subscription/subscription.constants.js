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

const FEATURE_LIMITS = {
  MIN_DOCTORS: 1,
  MAX_DOCTORS: 100,
  MIN_SMS_CREDITS: 0,
  MAX_SMS_CREDITS: 100000,
  MIN_EMAIL_CREDITS: 0,
  MAX_EMAIL_CREDITS: 500000
};

const DEFAULT_FEATURES = {
  max_doctors: 1,
  base_sms_credits: 100,
  base_email_credits: 500,
  analytics_access: false,
  reporting_access: false,
  premium_support: false,
  custom_branding: false,
  additional_features: []
};

const ALLOWED_UPDATE_FIELDS = [
  'name',
  'description',
  'monthlyPrice',
  'yearlyPrice',
  'features'
];

const MIN_SUBSCRIPTION_PRICE = 0;
const MAX_DOCTORS_PER_PLAN = 1000;
const SUBSCRIPTION_EXPIRY_WARNING_DAYS = 7;

module.exports = {
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE,
  CACHE_KEYS,
  CACHE_EXPIRY,
  DEFAULT_CREDITS,
  FEATURE_LIMITS,
  DEFAULT_FEATURES,
  ALLOWED_UPDATE_FIELDS,
  MIN_SUBSCRIPTION_PRICE,
  MAX_DOCTORS_PER_PLAN,
  SUBSCRIPTION_EXPIRY_WARNING_DAYS
};