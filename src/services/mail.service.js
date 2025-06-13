const nodemailer = require('nodemailer');
const redisService = require('./redis.service');

class MailService {
  constructor() {
    this.initialized = false;
    this.initializeTransporter();

    this.RATE_LIMIT = {
      WINDOW: 3600, // 1 hour
      MAX_EMAILS: 100 // per hospital
    };
  }

  initializeTransporter() {
    const transportConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      },
      pool: true, // Use pooled connections
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000, // Min time between messages
      rateLimit: 5, // Max messages per rateDelta
    };

    // For Hostinger and other providers using SSL/TLS
    if (process.env.SMTP_SECURE === 'true') {
      transportConfig.tls = {
        rejectUnauthorized: false, // Allow self-signed certificates
        ciphers: 'SSLv3'
      };
    } else {
      // For STARTTLS
      transportConfig.tls = {
        rejectUnauthorized: process.env.NODE_ENV === 'production'
      };
    }

    this.transporter = nodemailer.createTransport(transportConfig);

    // Handle transporter events
    this.transporter.on('error', (err) => {
      console.error('Mail transporter error:', err);
      this.initialized = false;
    });
  }

  async verifyConnection() {
    try {
      if (!this.initialized) {
        await this.transporter.verify();
        this.initialized = true;
      }
      return true;
    } catch (error) {
      console.error('Email service verification failed:', error);
      this.initialized = false;
      return false;
    }
  }

  sanitizeHtml(html) {
    // Basic HTML sanitization
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/on\w+="[^"]*"/g, '')
      .replace(/javascript:/gi, '');
  }

  async checkRateLimit(hospitalId) {
    const key = `email:ratelimit:${hospitalId}`;
    const count = await redisService.get(key) || 0;
    
    if (count >= this.RATE_LIMIT.MAX_EMAILS) {
      throw new Error('Email rate limit exceeded');
    }
    
    await redisService.set(key, count + 1, this.RATE_LIMIT.WINDOW);
    return true;
  }

  validateEmail(email) {
    if (!email) {
      throw new Error('Email address is required');
    }

    // Trim the email to remove any whitespace
    email = email.trim();

    // More comprehensive email regex that follows RFC 5322 standard
    const emailRegex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    // Check length constraints
    if (email.length > 254) { // Maximum length for an email address
      throw new Error('Email address is too long');
    }

    // Check local part length
    const localPart = email.split('@')[0];
    if (localPart.length > 64) { // Maximum length for local part
      throw new Error('Local part of email is too long');
    }

    return true;
  }

  async sendMail(to, subject, html, hospitalId = null) {
    try {
      // Validate email
      this.validateEmail(to);

      // Check rate limit if hospitalId provided
      if (hospitalId) {
        await this.checkRateLimit(hospitalId);
      }

      // Ensure connection is verified
      if (!await this.verifyConnection()) {
        throw new Error('Email service unavailable');
      }

      const mailOptions = {
        from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
        to,
        subject: this.sanitizeHtml(subject),
        html: this.sanitizeHtml(html)
      };

      const info = await this.transporter.sendMail(mailOptions);
      
      // Log success
      await redisService.setCache(`email:log:${Date.now()}`, {
        status: 'sent',
        to,
        subject,
        messageId: info.messageId,
        timestamp: new Date().toISOString(),
        hospitalId
      },  24 * 60 * 60); // 1 days retention

      return true;
    } catch (error) {
      // Log failure
      await redisService.setCache(`email:error:${Date.now()}`, {
        status: 'failed',
        to,
        subject,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        hospitalId
      }, 24 * 60 * 60);

      console.error('Error sending email:', error);
      throw error;
    }
  }

  // async sendOTPEmail(to, otp, hospitalId = null) {
  //   const html = `
  //     <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  //       <h2 style="color: #2563EB;">Tempus OTP Verification</h2>
  //       <p>Hello,</p>
  //       <p>Your OTP for editing hospital details is:</p>
  //       <div style="background-color: #f3f4f6; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
  //         ${otp}
  //       </div>
  //       <p>This OTP will expire in 5 minutes.</p>
  //       <p style="color: #64748b; font-size: 14px;">If you didn't request this OTP, please ignore this email.</p>
  //       <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
  //       <p style="color: #64748b; font-size: 12px;">
  //         This is an automated email from Tempus. Please do not reply to this email.
  //       </p>
  //       <p style="color: #64748b; font-size: 10px;">
  //         Sent at: ${new Date().toISOString()}
  //       </p>
  //     </div>
  //   `;

  //   return this.sendMail(to, 'Hospital Edit Verification OTP', html, hospitalId);
  // }
}

module.exports = new MailService();