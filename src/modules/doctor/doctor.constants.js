const SCHEDULE_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive'
};

const CACHE_KEYS = {
  DOCTOR_DETAILS: 'doctor:details:', // Append doctorId
  DOCTOR_LIST: 'doctor:list:', // Append hospitalId
  DOCTOR_SCHEDULE: 'doctor:schedule:', // Append doctorId
};

const CACHE_EXPIRY = {
  DOCTOR_DETAILS: 30 * 60, // 30 minutes
  DOCTOR_LIST: 5 * 60, // 5 minutes
  DOCTOR_SCHEDULE: 15 * 60 // 15 minutes
};

const DEFAULT_SCHEDULE = {
  startTime: '09:00',
  endTime: '17:00',
  lunchTime: '13:00',
  avgConsultationTimeMinutes: 15
};

module.exports = {
  SCHEDULE_STATUS,
  CACHE_KEYS,
  CACHE_EXPIRY,
  DEFAULT_SCHEDULE
};