const RabbitMQService = require('../services/rabbitmq.service');
const redisService = require('../services/redis.service');
const messageService = require('../modules/notification/message.service');

class AppointmentProcessor {
  constructor() {
    this.rabbitmqService = RabbitMQService;
    this.initialized = false;
  }

  async initialize() {
    await this.rabbitmqService.createQueue('appointment_updates', {
      deadLetterExchange: true,
      maxLength: 100000
    });

    // Set up consumer
    await this.setupAppointmentUpdateConsumer();
  }

  async setupAppointmentUpdateConsumer() {
    await this.rabbitmqService.consumeQueue('appointment_updates', async (data) => {
      try {
        const { appointments, doctor, reason } = data;
        
        // Group appointments by date for notifications
        const appointmentsByDate = this.groupAppointmentsByDate(appointments);
        
        // Send consolidated notifications through message service
        await this.sendNotifications(doctor, appointmentsByDate, reason);

        // Log success
        await redisService.setCache(`appointment:update:${Date.now()}`, {
          status: 'processed',
          data,
          timestamp: new Date().toISOString()
        }, 7 * 24 * 60 * 60);
      } catch (error) {
        console.error('Error processing appointment update:', error);
        throw error;
      }
    }, {
      maxRetries: 3,
      prefetch: 5
    });
  }

  groupAppointmentsByDate(appointments) {
    return appointments.reduce((acc, apt) => {
      const date = new Date(apt.scheduledTime).toLocaleDateString();
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(apt);
      return acc;
    }, {});
  }

  async sendNotifications(doctor, appointmentsByDate, reason) {
    const doctorEmailContent = this.generateDoctorEmailContent(doctor, appointmentsByDate, reason);
    const adminEmailContent = this.generateAdminEmailContent(doctor, appointmentsByDate, reason);

    // Send doctor notification
    await messageService.sendMessage('email', {
      to: doctor.email,
      subject: 'Schedule Change - Action Required',
      content: doctorEmailContent,
      hospitalId: doctor.hospitalId
    });

    // Send admin notification if admin email exists
    if (doctor.hospitalAdminEmail) {
      await messageService.sendMessage('email', {
        to: doctor.hospitalAdminEmail,
        subject: 'Doctor Schedule Change - Action Required',
        content: adminEmailContent,
        hospitalId: doctor.hospitalId
      });
    }

    // Send SMS notifications to affected patients
    for (const [date, appointments] of Object.entries(appointmentsByDate)) {
      for (const apt of appointments) {
        if (apt.patientPhone) {
          await messageService.sendMessage('sms', {
            to: apt.patientPhone,
            content: `Your appointment with Dr. ${doctor.name} on ${date} at ${new Date(apt.scheduledTime).toLocaleTimeString()} has been affected due to ${reason}. The hospital will contact you for rescheduling.`,
            hospitalId: doctor.hospitalId
          });
        }
      }
    }
  }

  generateDoctorEmailContent(doctor, appointmentsByDate, reason) {
    let appointmentsList = '';
    Object.entries(appointmentsByDate).forEach(([date, appointments]) => {
      appointmentsList += `
        <div style="margin-bottom: 20px;">
          <h3 style="color: #4B5563;">${date}</h3>
          ${appointments.map(apt => `
            <div style="margin-left: 20px;">
              <p><strong>Patient:</strong> ${apt.patientName}</p>
              <p><strong>Time:</strong> ${new Date(apt.scheduledTime).toLocaleTimeString()}</p>
              <p><strong>Duration:</strong> ${apt.duration} minutes</p>
            </div>
          `).join('')}
        </div>
      `;
    });

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563EB;">Schedule Change Notification</h2>
        <p>Dear Dr. ${doctor.name},</p>
        <p>Due to ${reason}, the following appointments have been affected:</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
          ${appointmentsList}
        </div>

        <p>Hospital administration has been notified and will handle the rescheduling process.</p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="color: #64748b; font-size: 12px;">
          This is an automated email from Tempus. Please do not reply to this email.
        </p>
      </div>
    `;
  }

  generateAdminEmailContent(doctor, appointmentsByDate, reason) {
    let appointmentsList = '';
    Object.entries(appointmentsByDate).forEach(([date, appointments]) => {
      appointmentsList += `
        <div style="margin-bottom: 20px;">
          <h3 style="color: #4B5563;">${date}</h3>
          ${appointments.map(apt => `
            <div style="margin-left: 20px;">
              <p><strong>Patient:</strong> ${apt.patientName}</p>
              <p><strong>Contact:</strong> ${apt.patientPhone || 'N/A'}</p>
              <p><strong>Time:</strong> ${new Date(apt.scheduledTime).toLocaleTimeString()}</p>
              <p><strong>Duration:</strong> ${apt.duration} minutes</p>
            </div>
          `).join('')}
        </div>
      `;
    });

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563EB;">Doctor Schedule Change - Action Required</h2>
        <p>Schedule changes have been made for Dr. ${doctor.name} due to ${reason}.</p>
        <p>The following appointments need to be rescheduled:</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
          ${appointmentsList}
        </div>

        <p>Please contact the affected patients to reschedule their appointments.</p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="color: #64748b; font-size: 12px;">
          This is an automated email from Tempus.
        </p>
      </div>
    `;
  }
}

module.exports = new AppointmentProcessor();