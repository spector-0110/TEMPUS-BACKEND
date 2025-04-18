const { z } = require('zod');
const { SCHEDULE_STATUS } = require('./doctor.constants');

class DoctorValidator {
  validateCreateDoctorData(data) {
    const schema = z.object({
      name: z.string().min(2).max(100),
      specialization: z.string().min(2).max(100).optional(),
      qualification: z.string().min(2).max(100).optional(),
      experience: z.number().int().min(0).optional(),
      age: z.number().int().min(20).max(100).optional(),
      phone: z.string().regex(/^\+?[\d\s-]{8,}$/),
      email: z.string().email(),
      photo: z.string().url().optional(),
      aadhar: z.string().optional()
    });

    try {
      const validatedData = schema.parse(data);
      return {
        isValid: true,
        data: validatedData
      };
    } catch (error) {
      return {
        isValid: false,
        errors: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }))
      };
    }
  }

  validateScheduleData(data) {
    const schema = z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
      endTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
      lunchTime: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
      avgConsultationTimeMinutes: z.number().int().min(5).max(120).optional(),
      status: z.enum([SCHEDULE_STATUS.ACTIVE, SCHEDULE_STATUS.INACTIVE]).default(SCHEDULE_STATUS.ACTIVE)
    });

    try {
      const validatedData = schema.parse(data);
      // Validate that end time is after start time
      const start = new Date(`1970-01-01T${validatedData.startTime}`);
      const end = new Date(`1970-01-01T${validatedData.endTime}`);
      
      if (end <= start) {
        return {
          isValid: false,
          errors: [{
            field: 'endTime',
            message: 'End time must be after start time'
          }]
        };
      }

      return {
        isValid: true,
        data: validatedData
      };
    } catch (error) {
      return {
        isValid: false,
        errors: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }))
      };
    }
  }
}

module.exports = new DoctorValidator();