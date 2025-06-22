const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const messageService = require('../notification/message.service');
const doctorValidator = require('./doctor.validator');
const { CACHE_KEYS, CACHE_EXPIRY, DEFAULT_SCHEDULE, SCHEDULE_STATUS, DOCTOR_STATUS } = require('./doctor.constants');

class DoctorService {

  async createDoctor(hospitalId, doctorData) {
    try {
      // Validate doctor data
      const validationResult = doctorValidator.validateCreateDoctorData(doctorData);
      if (!validationResult.isValid) {
        throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
      }

      // Check if doctor with same email or phone exists in the hospital
      const existingDoctor = await prisma.doctor.findFirst({
        where: {
          hospitalId,
          OR: [
            { email: doctorData.email },
            { phone: doctorData.phone },
            { aadhar: doctorData.aadhar }
          ]
        }
      });

      if (existingDoctor) {
        throw new Error('A doctor with this email or phone number or aadhar already exists in this hospital');
      }

      // Create doctor with default schedule
      const doctor = await prisma.$transaction(async (tx) => {
        // Create doctor
        const newDoctor = await tx.doctor.create({
          data: {
            ...validationResult.data,
            status: DOCTOR_STATUS.ACTIVE,
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
      await messageService.sendMessage('email', {
        to: doctor.email,
        subject: 'Welcome to Tiqora - Doctor Onboarding',
        content: this.getWelcomeEmailTemplate(doctor),
        hospitalId
      });

      await Promise.all([
         redisService.invalidateCache(`hospital:dashboard:${hospitalId}`),
         redisService.invalidateCache(CACHE_KEYS.DOCTOR_LIST + hospitalId),
         redisService.invalidateCache(`hospital:dashboard:${hospitalId}`),
      ]);

      return doctor;
    } catch (error) {
      console.error('Error in createDoctor:', error);
      throw error;
    }
  }

  async updateDoctorDetails(hospitalId, doctorId, updateData) {
    try {
      // Try to get existing doctor from cache first
      const cacheKey = CACHE_KEYS.DOCTOR_DETAILS + doctorId;
      let existingDoctor = await redisService.getCache(cacheKey);
      
      if (!existingDoctor) {
        // If not in cache, get from database
        try {
          existingDoctor = await prisma.doctor.findFirst({
            where: { id: doctorId, hospitalId }
          });
        } catch (error) {
          console.error('Database error fetching doctor:', error);
          throw new Error('Invalid doctor ID');
        }

        if (!existingDoctor) {
          throw new Error('Doctor not found');
        }
      }

      // Validate update data with the new validation method
      const validationResult = doctorValidator.validateUpdateDoctorData(updateData, existingDoctor);
      if (!validationResult.isValid) {
        throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
      }

      if(updateData.status===DOCTOR_STATUS.INACTIVE && existingDoctor.status===DOCTOR_STATUS.INACTIVE){
        throw new Error('Doctor Status is INACTIVE');
      }

      // If this is a contact info update, check for duplicates
      if (validationResult.isContactUpdate) {
        const duplicateDoctor = await prisma.doctor.findFirst({
          where: {
            hospitalId,
            id: { not: doctorId },
            OR: [
              { email: updateData.email },
              { phone: updateData.phone },
              { aadhar: updateData.aadhar }
            ].filter(Boolean) // Only include conditions for fields that are being updated
          }
        });

        if (duplicateDoctor) {
          throw new Error('A doctor with this email or phone number or aadhar already exists in this hospital');
        }
      }

      // Update doctor with validated and changed fields
      const updatedDoctor = await prisma.doctor.update({
        where: { id: doctorId },
        data: validationResult.data
      });

      // Invalidate caches
      await Promise.all([
         redisService.invalidateCache(`hospital:dashboard:${hospitalId}`),
         redisService.invalidateCache(CACHE_KEYS.DOCTOR_LIST + hospitalId),
         redisService.invalidateCache(CACHE_KEYS.DOCTOR_DETAILS + doctorId),
      ]);

      // Send details change notification
      await messageService.sendMessage('email', {
        to: updatedDoctor.email,
        subject: 'Doctor Detail Update',
        content: this.getUpdateEmailTemplate(updatedDoctor),
        hospitalId
      });

      return updatedDoctor;
    } catch (error) {
      console.error('Error in updateDoctorDetails:', error);
      throw error;
    }
  }

  async updateDoctorsSchedule(hospitalId, doctorId, schedulesData) {
    try {
      // Validate all schedules data
      const validationResult = doctorValidator.validateAllSchedulesData(schedulesData);
      if (!validationResult.isValid) {
        throw Object.assign(new Error('Validation failed'), { validationErrors: validationResult.errors });
      }

      const validatedSchedules = validationResult.data;

      // Get doctor with minimal required fields and include hospital admin
      const doctor = await prisma.doctor.findFirst({
        where: { 
          id: doctorId, 
          hospitalId,
          status: DOCTOR_STATUS.ACTIVE
        },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          hospitalId: true,
          hospital: {
            select: {
              adminEmail: true
            }
          }
        }
      });

      if (!doctor) {
        throw new Error('Doctor not found or inactive');
      }

      // Start a transaction for schedule update
      const updatedSchedules = await prisma.$transaction(async (tx) => {
        // First delete all existing schedules for this doctor
        await tx.doctorSchedule.deleteMany({
          where: {
            doctorId,
            hospitalId
          }
        });
        
        // Then create all new schedules
        const createPromises = validatedSchedules.map(schedule => {
          const { dayOfWeek, ...scheduleData } = schedule;
          
          return tx.doctorSchedule.create({
            data: {
              doctorId,
              hospitalId,
              dayOfWeek,
              timeRanges: scheduleData.timeRanges,
              status: scheduleData.status,
              avgConsultationTime: scheduleData.avgConsultationTime
            }
          });
        });
        
        // Execute all create operations
        return await Promise.all(createPromises);
      });

      // Send a single consolidated notification about all schedule updates
      await messageService.sendMessage('email', {
        to: doctor.email,
        subject: 'Schedule Updates Notification',
        content: this.getSchedulesUpdateEmailTemplate(doctor, updatedSchedules),
        hospitalId
      });

      // Notify hospital admin
      if (doctor.hospital?.adminEmail) {
        await messageService.sendMessage('email', {
          to: doctor.hospital.adminEmail,
          subject: `Doctor Schedules Updated - ${doctor.name}`,
          content: this.getAdminSchedulesUpdateEmailTemplate(doctor, updatedSchedules),
          hospitalId
        });
      }

      // Invalidate relevant caches
      await Promise.all([
        redisService.invalidateCache(`hospital:dashboard:${hospitalId}`),
        redisService.invalidateCache(CACHE_KEYS.DOCTOR_SCHEDULE + doctorId),
        redisService.invalidateCache(CACHE_KEYS.DOCTOR_DETAILS + doctorId)
      ]);

      return updatedSchedules;
    } catch (error) {
      console.error('Error in updateDoctorsSchedule:', error);
      throw error;
    }
  }

  async getHospitalAdminEmail(hospitalId) {
    try {
      const hospital = await prisma.hospital.findUnique({
        where: { id: hospitalId },
        select: { adminEmail: true }
      });
      return hospital?.adminEmail;
    } catch (error) {
      console.error('Error in getHospitalAdminEmail:', error);
      throw error;
    }
  }

  async getDoctorDetails(hospitalId, doctorId) {
    try {
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
    } catch (error) {
      console.error('Error in getDoctorDetails:', error);
      throw error;
    }
  }
  
  async listDoctors(hospitalId) {
    try {
      const cacheKey = CACHE_KEYS.DOCTOR_LIST + hospitalId;
      
      // Try cache first
      const cachedDoctors = await redisService.getCache(cacheKey);
      if (cachedDoctors) {
        return cachedDoctors;
      }

      // Get all active doctors with their schedules
      const doctors = await prisma.doctor.findMany({
        where: { 
        hospitalId,
        status: DOCTOR_STATUS.ACTIVE
        }
      });

      // Cache the result
      await redisService.setCache(cacheKey, doctors, CACHE_EXPIRY.DOCTOR_LIST);

      return doctors;
    } catch (error) {
      console.error('Error in listDoctors:', error);
      throw error;
    }
  }

  // Helper methods

  getWelcomeEmailTemplate(doctor) {
    try {
      const defaultRanges = DEFAULT_SCHEDULE.timeRanges
  .map(range => `${range.start} - ${range.end}`)
  .join(', ');

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;">
        
        <!-- Header Branding -->
        <div style="text-align: center; margin-bottom: 30px;">
          <h2 style="color: #2563EB; font-size: 24px; margin: 0;">Tiqora</h2>
          <p style="color: #6b7280; font-size: 14px; margin-top: 4px;">Smart Hospital CRM & Queue Management</p>
        </div>

        <!-- Welcome Content -->
        <h3 style="color: #2563EB; font-size: 20px; margin-bottom: 10px;">Welcome to Tiqora!</h3>

        <p style="font-size: 16px; color: #111827;">Dear Dr. ${doctor.name},</p>

        <p style="font-size: 16px; color: #111827; line-height: 1.6;">
          Welcome to <strong>Tiqora</strong>! You have been successfully registered as a doctor in our system.
        </p>

        <!-- Default Schedule -->
        <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin: 20px 0; border: 1px solid #e5e7eb;">
          <p style="margin: 0 0 10px 0; font-size: 16px;"><strong>Default Schedule:</strong></p>
          <p style="margin: 0; font-size: 16px;">Working Hours: ${defaultRanges}</p>
        </div>

        <p style="font-size: 16px; color: #111827;">
          You can update your schedule at any time through the hospital administration panel.
        </p>

        <!-- Footer -->
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
        <p style="color: #64748b; font-size: 12px; text-align: center;">
          This is an automated email from <strong>Tiqora</strong>. Please do not reply to this message.
        </p>
      </div>
    `;
    } catch (error) {
      console.error('Error in getWelcomeEmailTemplate:', error);
      throw error;
    }
  }

  getSchedulesUpdateEmailTemplate(doctor, schedules) {
    try {

      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Sort schedules by day of the week
      const sortedSchedules = [...schedules].sort((a, b) => a.dayOfWeek - b.dayOfWeek);

      // Generate schedule rows
      const scheduleRows = sortedSchedules.map(schedule => {
        const dayName = days[schedule.dayOfWeek];
        const status = schedule.status === 'active'
          ? '<span style="color: #10B981; font-weight: 600;">ACTIVE</span>'
          : '<span style="color: #EF4444; font-weight: 600;">INACTIVE</span>';

        const timeRanges = schedule.timeRanges
          .map(range => `${range.start} - ${range.end}`)
          .join('<br>');

        return `
          <tr style="${schedule.dayOfWeek % 2 === 0 ? 'background-color: #F9FAFB;' : ''}">
            <td style="padding: 12px; border: 1px solid #e5e7eb; font-weight: 600;">${dayName}</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">${timeRanges}</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">${schedule.avgConsultationTime} mins</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">${status}</td>
          </tr>
        `;
      }).join('');

      return `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
          
          <!-- Header -->
          <div style="background-color: #2563EB; padding: 20px; text-align: center;">
            <h2 style="color: white; margin: 0; font-weight: 600;">Tiqora Schedule Update</h2>
          </div>
          
          <!-- Content -->
          <div style="padding: 25px;">
            <p style="font-size: 16px; color: #1F2937; margin-top: 0;">Dear Dr. ${doctor.name},</p>

            <p style="font-size: 15px; color: #374151;">
              Your weekly schedule has been updated. Please find the new schedule below:
            </p>

            <!-- Schedule Table -->
            <table style="width: 100%; border-collapse: collapse; margin: 25px 0; font-size: 14px;">
              <thead>
                <tr style="background-color: #EBF5FF;">
                  <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: left;">Day</th>
                  <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: left;">Hours</th>
                  <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: left;">Consultation Time</th>
                  <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: left;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${scheduleRows}
              </tbody>
            </table>

            <p style="font-size: 15px; color: #4B5563;">If you have any questions about your schedule, please contact your hospital administrator.</p>
          </div>

          <!-- Footer -->
          <div style="background-color: #F9FAFB; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #2563EB; font-size: 16px; font-weight: 600; margin: 0;">Tiqora</p>
            <p style="color: #6B7280; font-size: 14px; margin: 5px 0 0 0;">
              This is an automated message from Tiqora – Smart Hospital & Queue Management System.
            </p>
            <p style="color: #9CA3AF; font-size: 12px; margin-top: 10px;">
              ©️ ${new Date().getFullYear()} Tiqora Technologies. All rights reserved.
            </p>
          </div>
        </div>
      `;
    } catch (error) {
      console.error('Error in getSchedulesUpdateEmailTemplate:', error);
      throw error;
    }
  }
  
  getAdminSchedulesUpdateEmailTemplate(doctor, schedules) {
    try {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Sort schedules by day of the week
  const sortedSchedules = [...schedules].sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  // Generate schedule rows
  const scheduleRows = sortedSchedules.map(schedule => {
    const dayName = days[schedule.dayOfWeek];
    const status = schedule.status === 'active'
      ? '<span style="color: #10B981; font-weight: 600;">ACTIVE</span>'
      : '<span style="color: #EF4444; font-weight: 600;">INACTIVE</span>';

    const timeRanges = schedule.timeRanges
      .map(range => `${range.start} - ${range.end}`)
      .join('<br>');

    return `
      <tr style="${schedule.dayOfWeek % 2 === 0 ? 'background-color: #F9FAFB;' : ''}">
        <td style="padding: 12px; border: 1px solid #e5e7eb; font-weight: 600;">${dayName}</td>
        <td style="padding: 12px; border: 1px solid #e5e7eb;">${timeRanges}</td>
        <td style="padding: 12px; border: 1px solid #e5e7eb;">${schedule.avgConsultationTime} mins</td>
        <td style="padding: 12px; border: 1px solid #e5e7eb;">${status}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
      
      <!-- Header -->
      <div style="background-color: #2563EB; padding: 20px; text-align: center;">
        <h2 style="color: white; margin: 0; font-weight: 600;">Doctor Schedule Update</h2>
      </div>
      
      <!-- Content -->
      <div style="padding: 25px;">
        <p style="font-size: 16px; color: #1F2937; margin-top: 0;">
          The weekly schedule for <strong>Dr. ${doctor.name}</strong> has been updated. Please review the updated timings below:
        </p>

        <!-- Schedule Table -->
        <table style="width: 100%; border-collapse: collapse; margin: 25px 0; font-size: 14px;">
          <thead>
            <tr style="background-color: #EBF5FF;">
              <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: left;">Day</th>
              <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: left;">Hours</th>
              <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: left;">Consultation Time</th>
              <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: left;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${scheduleRows}
          </tbody>
        </table>

        <p style="font-size: 15px; color: #4B5563;">If this schedule is incorrect or needs modification, please reach out to the scheduling coordinator or system administrator.</p>
      </div>

      <!-- Footer -->
      <div style="background-color: #F9FAFB; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="color: #2563EB; font-size: 16px; font-weight: 600; margin: 0;">Tiqora</p>
        <p style="color: #6B7280; font-size: 14px; margin: 5px 0 0 0;">
          This is an automated email from Tiqora – Smart Hospital & Queue Management System.
        </p>
        <p style="color: #9CA3AF; font-size: 12px; margin-top: 10px;">
          ©️ ${new Date().getFullYear()} Tiqora Technologies. All rights reserved.
        </p>
      </div>
    </div>
  `;
    } catch (error) {
      console.error('Error in getAdminSchedulesUpdateEmailTemplate:', error);
      throw error;
    }
  }

  getUpdateEmailTemplate(doctor) {
        try {
          const statusMessage = doctor.status === DOCTOR_STATUS.ACTIVE
        ? 'Your account is now active and you can continue providing services.'
        : 'Your account has been deactivated. Please contact the hospital administration for more information.';

      const statusColor = doctor.status === DOCTOR_STATUS.ACTIVE ? '#10B981' : '#EF4444';
      const statusText = doctor.status === DOCTOR_STATUS.ACTIVE ? 'ACTIVE' : 'INACTIVE';

      return `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
          
          <!-- Header -->
          <div style="background-color: #2563EB; padding: 20px; text-align: center;">
            <h2 style="color: white; margin: 0; font-weight: 600;">Tiqora Account Status Update</h2>
          </div>

          <!-- Body Content -->
          <div style="padding: 30px 25px;">
            <p style="font-size: 16px; color: #1F2937; margin-top: 0;">Dear Dr. ${doctor.name},</p>

            <p style="font-size: 16px; color: #1F2937;">Your account status has been updated to:</p>

            <div style="background-color: ${statusColor}; color: white; text-align: center; padding: 12px; border-radius: 6px; font-weight: bold; font-size: 18px; margin: 25px 0;">
              ${statusText}
            </div>

            <div style="background-color: #f3f4f6; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid ${statusColor};">
              <p style="margin: 0; color: #4B5563; font-size: 15px;">${statusMessage}</p>
            </div>

            <!-- Doctor Profile Table -->
            <div style="margin: 30px 0;">
              <h3 style="color: #2563EB; font-size: 18px; margin-bottom: 15px;">Your Profile Information</h3>
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr style="background-color: #F9FAFB;">
                  <td style="padding: 12px; border: 1px solid #e5e7eb; font-weight: 600; width: 40%;">Name</td>
                  <td style="padding: 12px; border: 1px solid #e5e7eb;">${doctor.name}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; border: 1px solid #e5e7eb; font-weight: 600;">Specialization</td>
                  <td style="padding: 12px; border: 1px solid #e5e7eb;">${doctor.specialization}</td>
                </tr>
                <tr style="background-color: #F9FAFB;">
                  <td style="padding: 12px; border: 1px solid #e5e7eb; font-weight: 600;">Qualification</td>
                  <td style="padding: 12px; border: 1px solid #e5e7eb;">${doctor.qualification}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; border: 1px solid #e5e7eb; font-weight: 600;">Experience</td>
                  <td style="padding: 12px; border: 1px solid #e5e7eb;">${doctor.experience} years</td>
                </tr>
                <tr style="background-color: #F9FAFB;">
                  <td style="padding: 12px; border: 1px solid #e5e7eb; font-weight: 600;">Contact</td>
                  <td style="padding: 12px; border: 1px solid #e5e7eb;">${doctor.phone}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; border: 1px solid #e5e7eb; font-weight: 600;">Email</td>
                  <td style="padding: 12px; border: 1px solid #e5e7eb;">${doctor.email}</td>
                </tr>
              </table>
            </div>

            <p style="font-size: 15px; color: #4B5563;">If you have any questions or need to update your profile, please contact your hospital administrator.</p>
          </div>

          <!-- Footer -->
          <div style="background-color: #F9FAFB; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #2563EB; font-size: 16px; font-weight: 600; margin: 0;">Tiqora</p>
            <p style="color: #6B7280; font-size: 14px; margin: 5px 0 0 0;">
              This is an automated message from Tiqora – Smart Hospital & Queue Management System
            </p>
            <p style="color: #9CA3AF; font-size: 12px; margin-top: 10px;">
              ©️ ${new Date().getFullYear()} Tiqora Technologies. All rights reserved.
            </p>
          </div>
        </div>
      `;

    } catch (error) {
      console.error('Error in getUpdateEmailTemplate:', error);
      throw error;
    }
  }

}

module.exports = new DoctorService();
