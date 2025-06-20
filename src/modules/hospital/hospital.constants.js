const ALLOWED_UPDATE_FIELDS = [
  'name',
  'address',
  'logo',
  'gstin',
  'establishedDate',
  'website',
  'contactInfo'
];

const ALLOWED_ADDRESS_UPDATE_FIELDS = [
  'street', 
  'city', 
  'district',
  'state', 
  'pincode', 
  'country'
];

const ALLOWED_CONTACT_INFO=[
  'phone',
  'website'
]

const DEFAULT_THEME_COLOR = '#2563EB';

const LICENSE_WARNING_TYPES = {
  DOCTOR_LIMIT: 'DOCTOR_LIMIT',
  SUBSCRIPTION_EXPIRING: 'SUBSCRIPTION_EXPIRING',
  LOW_CREDITS: 'LOW_CREDITS'
};

const DOCTOR_LIMIT_WARNING_THRESHOLD = 0.8; // 80% of max doctors
const SUBSCRIPTION_EXPIRY_WARNING_DAYS = 7;

module.exports = {
  ALLOWED_UPDATE_FIELDS,
  DEFAULT_THEME_COLOR,
  LICENSE_WARNING_TYPES,
  DOCTOR_LIMIT_WARNING_THRESHOLD,
  SUBSCRIPTION_EXPIRY_WARNING_DAYS,
  ALLOWED_ADDRESS_UPDATE_FIELDS,
  ALLOWED_CONTACT_INFO
};