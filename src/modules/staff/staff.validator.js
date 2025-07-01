const Joi = require('joi');
const { 
  STAFF_ROLES, 
  STAFF_SALARY_TYPES, 
  STAFF_PAYMENT_TYPES, 
  STAFF_PAYMENT_MODES 
} = require('./staff.constants');

// Base staff validation schema for creation
const createStaffSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    'string.min': 'Staff name must be at least 2 characters long',
    'string.max': 'Staff name cannot exceed 100 characters',
    'string.empty': 'Staff name is required',
    'any.required': 'Staff name is required'
  }),

  age: Joi.number().integer().min(10).max(100).required().messages({
    'number.base': 'Age must be a number',
    'number.min': 'Age must be at least 10',
    'number.max': 'Age cannot exceed 100',
    'any.required': 'Age is required'
  }),

  mobileNumber: Joi.string().pattern(/^[0-9]{10}$/).required().messages({
    'string.pattern.base': 'Mobile number must be between 10 digits'
  }),

  aadhaarCard: Joi.string().pattern(/^[0-9]{12}$/).optional().messages({
    'string.pattern.base': 'Aadhaar card must be exactly 12 digits'
  }),

  photoUrl: Joi.string().uri().optional().messages({
    'string.uri': 'Photo URL must be a valid URL'
  }),

  staffRole: Joi.string()
    .valid(...Object.values(STAFF_ROLES))
    .required()
    .messages({
      'any.only': `Staff role must be one of: ${Object.values(STAFF_ROLES).join(', ')}`,
      'any.required': 'Staff role is required'
    }),

  salaryType: Joi.string()
    .valid(...Object.values(STAFF_SALARY_TYPES))
    .required()
    .messages({
      'any.only': `Salary type must be one of: ${Object.values(STAFF_SALARY_TYPES).join(', ')}`,
      'any.required': 'Salary type is required'
    }),

  salaryAmount: Joi.number().positive().precision(2).required().messages({
    'number.base': 'Salary amount must be a number',
    'number.positive': 'Salary amount must be positive',
    'any.required': 'Salary amount is required'
  }),

  salaryCreditCycle: Joi.number().integer().min(1).max(28).required().messages({
    'number.base': 'Salary credit cycle must be a number',
    'number.min': 'Salary credit cycle must be at least 1 day',
    'number.max': 'Salary credit cycle cannot exceed 28 days',
    'any.required': 'Salary credit cycle is required'
  }),

  isActive: Joi.boolean().optional().default(true)
});

// Schema for updating staff (limited fields only)
const updateStaffSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional().messages({
    'string.min': 'Staff name must be at least 2 characters long',
    'string.max': 'Staff name cannot exceed 100 characters',
    'string.empty': 'Staff name cannot be empty'
  }),

  age: Joi.number().integer().min(10).max(100).optional().messages({
    'number.base': 'Age must be a number',
    'number.min': 'Age must be at least 10',
    'number.max': 'Age cannot exceed 100'
  }),

  photoUrl: Joi.string().uri().optional().messages({
    'string.uri': 'Photo URL must be a valid URL'
  }),

  mobileNumber: Joi.string().pattern(/^[0-9]{10,12}$/).optional().messages({
    'string.pattern.base': 'Mobile number must be between 10-12 digits'
  }),

  aadhaarCard: Joi.string().pattern(/^[0-9]{12}$/).optional().messages({
    'string.pattern.base': 'Aadhaar card must be exactly 12 digits'
  }),

  staffRole: Joi.string()
    .valid(...Object.values(STAFF_ROLES))
    .optional()
    .messages({
      'any.only': `Staff role must be one of: ${Object.values(STAFF_ROLES).join(', ')}`
    }),

  salaryAmount: Joi.number().positive().precision(2).optional().messages({
    'number.base': 'Salary amount must be a number',
    'number.positive': 'Salary amount must be positive'
  }),

  isActive: Joi.boolean().optional()
}).min(1).messages({
  'object.min': 'At least one field must be provided for update'
});

// Schema for staff ID validation
const staffIdSchema = Joi.object({
  id: Joi.string().uuid().required().messages({
    'string.uuid': 'Staff ID must be a valid UUID',
    'string.empty': 'Staff ID is required',
    'any.required': 'Staff ID is required'
  })
});

// Schema for payment ID validation
const paymentIdSchema = Joi.object({
  id: Joi.string().uuid().required().messages({
    'string.uuid': 'Payment ID must be a valid UUID',
    'string.empty': 'Payment ID is required',
    'any.required': 'Payment ID is required'
  })
});

// Schema for staff payment creation
const createStaffPaymentSchema = Joi.object({
  amount: Joi.number().positive().precision(2).required().messages({
    'number.base': 'Payment amount must be a number',
    'number.positive': 'Payment amount must be positive',
    'any.required': 'Payment amount is required'
  }),

  paymentType: Joi.string()
    .valid(...Object.values(STAFF_PAYMENT_TYPES))
    .required()
    .messages({
      'any.only': `Payment type must be one of: ${Object.values(STAFF_PAYMENT_TYPES).join(', ')}`,
      'any.required': 'Payment type is required'
    }),

  paymentMode: Joi.string()
    .valid(...Object.values(STAFF_PAYMENT_MODES))
    .required()
    .messages({
      'any.only': `Payment mode must be one of: ${Object.values(STAFF_PAYMENT_MODES).join(', ')}`,
      'any.required': 'Payment mode is required'
    }),

  paymentDate: Joi.date().iso().required().messages({
    'date.base': 'Payment date must be a valid date',
    'date.format': 'Payment date must be in ISO format',
    'any.required': 'Payment date is required'
  }),

  remarks: Joi.string().trim().max(500).optional().messages({
    'string.max': 'Remarks cannot exceed 500 characters'
  })
});

// Schema for updating staff payment (limited fields only)
const updateStaffPaymentSchema = Joi.object({
  amount: Joi.number().positive().precision(2).optional().messages({
    'number.base': 'Payment amount must be a number',
    'number.positive': 'Payment amount must be positive'
  }),

  paymentMode: Joi.string()
    .valid(...Object.values(STAFF_PAYMENT_MODES))
    .optional()
    .messages({
      'any.only': `Payment mode must be one of: ${Object.values(STAFF_PAYMENT_MODES).join(', ')}`
    }),

  paymentDate: Joi.date().iso().optional().messages({
    'date.base': 'Payment date must be a valid date',
    'date.format': 'Payment date must be in ISO format'
  }),

  remarks: Joi.string().trim().max(500).optional().messages({
    'string.max': 'Remarks cannot exceed 500 characters'
  })
}).min(1).messages({
  'object.min': 'At least one field must be provided for update'
});

// Schema for attendance marking/updating
const attendanceSchema = Joi.object({
  staffId: Joi.string().uuid().required().messages({
    'string.uuid': 'Staff ID must be a valid UUID',
    'string.empty': 'Staff ID is required',
    'any.required': 'Staff ID is required'
  }),

  attendanceDate: Joi.date().iso().required().messages({
    'date.base': 'Attendance date must be a valid date',
    'date.format': 'Attendance date must be in ISO format',
    'any.required': 'Attendance date is required'
  }),

  status: Joi.string()
    .valid('present', 'absent', 'paid_leave', 'half_day', 'week_holiday')
    .required()
    .messages({
      'any.only': 'Status must be one of: present, absent, paid_leave, half_day, week_holiday',
      'any.required': 'Attendance status is required'
    })
});

// Validation functions
module.exports = {
  validateCreateStaff: (data) => createStaffSchema.validate(data, { abortEarly: false }),
  validateUpdateStaff: (data) => updateStaffSchema.validate(data, { abortEarly: false }),
  validateCreateStaffPayment: (data) => createStaffPaymentSchema.validate(data, { abortEarly: false }),
  validateUpdateStaffPayment: (data) => updateStaffPaymentSchema.validate(data, { abortEarly: false }),
  validateStaffId: (data) => staffIdSchema.validate(data, { abortEarly: false }),
  validatePaymentId: (data) => paymentIdSchema.validate(data, { abortEarly: false }),
  validateAttendance: (data) => attendanceSchema.validate(data, { abortEarly: false }),
  STAFF_ROLES,
  STAFF_SALARY_TYPES,
  STAFF_PAYMENT_TYPES,
  STAFF_PAYMENT_MODES
};
