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
  LOW_CREDITS: 'LOW_CREDITS'
};


module.exports = {
  ALLOWED_UPDATE_FIELDS,
  DEFAULT_THEME_COLOR,
  LICENSE_WARNING_TYPES,
  ALLOWED_ADDRESS_UPDATE_FIELDS,
  ALLOWED_CONTACT_INFO
};