const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const mailService = require('../../services/mail.service');
const rabbitmqService = require('../../services/rabbitmq.service');
const doctorValidator = require('./doctor.validator');
const subscriptionService = require('../subscription/subscription.service');
const { CACHE_KEYS, CACHE_EXPIRY, DEFAULT_SCHEDULE, SCHEDULE_STATUS } = require('./doctor.constants');

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

    // Get doctor with minimal required fields in a single query
    const doctor = await prisma.doctor.findFirst({
      where: { 
        id: doctorId, 
        hospitalId,
        status: 'ACTIVE' // Only active doctors can have schedule updates
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        hospitalId: true,
        schedules: {
          where: {
            dayOfWeek: dayOfWeek
          },
          select: {
            startTime: true,
            endTime: true
          }
        }
      }
    });

    if (!doctor) {
      throw new Error('Doctor not found or inactive');
    }

    // Start a transaction for schedule update and affected appointments
    const { updatedSchedule, affectedAppointments } = await prisma.$transaction(async (tx) => {
      // Update schedule
      const schedule = await tx.doctorSchedule.upsert({
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
          dayOfWeek,
          status: scheduleData.status || SCHEDULE_STATUS.ACTIVE
        },
        update: validationResult.data
      });

      // Get affected appointments only if schedule is being made inactive or time window changed
      let affected = [];
      const scheduleChanged = doctor.schedules[0] && (
        doctor.schedules[0].startTime !== scheduleData.startTime || 
        doctor.schedules[0].endTime !== scheduleData.endTime
      );

      if (scheduleData.status === SCHEDULE_STATUS.INACTIVE || scheduleChanged) {
        affected = await tx.appointment.findMany({
          where: {
            doctorId,
            scheduledTime: {
              gte: new Date(),
            },
            status: 'CONFIRMED',
            AND: {
              scheduledTime: {
                gte: this.getNextDayOfWeek(dayOfWeek),
              }
            }
          },
          select: {
            id: true,
            scheduledTime: true,
            duration: true,
            patient: {
              select: {
                name: true,
                phone: true
              }
            }
          }
        });
      }

      return { 
        updatedSchedule: schedule, 
        affectedAppointments: affected 
      };
    });

    // Handle notifications if there are affected appointments
    if (affectedAppointments.length > 0) {
      await this.notifyScheduleChanges(doctor, affectedAppointments, 'schedule update');
    }

    // Invalidate relevant caches
    await Promise.all([
      redisService.invalidateCache(CACHE_KEYS.DOCTOR_SCHEDULE + doctorId),
      redisService.invalidateCache(CACHE_KEYS.DOCTOR_DETAILS + doctorId)
    ]);

    return updatedSchedule;
  }

  async getHospitalAdminEmail(hospitalId) {
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { adminEmail: true }
    });
    return hospital?.adminEmail;
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

  async listDoctors(hospitalId) {
    const cacheKey = CACHE_KEYS.DOCTOR_LIST + hospitalId;
    
    // Try cache first
    const cachedDoctors = await redisService.getCache(cacheKey);
    if (cachedDoctors) {
      return cachedDoctors;
    }

    // Get all doctors with their schedules
    const doctors = await prisma.doctor.findMany({
      where: { 
        hospitalId 
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        specialization: true,
        qualification: true,
        experience: true,
        photo: true,
        status: true,
        schedules: {
          select: {
            dayOfWeek: true,
            startTime: true,
            endTime: true,
            lunchTime: true,
            status: true,
            avgConsultationTimeMinutes: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    // Cache the result
    await redisService.setCache(cacheKey, doctors, CACHE_EXPIRY.DOCTOR_LIST);

    return doctors;
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

  // Helper method to get next occurrence of a day of week
  getNextDayOfWeek(dayOfWeek) {
    const today = new Date();
    const result = new Date(today);
    result.setDate(today.getDate() + (7 + dayOfWeek - today.getDay()) % 7);
    return result;
  }

  // Helper method to handle email notifications
  async notifyScheduleChanges(doctor, appointments, reason) {
    await rabbitmqService.publishToQueue('appointment_updates', {
      appointments: appointments.map(apt => ({
        id: apt.id,
        patientName: apt.patient.name,
        patientPhone: apt.patient.phone,
        scheduledTime: apt.scheduledTime,
        duration: apt.duration
      })),
      doctor: {
        ...doctor,
        hospitalAdminEmail: await this.getHospitalAdminEmail(doctor.hospitalId)
      },
      reason
    });
  }
  
}

module.exports = new DoctorService();