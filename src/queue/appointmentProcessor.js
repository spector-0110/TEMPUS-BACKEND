const rabbitmqService = require('../services/rabbitmq.service');
const redisService = require('../services/redis.service');
const messageService = require('../modules/notification/message.service');
const TimezoneUtil = require('../utils/timezone.util');
const { QUEUES, APPOINTMENT_STATUS,APPOINTMENT_PAYMENT_STATUS } = require('../modules/appointment/appointment.constants');
const appointmentService = require('../modules/appointment/appointment.service');

class AppointmentProcessor {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      
      // Create new queues with dead letter exchanges
      await rabbitmqService.createQueue(QUEUES.APPOINTMENT_CREATED, {
        deadLetterExchange: true,
        maxLength: 100000
      });
      
      await rabbitmqService.createQueue(QUEUES.APPOINTMENT_UPDATED, {
        deadLetterExchange: true,
        maxLength: 100000
      });
      
      await rabbitmqService.createQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
        deadLetterExchange: true,
        maxLength: 100000
      });
      
      // Set up consumers
      // await this.setupAppointmentUpdateConsumer();
      await this.setupConsumers();
      
      this.initialized = true;
      console.log('Appointment processor initialized successfully');
    } catch (error) {
      console.error('Failed to initialize appointment processor:', error);
    }
  }

  // async setupAppointmentUpdateConsumer() {
  //   await rabbitmqService.consumeQueue('appointment_updates', async (data) => {
  //     try {
  //       const { appointments, doctor, reason } = data;
        
  //       // Group appointments by date for notifications
  //       const appointmentsByDate = this.groupAppointmentsByDate(appointments);
        
  //       // Send consolidated notifications through message service
  //       await this.sendNotifications(doctor, appointmentsByDate, reason);

  //       // Log success
  //       await redisService.setCache(`appointment:update:${Date.now()}`, {
  //         status: 'processed',
  //         data,
  //         timestamp: new Date().toISOString()
  //       }, 7 * 24 * 60 * 60);
  //     } catch (error) {
  //       console.error('Error processing appointment update:', error);
  //       throw error;
  //     }
  //   }, {
  //     maxRetries: 3,
  //     prefetch: 5
  //   });
  // }
  
  async setupConsumers() {
    // Consumer for appointment created events
    await rabbitmqService.consumeQueue(QUEUES.APPOINTMENT_CREATED, async (message) => {
      try {
        console.log('Processing appointment creation:', message.appointment.id);
        
        // Send welcome notification with tracking link
        await this.sendAppointmentCreationNotification(message.appointment, message.trackingLink);
        
        // Invalidate any relevant cached lists
        await this.invalidateAppointmentCaches(message.appointment);
        
      } catch (error) {
        console.error('Error processing appointment creation:', error);
      }
    }, { maxRetries: 3 });

    // Consumer for appointment updated events
    await rabbitmqService.consumeQueue(QUEUES.APPOINTMENT_UPDATED, async (message) => {
      try {
        console.log('Processing appointment update:', message.appointment.id);
        
        // Handle status updates
        if (message.previousStatus && message.appointment.status !== message.previousStatus) {
          await this.handleStatusChange(message.appointment, message.previousStatus);
        }
        
        // Handle payment status updates
        if (message.paymentStatusUpdated) {
          await this.handlePaymentStatusChange(message.appointment);
        }
        
        // Handle appointment deletion
        if (message.deleted) {
          await this.handleAppointmentDeletion(message.appointment);
        }
        
        // Invalidate any relevant cached lists
        await this.invalidateAppointmentCaches(message.appointment);
        
      } catch (error) {
        console.error('Error processing appointment update:', error);
      }
    }, { maxRetries: 3 });
    
    // Consumer for appointment notification events
    await rabbitmqService.consumeQueue(QUEUES.APPOINTMENT_NOTIFICATION, async (message) => {
      try {
        console.log('Processing appointment notification:', message.appointmentId);
        
        // Send WhatsApp notification if configured
        await this.sendNotification(message);
        
      } catch (error) {
        console.error('Error processing appointment notification:', error);
      }
    }, { maxRetries: 5 });
  }
  
  async handleStatusChange(appointment, previousStatus) {
    try {
      // Generate appropriate messages based on status change
      let notificationContent = '';
      
      if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
        notificationContent = this.generateCancellationMessage(appointment, previousStatus);
      } else if (appointment.status === APPOINTMENT_STATUS.COMPLETED) {
        notificationContent = this.generateCompletionMessage(appointment);
        
        // // Update queue positions after completion
        // await appointmentService.updateQueuePositions(
        //   appointment.hospitalId,
        //   appointment.doctorId,
        //   appointment.appointmentDate
        // );

        // Notify next patient
        // await this.notifyNextPatientInQueue(appointment.hospitalId, appointment.doctorId);
      } else if (appointment.status === APPOINTMENT_STATUS.MISSED) {
        notificationContent = this.generateMissedAppointmentMessage(appointment);
      } else if (appointment.status === APPOINTMENT_STATUS.BOOKED && previousStatus !== APPOINTMENT_STATUS.BOOKED) {
        notificationContent = this.generateRebookedMessage(appointment, previousStatus);
      }
      
      if (notificationContent) {
        await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
          appointmentId: appointment.id,
          name: appointment.patientName,
          mobile: appointment.mobile,
          hospitalId: appointment.hospitalId,
          content: notificationContent
        });
      }
      
      // Clear any tracking caches to ensure data is fresh
      await this.invalidateAppointmentCaches(appointment);

    } catch (error) {
      console.error('Error handling status change:', error);
    }
  }

  // /**
  //  * Notify the next patient in the queue when their turn is approaching
  //  */
  // async notifyNextPatientInQueue(hospitalId, doctorId) {
  //   try {
  //     // Get today's date in IST
  //     const today = TimezoneUtil.getCurrentIst();
  //     today.setHours(0, 0, 0, 0);
      
  //     // Find next booked appointment
  //     const nextAppointment = await prisma.appointment.findFirst({
  //       where: {
  //         hospitalId: hospitalId,
  //         doctorId: doctorId,
  //         appointmentDate: today,
  //         status: APPOINTMENT_STATUS.BOOKED
  //       },
  //       include: {
  //         hospital: {
  //           select: {
  //             name: true
  //           }
  //         },
  //         doctor: {
  //           select: {
  //             name: true
  //           }
  //         }
  //       },
  //       orderBy: [
  //         { paymentAt: 'asc' },
  //         { createdAt: 'asc' }
  //       ]
  //     });
      
  //     if (nextAppointment) {
  //       // Get their current queue position
  //       const queueInfo = await appointmentService.getQueuePosition(nextAppointment.id);
        
  //       const notificationContent = `It's almost your turn! You are ${queueInfo.position === 1 ? 'next' : `${queueInfo.position}th`} in line to see Dr. ${nextAppointment.doctor.name}. Estimated waiting time: ${queueInfo.estimatedWaitingTime} minutes.`;
        
  //       await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
  //         appointmentId: nextAppointment.id,
  //         name: nextAppointment.patientName,
  //         mobile: nextAppointment.mobile,
  //         hospitalId: nextAppointment.hospitalId,
  //         content: notificationContent
  //       });
  //     }
  //   } catch (error) {
  //     console.error('Error notifying next patient:', error);
  //   }
  // }

  async handlePaymentStatusChange(appointment) {
    try {
      // Generate notification if needed
      if (appointment.paymentStatus === APPOINTMENT_PAYMENT_STATUS.PAID) {
        const notificationContent = this.generatePaymentConfirmationMessage(appointment);
        
        // Queue notification
        await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
          appointmentId: appointment.id,
          name: appointment.patientName,
          mobile: appointment.mobile,
          hospitalId: appointment.hospitalId,
          content: notificationContent
        });
      }
    } catch (error) {
      console.error('Error handling payment status change:', error);
    }
  }

  async handleAppointmentDeletion(appointment) {
    try {      
      // Send cancellation notification
      const notificationContent = this.generateDeletionMessage(appointment);
      
      // Queue notification
      await rabbitmqService.publishToQueue(QUEUES.APPOINTMENT_NOTIFICATION, {
        appointmentId: appointment.id,
        name: appointment.patientName,
        mobile: appointment.mobile,
        hospitalId: appointment.hospitalId,
        content: notificationContent
      });
    } catch (error) {
      console.error('Error handling appointment deletion:', error);
    }
  }

  async invalidateAppointmentCaches(appointment) {
    try {
      // Pattern to match all possible cache keys for this hospital's appointments
      const hospitalPattern = `hospital_appointments:${appointment.hospitalId}*`;
      
      // Pattern to match all possible cache keys for this doctor's appointments
      const doctorPattern = `doctor_appointments:${appointment.doctorId}*`;
      
      // Delete all matching keys
      await redisService.deleteByPattern(hospitalPattern);
      await redisService.deleteByPattern(doctorPattern);
    } catch (error) {
      console.error('Error invalidating appointment caches:', error);
    }
  }

  async sendAppointmentCreationNotification(appointment, trackingLink) {
    try {
      // Construct the WhatsApp message
      const notificationContent = this.generateCreationMessage(appointment, trackingLink);
      console.log(`Appointment creation notification  ${appointment.mobile} for appointment ${appointment.id} ${notificationContent }`);

      // Send WhatsApp message
      await messageService.sendMessage('whatsapp', {
        to: appointment.mobile,
        hospitalId: appointment.hospitalId,
        content: notificationContent
      });
      
    } catch (error) {
      console.error('Error sending appointment creation notification:', error);
      // Don't throw - notification failure shouldn't break appointment creation processing
    }
  }

  async sendNotification(message) {
    try {
      console.log(`Sending notification for appointment ${message}`);
      // Send WhatsApp notification
      await messageService.sendMessage('whatsapp', {
        to: message.mobile,
        hospitalId: message.hospitalId,
        content: message.content
      });
    } catch (error) {
      console.error('Error sending appointment notification:', error);
    }
  }

  /**
   * Generate professional appointment creation message
   */
  generateCreationMessage(appointment, trackingLink) {
    const appointmentDate = appointment.appointmentDate;
    const startTime = appointment.startTime ? new Date(appointment.startTime).toISOString().split('T')[1].split('.')[0] : 'TBD';
    const endTime = appointment.endTime ? new Date(appointment.endTime).toISOString().split('T')[1].split('.')[0] : '';
    
    // Build payment status info
    let paymentInfo = '';
    if (appointment.paymentStatus === APPOINTMENT_PAYMENT_STATUS.PAID) {
      paymentInfo = `✅ Payment Status: Confirmed`;
      if (appointment.paymentMethod) {
        paymentInfo += ` (${appointment.paymentMethod.toUpperCase()})`;
      }
      if (appointment.amount) {
        paymentInfo += `\n💰 Amount Paid: ₹${appointment.amount}`;
      }
    } else {
      paymentInfo = `⏳ Payment Status: Pending`;
      if (appointment.amount) {
        paymentInfo += `\n💰 Amount: ₹${appointment.amount}`;
      }
    }

    // Build doctor info
    let doctorInfo = `👨‍⚕️ Doctor: Dr. ${appointment.doctor.name}`;
    if (appointment.doctor.specialization) {
      doctorInfo += `\n🩺 Specialization: ${appointment.doctor.specialization}`;
    }
    if (appointment.doctor.qualification) {
      doctorInfo += `\n🎓 Qualification: ${appointment.doctor.qualification}`;
    }
    if (appointment.doctor.experience) {
      doctorInfo += `\n📅 Experience: ${appointment.doctor.experience} years`;
    }

    return `🏥 ${appointment.hospital.name}

Dear ${appointment.patientName},

Your appointment has been successfully booked!

📋 APPOINTMENT DETAILS:
• Appointment ID: ${appointment.id}
• Date: ${appointmentDate}
• Time: ${startTime}${endTime ? ` - ${endTime}` : ''}
• Patient Name: ${appointment.patientName}
• Mobile: ${appointment.mobile}
${appointment.age ? `• Age: ${appointment.age} years` : ''}

${doctorInfo}

${paymentInfo}

🔗 TRACK YOUR APPOINTMENT:
${trackingLink}

📱 What you can do:
• Check your position in the queue
• See how many patients are ahead of you
• Get notified when it's your turn
• View the full day's appointment schedule
• Reschedule or cancel if needed

📍 Hospital Information:
${appointment.hospital.address ? JSON.stringify(appointment.hospital.address).replace(/[{}\"]/g, '') : 'Address available at hospital'}

We look forward to providing you with excellent healthcare services!

For any queries, please contact the hospital reception.`;
  }

  /**
   * Generate professional appointment cancellation message
   */
  generateCancellationMessage(appointment, previousStatus) {
    const appointmentDate = appointment.appointmentDate;
    const startTime = appointment.startTime ? new Date(appointment.startTime).toISOString().split('T')[1].split('.')[0] : 'TBD';
    
    // Build refund information if payment was made
    let refundInfo = '';
    if (appointment.paymentStatus === APPOINTMENT_PAYMENT_STATUS.PAID && appointment.amount) {
      refundInfo = `\n💰 REFUND INFORMATION:
• Paid Amount: ₹${appointment.amount}
• Refund will be processed within 5-7 business days
• Refund will be credited to the original payment method`;
    }

    return `🏥 ${appointment.hospital.name}

Dear ${appointment.patientName},

Your appointment has been cancelled.

📋 CANCELLED APPOINTMENT DETAILS:
• Appointment ID: ${appointment.id}
• Date: ${appointmentDate}
• Time: ${startTime}
• Doctor: Dr. ${appointment.doctor.name}
${appointment.doctor.specialization ? `• Specialization: ${appointment.doctor.specialization}` : ''}
• Previous Status: ${previousStatus.toUpperCase()}
• Current Status: CANCELLED

${refundInfo}

📞 NEXT STEPS:
• If you need to reschedule, please contact the hospital reception
• For urgent medical needs, please visit the emergency department
• You can book a new appointment through our system

📱 Contact Information:
${appointment.hospital.contactInfo ? JSON.stringify(appointment.hospital.contactInfo).replace(/[{}\"]/g, '') : 'Please contact hospital reception'}

We apologize for any inconvenience caused and look forward to serving you in the future.`;
  }

  /**
   * Generate professional appointment completion message
   */
  generateCompletionMessage(appointment) {
    const appointmentDate = appointment.appointmentDate;
    const startTime = appointment.startTime ? new Date(appointment.startTime).toISOString().split('T')[1].split('.')[0] : '';
    
    return `🏥 ${appointment.hospital.name}

Dear ${appointment.patientName},

Thank you for visiting us today!

📋 COMPLETED APPOINTMENT:
• Appointment ID: ${appointment.id}
• Date: ${appointmentDate}
• Time: ${startTime}
• Doctor: Dr. ${appointment.doctor.name}
${appointment.doctor.specialization ? `• Specialization: ${appointment.doctor.specialization}` : ''}
• Status: COMPLETED ✅

🩺 POST-VISIT INFORMATION:
• Please follow the prescribed treatment plan
• Take medications as advised by the doctor
• Schedule follow-up appointments if recommended
• Keep your prescription and medical reports safe

💡 FEEDBACK:
We value your feedback! Your experience helps us improve our services.

📱 FUTURE APPOINTMENTS:
You can book your next appointment through our system or contact the reception.

Thank you for choosing ${appointment.hospital.name} for your healthcare needs. We wish you good health!

For any medical queries, please contact: ${appointment.hospital.contactInfo ? JSON.stringify(appointment.hospital.contactInfo).replace(/[{}\"]/g, '') : 'Hospital reception'}`;
  }

  /**
   * Generate professional missed appointment message
   */
  generateMissedAppointmentMessage(appointment) {
    const appointmentDate = appointment.appointmentDate;
    const startTime = appointment.startTime ? new Date(appointment.startTime).toISOString().split('T')[1].split('.')[0] : 'TBD';
    
    return `🏥 ${appointment.hospital.name}

Dear ${appointment.patientName},

We notice you missed your scheduled appointment today.

📋 MISSED APPOINTMENT DETAILS:
• Appointment ID: ${appointment.id}
• Date: ${appointmentDate}
• Time: ${startTime}
• Doctor: Dr. ${appointment.doctor.name}
${appointment.doctor.specialization ? `• Specialization: ${appointment.doctor.specialization}` : ''}
• Status: MISSED ❌

📞 RESCHEDULE OPTIONS:
• Contact our reception to book a new appointment
• Visit our hospital for walk-in consultation (subject to availability)
• Use our online booking system

⚠️ IMPORTANT NOTES:
• Regular medical check-ups are important for your health
• If this was an emergency, please visit our emergency department
• Missing appointments may affect treatment continuity

📱 Contact Information:
${appointment.hospital.contactInfo ? JSON.stringify(appointment.hospital.contactInfo).replace(/[{}\"]/g, '') : 'Please contact hospital reception'}

We care about your health and look forward to serving you soon.`;
  }

  /**
   * Generate professional rebooked appointment message
   */
  generateRebookedMessage(appointment, previousStatus) {
    const appointmentDate = appointment.appointmentDate;
    const startTime = appointment.startTime ? new Date(appointment.startTime).toISOString().split('T')[1].split('.')[0] : 'TBD';
    const endTime = appointment.endTime ? new Date(appointment.endTime).toISOString().split('T')[1].split('.')[0] : '';
    
    return `🏥 ${appointment.hospital.name}

Dear ${appointment.patientName},

Great news! Your appointment has been rescheduled.

📋 UPDATED APPOINTMENT DETAILS:
• Appointment ID: ${appointment.id}
• New Date: ${appointmentDate}
• New Time: ${startTime}${endTime ? ` - ${endTime}` : ''}
• Doctor: Dr. ${appointment.doctor.name}
${appointment.doctor.specialization ? `• Specialization: ${appointment.doctor.specialization}` : ''}
• Previous Status: ${previousStatus.toUpperCase()}
• Current Status: BOOKED ✅

👨‍⚕️ DOCTOR INFORMATION:
${appointment.doctor.qualification ? `• Qualification: ${appointment.doctor.qualification}` : ''}
${appointment.doctor.experience ? `• Experience: ${appointment.doctor.experience} years` : ''}

💰 PAYMENT STATUS:
${appointment.paymentStatus === APPOINTMENT_PAYMENT_STATUS.PAID ? '✅ Confirmed' : '⏳ Pending'}
${appointment.amount ? `• Amount: ₹${appointment.amount}` : ''}

📝 REMINDERS:
• Please arrive 15 minutes before your appointment time
• Bring all relevant medical documents
• Carry a valid ID proof
• Follow any pre-appointment instructions given by the doctor

📱 Need to make changes? Contact our reception or use our online system.

We look forward to providing you with excellent healthcare services!`;
  }

  /**
   * Generate professional payment confirmation message
   */
  generatePaymentConfirmationMessage(appointment) {
    const appointmentDate = appointment.appointmentDate;
    const startTime = appointment.startTime ? new Date(appointment.startTime).toISOString().split('T')[1].split('.')[0] : 'TBD';
    
    return `🏥 ${appointment.hospital.name}

Dear ${appointment.patientName},

Payment confirmed! Thank you for your payment.

💰 PAYMENT DETAILS:
• Transaction Status: SUCCESS ✅
• Amount Paid: ₹${appointment.amount || 'N/A'}
• Payment Method: ${appointment.paymentMethod ? appointment.paymentMethod.toUpperCase() : 'N/A'}
• Payment Date: ${appointment.paymentAt || 'Just now'}

📋 APPOINTMENT DETAILS:
• Appointment ID: ${appointment.id}
• Date: ${appointmentDate}
• Time: ${startTime}
• Doctor: Dr. ${appointment.doctor.name}
${appointment.doctor.specialization ? `• Specialization: ${appointment.doctor.specialization}` : ''}
• Status: ${appointment.status.toUpperCase()}

🎯 NEXT STEPS:
• Your appointment is now confirmed
• You will receive queue updates on the appointment day
• Please arrive 15 minutes early
• Bring this confirmation and a valid ID

📱 IMPORTANT NOTES:
• Keep this payment confirmation for your records
• For any payment-related queries, contact our accounts department
• Refunds (if applicable) will be processed within 5-7 business days

Thank you for choosing ${appointment.hospital.name}. We look forward to serving you!

Contact: ${appointment.hospital.contactInfo ? JSON.stringify(appointment.hospital.contactInfo).replace(/[{}\"]/g, '') : 'Hospital reception'}`;
  }

  /**
   * Generate professional appointment deletion message
   */
  generateDeletionMessage(appointment) {
    const appointmentDate = appointment.appointmentDate;
    const startTime = appointment.startTime ? new Date(appointment.startTime).toISOString().split('T')[1].split('.')[0] : 'TBD';
    
    // Build refund information if payment was made
    let refundInfo = '';
    if (appointment.paymentStatus === APPOINTMENT_PAYMENT_STATUS.PAID && appointment.amount) {
      refundInfo = `\n💰 REFUND INFORMATION:
• Paid Amount: ₹${appointment.amount}
• Refund Status: Processing
• Expected Credit: 5-7 business days
• Credit Method: Original payment source`;
    }

    return `🏥 ${appointment.hospital.name}

Dear ${appointment.patientName},

Your appointment has been permanently removed from our system.

📋 DELETED APPOINTMENT DETAILS:
• Appointment ID: ${appointment.id}
• Date: ${appointmentDate}
• Time: ${startTime}
• Doctor: Dr. ${appointment.doctor.name}
${appointment.doctor.specialization ? `• Specialization: ${appointment.doctor.specialization}` : ''}
• Patient: ${appointment.patientName}
• Mobile: ${appointment.mobile}
• Deletion Date: ${new Date().toLocaleDateString()}

${refundInfo}

📞 REBOOKING OPTIONS:
• Contact hospital reception: ${appointment.hospital.contactInfo ? JSON.stringify(appointment.hospital.contactInfo).replace(/[{}\"]/g, '') : 'Available at hospital'}
• Visit our online booking system
• Walk-in consultation (subject to availability)

⚠️ IMPORTANT NOTES:
• This appointment slot is now available for other patients
• If you have urgent medical needs, please contact the emergency department
• All appointment-related data has been securely removed from our active system

📱 CUSTOMER SUPPORT:
For any questions about this deletion or to book a new appointment, please contact our customer support team.

We apologize for any inconvenience and hope to serve you again in the future.

${appointment.hospital.name}
Your Health, Our Priority`;
  }
  
}

module.exports = new AppointmentProcessor();