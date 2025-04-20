const { z } = require('zod');
const { SCHEDULE_STATUS, DOCTOR_STATUS } = require('./doctor.constants');

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
      aadhar: z.string().optional(),
      status: z.enum([DOCTOR_STATUS.ACTIVE, DOCTOR_STATUS.INACTIVE]).default(DOCTOR_STATUS.ACTIVE)
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

  validateUpdateDoctorData(data, existingDoctor) {
    // Create schemas for different types of updates
    const basicInfoSchema = z.object({
      name: z.string().min(2).max(100).optional(),
      specialization: z.string().min(2).max(100).optional(),
      qualification: z.string().min(2).max(100).optional(),
      experience: z.number().int().min(0).optional(),
      age: z.number().int().min(20).max(100).optional(),
    });

    const contactInfoSchema = z.object({
      phone: z.string().regex(/^\+?[\d\s-]{8,}$/).optional(),
      email: z.string().email().optional(),
    });

    const statusSchema = z.object({
      status: z.enum([DOCTOR_STATUS.ACTIVE, DOCTOR_STATUS.INACTIVE]).optional()
    });

    const otherInfoSchema = z.object({
      photo: z.string().url().optional(),
      aadhar: z.string().optional(),
    });

    // Combine all schemas
    const updateSchema = basicInfoSchema.merge(contactInfoSchema).merge(statusSchema).merge(otherInfoSchema);

    try {
      // First validate the structure of the update data
      const validatedData = updateSchema.parse(data);

      // Now perform business logic validations
      const errors = [];

      // If updating contact info, check for duplicates (this will be handled by service layer)
      const isContactUpdate = data.email !== undefined || data.phone !== undefined;
      
      // Check if any data is actually changed
      const changedFields = Object.keys(validatedData).reduce((acc, key) => {
        if (validatedData[key] !== existingDoctor[key]) {
          acc[key] = validatedData[key];
        }
        return acc;
      }, {});

      if (Object.keys(changedFields).length === 0) {
        return {
          isValid: false,
          errors: [{
            field: 'general',
            message: 'No fields to update'
          }]
        };
      }

      if (errors.length > 0) {
        return {
          isValid: false,
          errors: errors.map(error => ({
            field: error.field,
            message: error.message
          }))
        };
      }

      return {
        isValid: true,
        data: changedFields,
        isContactUpdate
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
    const timeRangeSchema = z.object({
      start: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
      end: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format')
    }).refine(data => data.start < data.end, {
      message: 'End time must be after start time'
    });

    const scheduleSchema = z.object({
      avgConsultationTime: z.number().int().positive(),
      timeRanges: z.array(timeRangeSchema).min(1).refine(
        ranges => {
          // Sort ranges by start time
          const sortedRanges = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
          
          // Check for overlaps
          for (let i = 0; i < sortedRanges.length - 1; i++) {
            if (sortedRanges[i].end > sortedRanges[i + 1].start) {
              return false;
            }
          }
          return true;
        },
        {
          message: 'Time ranges must not overlap'
        }
      ),
      status: z.enum([SCHEDULE_STATUS.ACTIVE, SCHEDULE_STATUS.INACTIVE]).default(SCHEDULE_STATUS.ACTIVE)
    });

    try {
      const validatedData = scheduleSchema.parse(data);
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

  // Helper method to add minutes to time string
  addMinutesToTime(timeStr, minutes) {
    const [hours, mins] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, mins);
    date.setMinutes(date.getMinutes() + minutes);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  isValidTimeFormat(time) {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
  }
}

module.exports = new DoctorValidator();