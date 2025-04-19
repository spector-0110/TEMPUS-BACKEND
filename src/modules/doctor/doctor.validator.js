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
    const errors = [];

    // Check subscription features
    if (data.subscription && !data.subscription.planFeatures?.max_doctors) {
      errors.push('Invalid subscription plan features');
    }

    // Validate time fields
    if (data.startTime) {
      if (!this.isValidTimeFormat(data.startTime)) {
        errors.push('Invalid start time format');
      }
    }

    if (data.endTime) {
      if (!this.isValidTimeFormat(data.endTime)) {
        errors.push('Invalid end time format');
      }
    }

    if (data.lunchTime) {
      if (!this.isValidTimeFormat(data.lunchTime)) {
        errors.push('Invalid lunch time format');
      }
    }

    // Check time sequence
    if (data.startTime && data.endTime) {
      if (data.startTime >= data.endTime) {
        errors.push('End time must be after start time');
      }
    }

    // Check consultation time
    if (data.avgConsultationTimeMinutes !== undefined) {
      if (!Number.isInteger(data.avgConsultationTimeMinutes)) {
        errors.push('Average consultation time must be an integer');
      }
      if (data.avgConsultationTimeMinutes <= 0) {
        errors.push('Average consultation time must be positive');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      data: {
        startTime: data.startTime,
        endTime: data.endTime,
        lunchTime: data.lunchTime,
        avgConsultationTimeMinutes: data.avgConsultationTimeMinutes,
        status: data.status
      }
    };
  }

  isValidTimeFormat(time) {
    return /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(time);
  }
}

module.exports = new DoctorValidator();