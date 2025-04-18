const ALLOWED_UPDATE_FIELDS = [
  'name',
  'dateOfBirth',
  'gender',
  'uhid',
  'contact',
  'address',
  'medicalInfo',
  'fileNumber'
];

const GENDER_OPTIONS = {
  MALE: 'male',
  FEMALE: 'female',
  OTHER: 'other'
};

const BLOOD_GROUPS = [
  'A+', 'A-',
  'B+', 'B-',
  'O+', 'O-',
  'AB+', 'AB-'
];

const CACHE_KEYS = {
  PATIENT_DETAILS: 'patient:details:',
  PATIENT_LIST: 'patient:list:hospital:'
};

const CACHE_EXPIRY = {
  PATIENT_DETAILS: 30 * 60, // 30 minutes
  PATIENT_LIST: 5 * 60 // 5 minutes
};

module.exports = {
  ALLOWED_UPDATE_FIELDS,
  GENDER_OPTIONS,
  BLOOD_GROUPS,
  CACHE_KEYS,
  CACHE_EXPIRY
};