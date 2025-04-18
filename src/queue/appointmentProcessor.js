const RabbitMQService = require('../services/rabbitmq.service');
const redisService = require('../services/redis.service');
const mailService = require('../services/mail.service');

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
        
        // Send consolidated email to doctor
        await this.sendDoctorNotification(doctor, appointmentsByDate, reason);
        
        // Send consolidated email to admin
        await this.sendAdminNotification(doctor, appointmentsByDate, reason);

        // Log success
        await redisService.setCache(`appointment:update:${Date.now()}`, {
          status: 'processed',
          data,
          timestamp: new Date().toISOString()
        }, 7 * 24 * 60 * 60);
      } catch (error) {
        console.error('Error processing appointment update:', error);
        throw error; // Trigger retry mechanism
      }
    }, {
      maxRetries: 3,
      prefetch: 5
    });
  }

  groupAppointmentsByDate(appointments) {
    return appointments.reduce((acc, appointment) => {
      const date = new Date(appointment.scheduledTime).toLocaleDateString();
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(appointment);
      return acc;
    }, {});
  }

  async sendDoctorNotification(doctor, appointmentsByDate, reason) {
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

    const emailContent = `
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

    await mailService.sendMail(doctor.email, 'Schedule Change - Action Required', emailContent);
  }

  async sendAdminNotification(doctor, appointmentsByDate, reason) {
    let appointmentsList = '';
    let totalPatients = 0;

    Object.entries(appointmentsByDate).forEach(([date, appointments]) => {
      totalPatients += appointments.length;
      appointmentsList += `
        <div style="margin-bottom: 20px;">
          <h3 style="color: #4B5563;">${date}</h3>
          ${appointments.map(apt => `
            <div style="margin-left: 20px; border-left: 3px solid #e2e8f0; padding-left: 10px; margin-bottom: 10px;">
              <p><strong>Patient:</strong> ${apt.patientName}</p>
              <p><strong>Contact:</strong> ${apt.patientPhone}</p>
              <p><strong>Time:</strong> ${new Date(apt.scheduledTime).toLocaleTimeString()}</p>
              <p><strong>Duration:</strong> ${apt.duration} minutes</p>
            </div>
          `).join('')}
        </div>
      `;
    });

    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Doctor Schedule Change - Action Required</h2>
        <p>Dr. ${doctor.name}'s schedule has been affected due to ${reason}.</p>
        <p><strong>Total Affected Patients:</strong> ${totalPatients}</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
          <h3>Affected Appointments:</h3>
          ${appointmentsList}
        </div>

        <p>Please contact the affected patients to arrange new appointments.</p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="color: #64748b; font-size: 12px;">
          This is an automated email from Tempus.
        </p>
      </div>
    `;

    await mailService.sendMail(doctor.hospitalAdminEmail, 'Doctor Schedule Change - Action Required', emailContent);
  }
}

module.exports = new AppointmentProcessor();