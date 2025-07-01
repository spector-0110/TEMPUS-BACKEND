// Staff role enum values
const STAFF_ROLES = {
  STAFF_NURSE: 'Staff_Nurse',
  OPD_ASSISTANT: 'OPD_Assistant',
  RECEPTIONIST: 'Receptionist',
  OPD_MANAGER: 'OPD_Manager',
  HELPER: 'Helper',
  DOCTOR: 'Doctor'
};

// Staff salary type enum values
const STAFF_SALARY_TYPES = {
  MONTHLY: 'monthly',
  DAILY: 'daily'
};

// Staff attendance status enum values
const STAFF_ATTENDANCE_STATUS = {
  PRESENT: 'present',
  ABSENT: 'absent',
  PAID_LEAVE: 'paid_leave',
  HALF_DAY: 'half_day',
  WEEK_HOLIDAY: 'week_holiday'
};

// Staff payment type enum values
const STAFF_PAYMENT_TYPES = {
  SALARY: 'salary',
  ADVANCE: 'advance',
  BONUS: 'bonus',
  LOAN: 'loan'
};

// Staff payment mode enum values
const STAFF_PAYMENT_MODES = {
  CASH: 'cash',
  BANK_TRANSFER: 'bank_transfer',
  UPI: 'upi',
  CARD: 'card',
  CHEQUE: 'cheque',
  NET_BANKING: 'net_banking',
  OTHER: 'other'
};

module.exports = {
  STAFF_ROLES,
  STAFF_SALARY_TYPES,
  STAFF_ATTENDANCE_STATUS,
  STAFF_PAYMENT_TYPES,
  STAFF_PAYMENT_MODES
};
