const Joi = require('joi');
const { APPOINTMENT_STATUS, APPOINTMENT_PAYMENT_STATUS ,APPOINTMENT_PAYMENT_METHOD} = require('./appointment.constants');

// Base appointment validation schema
const appointmentSchema = Joi.object({
  hospitalId: Joi.string().uuid().required().messages({
    'string.uuid': 'Hospital ID must be a valid UUID',
    'string.empty': 'Hospital ID is required',
    'any.required': 'Hospital ID is required'
  }),
  
  doctorId: Joi.string().uuid().required().messages({
    'string.uuid': 'Doctor ID must be a valid UUID',
    'string.empty': 'Doctor ID is required',
    'any.required': 'Doctor ID is required'
  }),
  
  patientName: Joi.string().trim().min(2).max(100).required().messages({
    'string.min': 'Patient name must be at least 2 characters long',
    'string.max': 'Patient name cannot exceed 100 characters',
    'string.empty': 'Patient name is required',
    'any.required': 'Patient name is required'
  }),
  
  mobile: Joi.string().pattern(/^[0-9]{10,12}$/).required().messages({
    'string.pattern.base': 'Mobile number must be between 10-12 digits',
    'string.empty': 'Mobile number is required',
    'any.required': 'Mobile number is required'
  }),
  
  age: Joi.number().integer().min(0).max(120).allow(null).messages({
    'number.base': 'Age must be a number',
    'number.min': 'Age must be at least 0',
    'number.max': 'Age cannot exceed 120'
  }),
  
  appointmentDate: Joi.date().iso().required().messages({
    'date.base': 'Appointment date must be a valid date',
    'date.format': 'Appointment date must be in ISO format (YYYY-MM-DD)',
    'any.required': 'Appointment date is required'
  }),
  
  startTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).allow(null).messages({
    'string.pattern.base': 'Start time must be in 24-hour format (HH:MM)'
  }),
  
  endTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).allow(null).messages({
    'string.pattern.base': 'End time must be in 24-hour format (HH:MM)'
  }),
  
  paymentStatus: Joi.string()
  .valid(...Object.values(APPOINTMENT_PAYMENT_STATUS))
  .optional()
  .messages({
    'any.only': `Payment status must be one of: ${Object.values(APPOINTMENT_PAYMENT_STATUS).join(', ')}`
  }),

  paymentMethod: Joi.string()
  .valid(...Object.values(APPOINTMENT_PAYMENT_METHOD))
  .optional()
  .messages({
    'any.only': `Payment method must be one of: ${Object.values(APPOINTMENT_PAYMENT_METHOD).join(', ')}`
  }),

});

// Schema for updating appointment status
const appointmentStatusSchema = Joi.object({
  status: Joi.string()
    .valid(...Object.values(APPOINTMENT_STATUS))
    .required()
    .messages({
      'any.only': `Status must be one of: ${Object.values(APPOINTMENT_STATUS).join(', ')}`,
      'any.required': 'Status is required'
    })
});

// Schema for updating payment status

const paymentStatusSchema = Joi.object({
  paymentStatus: Joi.string()
    .valid(...Object.values(APPOINTMENT_PAYMENT_STATUS))
    .required()
    .messages({
      'any.only': `Payment status must be one of: ${Object.values(APPOINTMENT_PAYMENT_STATUS).join(', ')}`,
      'any.required': 'Payment status is required'
    }),
  paymentMethod: Joi.string()
    .valid(...Object.values(APPOINTMENT_PAYMENT_METHOD))
    .required()
    .messages({
      'any.only': `Payment method must be one of: ${Object.values(APPOINTMENT_PAYMENT_METHOD).join(', ')}`,
      'any.required': 'Payment method is required'
    }),
  amount: Joi.number()
  .positive()
    .required()
    .messages({
        'number.base': 'Amount must be a number',
        'number.positive': 'Amount must be a positive number',
        'any.required': 'Amount is required'
      })
});

// Schema for appointment ID validation
const appointmentIdSchema = Joi.object({
  id: Joi.string().uuid().required().messages({
    'string.uuid': 'Appointment ID must be a valid UUID',
    'string.empty': 'Appointment ID is required',
    'any.required': 'Appointment ID is required'
  })
});

// Schema for tracking token validation
const trackingTokenSchema = Joi.object({
  token: Joi.string().required().messages({
    'string.empty': 'Tracking token is required',
    'any.required': 'Tracking token is required'
  })
});

module.exports = {
  validateAppointment: (data) => appointmentSchema.validate(data, { abortEarly: false }),
  validateAppointmentStatus: (data) => appointmentStatusSchema.validate(data, { abortEarly: false }),
  validatePaymentStatus: (data) => paymentStatusSchema.validate(data, { abortEarly: false }),
  validateAppointmentId: (data) => appointmentIdSchema.validate(data, { abortEarly: false }),
  validateTrackingToken: (data) => trackingTokenSchema.validate(data, { abortEarly: false })
};
