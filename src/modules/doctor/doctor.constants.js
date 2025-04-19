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

const today = new Date();

const toTime = (timeStr) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date(today);
  date.setHours(hours, minutes, 0, 0);
  return date;
};

const DEFAULT_SCHEDULE = {
  startTime: toTime('09:00'),
  endTime: toTime('17:00'),
  lunchTime: toTime('13:00'),
  avgConsultationTimeMinutes: 15
};

module.exports = {
  SCHEDULE_STATUS,
  CACHE_KEYS,
  CACHE_EXPIRY,
  DEFAULT_SCHEDULE
};