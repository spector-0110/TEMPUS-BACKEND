const dotenv = require('dotenv');
dotenv.config();

const twilioConfig = {
  // Twilio Account Configuration
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  
  // WhatsApp Configuration
  whatsapp: {
    // Twilio WhatsApp Sandbox number (replace with your approved number in production)
    phoneNumber: process.env.TWILIO_WHATSAPP_NUMBER,
    
    // Webhook configuration
    webhookUrl: process.env.TWILIO_WEBHOOK_URL,
    
  },
  
  
  // Logging Configuration
  logging: {
    enabled: process.env.TWILIO_LOGGING_ENABLED === 'true' || true,
    logLevel: process.env.TWILIO_LOG_LEVEL || 'info',
    retentionDays: parseInt(process.env.TWILIO_LOG_RETENTION_DAYS) || 7
  }
};

module.exports = twilioConfig;
