const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const mailService = require('../../services/mail.service');
const doctorValidator = require('./doctor.validator');
const subscriptionService = require('../subscription/subscription.service');
const { CACHE_KEYS, CACHE_EXPIRY, DEFAULT_SCHEDULE } = require('./doctor.constants');

class DoctorService {
  async createDoctor(hospitalId, doctorData) {
    // Check doctor limit from subscription
    const subscription = await subscriptionService.getHospitalSubscription(hospitalId);
    if (!subscription) {
      throw new Error('No active subscription found');
    }

    const currentDoctorCount = await prisma.doctor.count({ where: { hospitalId } });
    if (currentDoctorCount >= subscription.plan.maxDoctors) {
      throw new Error('Doctor limit reached for current subscription plan');
    }

    // Validate doctor data
    const validationResult = doctorValidator.validateCreateDoctorData(doctorData);
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
    }

    // Create doctor with default schedule
    const doctor = await prisma.$transaction(async (tx) => {
      // Create doctor
      const newDoctor = await tx.doctor.create({
        data: {
          ...validationResult.data,
          hospitalId
        }
      });

      // Create default schedules for all days
      const schedules = await Promise.all(
        Array.from({ length: 7 }, (_, i) => tx.doctorSchedule.create({
          data: {
            doctorId: newDoctor.id,
            hospitalId,
            dayOfWeek: i,
            ...DEFAULT_SCHEDULE
          }
        }))
      );

      return { ...newDoctor, schedules };
    });

    // Send welcome email to doctor
    await mailService.sendMail(
      doctor.email,
      'Welcome to Tempus - Doctor Onboarding',
      this.getWelcomeEmailTemplate(doctor),
      hospitalId
    );

    // Invalidate hospital's doctor list cache
    await this.invalidateDoctorListCache(hospitalId);

    return doctor;
  }

  async updateDoctorDetails(hospitalId, doctorId, updateData) {
    // Validate update data
    const validationResult = doctorValidator.validateCreateDoctorData(updateData);
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
    }

    // Check if doctor exists and belongs to hospital
    const existingDoctor = await prisma.doctor.findFirst({
      where: { id: doctorId, hospitalId }
    });

    if (!existingDoctor) {
      throw new Error('Doctor not found');
    }

    // Update doctor
    const updatedDoctor = await prisma.doctor.update({
      where: { id: doctorId },
      data: validationResult.data
    });

    // Invalidate caches
    await Promise.all([
      redisService.invalidateCache(CACHE_KEYS.DOCTOR_DETAILS + doctorId),
      this.invalidateDoctorListCache(hospitalId)
    ]);

    return updatedDoctor;
  }

  async updateDoctorSchedule(hospitalId, doctorId, dayOfWeek, scheduleData) {
    // Validate schedule data
    const validationResult = doctorValidator.validateScheduleData(scheduleData);
    if (!validationResult.isValid) {
      throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
    }

    // Check if doctor exists and belongs to hospital
    const doctor = await prisma.doctor.findFirst({
      where: { id: doctorId, hospitalId },
      include: { schedules: true }
    });

    if (!doctor) {
      throw new Error('Doctor not found');
    }

    // Update schedule
    const updatedSchedule = await prisma.doctorSchedule.upsert({
      where: {
        doctorId_hospitalId_dayOfWeek: {
          doctorId,
          hospitalId,
          dayOfWeek
        }
      },
      create: {
        ...validationResult.data,
        doctorId,
        hospitalId,
        dayOfWeek
      },
      update: validationResult.data
    });

    // Send schedule update email
    await mailService.sendMail(
      doctor.email,
      'Schedule Update Notification',
      this.getScheduleUpdateEmailTemplate(doctor, updatedSchedule),
      hospitalId
    );

    // Invalidate schedule cache
    await redisService.invalidateCache(CACHE_KEYS.DOCTOR_SCHEDULE + doctorId);

    return updatedSchedule;
  }

  async getDoctorDetails(hospitalId, doctorId) {
    const cacheKey = CACHE_KEYS.DOCTOR_DETAILS + doctorId;
    
    // Try cache first
    const cachedDoctor = await redisService.getCache(cacheKey);
    if (cachedDoctor) {
      return cachedDoctor;
    }

    // Get from database with schedules
    const doctor = await prisma.doctor.findFirst({
      where: { id: doctorId, hospitalId },
      include: { schedules: true }
    });

    if (!doctor) {
      throw new Error('Doctor not found');
    }

    // Cache the result
    await redisService.setCache(cacheKey, doctor, CACHE_EXPIRY.DOCTOR_DETAILS);

    return doctor;
  }

  async listDoctors(hospitalId, filters = {}, pagination = { page: 1, limit: 10 }) {
    const cacheKey = CACHE_KEYS.DOCTOR_LIST + hospitalId;
    
    // For simplicity, only cache when no filters are applied
    if (Object.keys(filters).length === 0) {
      const cachedList = await redisService.getCache(cacheKey);
      if (cachedList) {
        return cachedList;
      }
    }

    const where = { hospitalId };

    // Apply filters
    if (filters.name) {
      where.name = { contains: filters.name, mode: 'insensitive' };
    }
    if (filters.specialization) {
      where.specialization = { contains: filters.specialization, mode: 'insensitive' };
    }

    const skip = (pagination.page - 1) * pagination.limit;

    // Get doctors with count
    const [total, doctors] = await prisma.$transaction([
      prisma.doctor.count({ where }),
      prisma.doctor.findMany({
        where,
        include: { schedules: true },
        skip,
        take: pagination.limit,
        orderBy: { name: 'asc' }
      })
    ]);

    const result = {
      data: doctors,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit)
      }
    };

    // Cache only if no filters
    if (Object.keys(filters).length === 0) {
      await redisService.setCache(cacheKey, result, CACHE_EXPIRY.DOCTOR_LIST);
    }

    return result;
  }

  // Helper methods
  async invalidateDoctorListCache(hospitalId) {
    await redisService.invalidateCache(CACHE_KEYS.DOCTOR_LIST + hospitalId);
  }

  getWelcomeEmailTemplate(doctor) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563EB;">Welcome to Tempus!</h2>
        <p>Dear Dr. ${doctor.name},</p>
        <p>Welcome to Tempus! You have been successfully registered as a doctor.</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
          <p><strong>Default Schedule:</strong></p>
          <p>Working Hours: ${DEFAULT_SCHEDULE.startTime} - ${DEFAULT_SCHEDULE.endTime}</p>
          <p>Lunch Time: ${DEFAULT_SCHEDULE.lunchTime}</p>
          <p>Average Consultation Duration: ${DEFAULT_SCHEDULE.avgConsultationTimeMinutes} minutes</p>
        </div>

        <p>You can update your schedule through the hospital administration.</p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="color: #64748b; font-size: 12px;">
          This is an automated email from Tempus. Please do not reply to this email.
        </p>
      </div>
    `;
  }

  getScheduleUpdateEmailTemplate(doctor, schedule) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563EB;">Schedule Update Notification</h2>
        <p>Dear Dr. ${doctor.name},</p>
        <p>Your schedule has been updated for ${days[schedule.dayOfWeek]}.</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
          <p><strong>Updated Schedule:</strong></p>
          <p>Working Hours: ${schedule.startTime} - ${schedule.endTime}</p>
          ${schedule.lunchTime ? `<p>Lunch Time: ${schedule.lunchTime}</p>` : ''}
          <p>Average Consultation Duration: ${schedule.avgConsultationTimeMinutes} minutes</p>
          <p>Status: ${schedule.status}</p>
        </div>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="color: #64748b; font-size: 12px;">
          This is an automated email from Tempus. Please do not reply to this email.
        </p>
      </div>
    `;
  }
}

module.exports = new DoctorService();