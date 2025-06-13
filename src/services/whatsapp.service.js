const twilio = require('twilio');
const twilioConfig = require('../config/twilio.config');

class WhatsAppService {
  constructor() {
    // Twilio configuration from config file
    this.accountSid = twilioConfig.accountSid;
    this.authToken = twilioConfig.authToken;
    this.twilioPhoneNumber = twilioConfig.whatsapp.phoneNumber;
    
    // Initialize Twilio client
    this.client = twilio(this.accountSid, this.authToken);
  }

  /**
   * Send a WhatsApp message
   * @param {string} to - Recipient phone number (with country code)
   * @param {string} message - Message content
   * @param {Object} options - Additional options (mediaUrl, template, etc.)
   * @returns {Promise<Object>} Message response
   */
  async sendMessage(to, message, options = {}) {
    try {
      // Format phone number for WhatsApp
      const formattedNumber = this.formatPhoneNumber(to);
      
      // Check rate limits
      
      const messageData = {
        body: message,
        from: this.twilioPhoneNumber,
        to: formattedNumber,
        ...options
      };

      // Add media URL if provided
      if (options.mediaUrl) {
        messageData.mediaUrl = options.mediaUrl;
      }

      console.log('Sending WhatsApp message: WatsappService()-----------------' , {
        to: formattedNumber,
        message: message,
        options: options
      });

      const response = await this.client.messages.create(messageData);
      
      // Log successful message
      await this.logMessage(formattedNumber, message, 'sent', response.sid);
            
      return {
        success: true,
        messageSid: response.sid,
        status: response.status,
        to: formattedNumber,
        message: 'WhatsApp message sent successfully'
      };
    } catch (error) {
      console.error('WhatsApp message sending error:', error);
      
      // Log failed message
      await this.logMessage(to, message, 'failed', null, error.message);
      
      return {
        success: false,
        error: error.message,
        code: error.code
      };
    }
  }

  /**
   * Get message status
   * @param {string} messageSid - Twilio message SID
   * @returns {Promise<Object>} Message status
   */
  async getMessageStatus(messageSid) {
    try {
      const message = await this.client.messages(messageSid).fetch();
      return {
        success: true,
        status: message.status,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage,
        dateCreated: message.dateCreated,
        dateSent: message.dateSent,
        dateUpdated: message.dateUpdated
      };
    } catch (error) {
      console.error('Error fetching message status:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Format phone number for WhatsApp
   * @param {string} phoneNumber - Phone number to format
   * @returns {string} Formatted WhatsApp number
   */
  formatPhoneNumber(phoneNumber) {
    // Remove any existing whatsapp: prefix
    let formatted = phoneNumber.replace('whatsapp:', '');
    
    // Add + if not present
    if (!formatted.startsWith('+')) {
      formatted = '+' + formatted;
    }
    
    // Add whatsapp: prefix
    return `whatsapp:${formatted}`;
  }


  /**
   * Log message activity
   * @param {string} to - Recipient
   * @param {string} message - Message content
   * @param {string} status - Message status
   * @param {string} messageSid - Twilio message SID
   * @param {string} error - Error message if any
   * @returns {Promise<void>}
   */
  async logMessage(to, message, status, messageSid = null, error = null) {
    const logData = {
      to,
      message: message.substring(0, 100), // Truncate for logging
      status,
      messageSid,
      error,
      timestamp: new Date().toISOString()
    };
    
    const logKey = `whatsapp_log:${Date.now()}`;
    await this.redis.setex(logKey, 86400, JSON.stringify(logData)); // 24 hours retention
    
    console.log('WhatsApp Message Log:', logData);
  }

  /**
   * Validate webhook signature (for webhook security)
   * @param {string} signature - X-Twilio-Signature header
   * @param {string} url - Webhook URL
   * @param {Object} params - Request parameters
   * @returns {boolean} Validation result
   */
  validateWebhookSignature(signature, url, params) {
    return twilio.validateRequest(this.authToken, signature, url, params);
  }


}

module.exports = new WhatsAppService();
