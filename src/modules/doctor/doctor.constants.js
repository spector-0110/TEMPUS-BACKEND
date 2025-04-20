const SCHEDULE_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive'
};

const DOCTOR_STATUS = {
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

const generateDefaultTimeRanges = () => {
  return [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '17:00' }
  ];
};

const DEFAULT_SCHEDULE = {
  timeRanges: generateDefaultTimeRanges(),
  status: SCHEDULE_STATUS.ACTIVE,
  avgConsultationTime: 10
};

module.exports = {
  SCHEDULE_STATUS,
  DOCTOR_STATUS,
  CACHE_KEYS,
  CACHE_EXPIRY,
  DEFAULT_SCHEDULE,
};