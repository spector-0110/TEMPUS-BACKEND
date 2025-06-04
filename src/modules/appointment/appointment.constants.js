// Appointment statuses matching the Prisma schema
const APPOINTMENT_STATUS = {
  BOOKED: 'booked',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  MISSED: 'missed'
};

// Appointment payment statuses matching the Prisma schema
const APPOINTMENT_PAYMENT_STATUS = {
  PAID: 'paid',
  UNPAID: 'unpaid'
};

const APPOINTMENT_PAYMENT_METHOD = {
  CASH: 'cash',
  UPI: 'upi',
  CARD: 'card'
};

// Notification statuses
const NOTIFICATION_STATUS = {
  SENT: 'sent',
  NOT_SENT: 'not_sent'
};

// Cache keys and TTL
const CACHE = {
  APPOINTMENT_PREFIX: 'appointment:',
  DOCTOR_APPOINTMENTS_PREFIX: 'doctor_appointments:',
  HOSPITAL_APPOINTMENTS_PREFIX: 'hospital_appointments:',
  APPOINTMENT_TTL: 60 * 60, // 1 hour
  LIST_TTL: 60 // 1 minutes
};

// Queue names for appointment module
const QUEUES = {
  APPOINTMENT_CREATED: 'appointments.created',
  APPOINTMENT_UPDATED: 'appointments.updated',
  APPOINTMENT_NOTIFICATION: 'appointments.notification'
};

// Tracking link configuration
const TRACKING_LINK = {
  TOKEN_EXPIRY: '3d', // JWT expiry for tracking links
  ALGORITHM: 'HS256' // JWT algorithm
};

// Queue tracking configuration
const QUEUE_TRACKING = {
  DEFAULT_CONSULTATION_TIME: 60, // minutes
  CACHE_PREFIX: 'queue:',
  POSITION_TTL: 300, // 5 minutes cache for queue positions
  UPDATE_CHANNEL: 'queue_updates',
  MAX_EARLY_ARRIVAL: 120 // minutes - how early can a patient arrive
};

module.exports = {
  APPOINTMENT_STATUS,
  APPOINTMENT_PAYMENT_STATUS,
  NOTIFICATION_STATUS,
  CACHE,
  QUEUES,
  TRACKING_LINK,
  APPOINTMENT_PAYMENT_METHOD,
  QUEUE_TRACKING
};