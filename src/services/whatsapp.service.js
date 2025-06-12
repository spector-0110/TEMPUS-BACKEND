const axios = require('axios');

class WhatsAppService {
    constructor() {
        this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        this.apiVersion = process.env.WHATSAPP_API_VERSION ;
        this.baseURL = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`;
        
        if (!this.accessToken || !this.phoneNumberId) {
            throw new Error('WhatsApp Access Token and Phone Number ID are required');
        }
    }

    /**
     * Send a text message to a WhatsApp number
     * @param {string} to - Recipient phone number (with country code, without + sign)
     * @param {string} message - Text message to send
     * @returns {Promise<Object>} Response from WhatsApp API
     */
    async sendMessage(to, message) {
        console.log('Sending WhatsApp message:', { to, message });
        try {
            const payload = {
                messaging_product: "whatsapp",
                to: to,
                type: "text",
                text: {
                    body: message
                }
            };

            const response = await axios.post(
                `${this.baseURL}/messages`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log('WhatsApp API Response:', response.data);
            return {
                success: true,
                data: response.data,
                messageId: response.data.messages[0].id
            };
        } catch (error) {
            console.error('WhatsApp API Error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data || error.message
            };
        }
    }

    /**
     * Send a template message
     * @param {string} to - Recipient phone number
     * @param {string} templateName - Name of the approved template
     * @param {string} languageCode - Language code (e.g., 'en_US', 'hi')
     * @param {Array} parameters - Template parameters (optional)
    //  * @returns {Promise<Object>} Response from WhatsApp API
    //  */
    // async sendTemplate(to, templateName, languageCode = 'en_US', parameters = []) {
    //     try {
    //         const payload = {
    //             messaging_product: "whatsapp",
    //             to: to,
    //             type: "template",
    //             template: {
    //                 name: templateName,
    //                 language: {
    //                     code: languageCode
    //                 }
    //             }
    //         };

    //         // Add parameters if provided
    //         if (parameters.length > 0) {
    //             payload.template.components = [
    //                 {
    //                     type: "body",
    //                     parameters: parameters.map(param => ({
    //                         type: "text",
    //                         text: param
    //                     }))
    //                 }
    //             ];
    //         }

    //         const response = await axios.post(
    //             `${this.baseURL}/messages`,
    //             payload,
    //             {
    //                 headers: {
    //                     'Authorization': `Bearer ${this.accessToken}`,
    //                     'Content-Type': 'application/json'
    //                 }
    //             }
    //         );

    //         return {
    //             success: true,
    //             data: response.data,
    //             messageId: response.data.messages[0].id
    //         };
    //     } catch (error) {
    //         console.error('WhatsApp Template API Error:', error.response?.data || error.message);
    //         return {
    //             success: false,
    //             error: error.response?.data || error.message
    //         };
    //     }
    // }

    // /**
    //  * Send media message (image, document, audio, video)
    //  * @param {string} to - Recipient phone number
    //  * @param {string} mediaType - Type of media: 'image', 'document', 'audio', 'video'
    //  * @param {string} mediaUrl - URL of the media file
    //  * @param {string} caption - Caption for the media (optional)
    //  * @param {string} filename - Filename for documents (optional)
    //  * @returns {Promise<Object>} Response from WhatsApp API
    //  */
    // async sendMedia(to, mediaType, mediaUrl, caption = '', filename = '') {
    //     try {
    //         const mediaObject = {
    //             link: mediaUrl
    //         };

    //         if (caption && ['image', 'video', 'document'].includes(mediaType)) {
    //             mediaObject.caption = caption;
    //         }

    //         if (filename && mediaType === 'document') {
    //             mediaObject.filename = filename;
    //         }

    //         const payload = {
    //             messaging_product: "whatsapp",
    //             to: to,
    //             type: mediaType,
    //             [mediaType]: mediaObject
    //         };

    //         const response = await axios.post(
    //             `${this.baseURL}/messages`,
    //             payload,
    //             {
    //                 headers: {
    //                     'Authorization': `Bearer ${this.accessToken}`,
    //                     'Content-Type': 'application/json'
    //                 }
    //             }
    //         );

    //         return {
    //             success: true,
    //             data: response.data,
    //             messageId: response.data.messages[0].id
    //         };
    //     } catch (error) {
    //         console.error('WhatsApp Media API Error:', error.response?.data || error.message);
    //         return {
    //             success: false,
    //             error: error.response?.data || error.message
    //         };
    //     }
    // }

    // /**
    //  * Send interactive button message
    //  * @param {string} to - Recipient phone number
    //  * @param {string} bodyText - Main message text
    //  * @param {Array} buttons - Array of button objects {id, title}
    //  * @param {string} headerText - Header text (optional)
    //  * @param {string} footerText - Footer text (optional)
    //  * @returns {Promise<Object>} Response from WhatsApp API
    //  */
    // async sendInteractiveButtons(to, bodyText, buttons, headerText = '', footerText = '') {
    //     try {
    //         const interactive = {
    //             type: "button",
    //             body: {
    //                 text: bodyText
    //             },
    //             action: {
    //                 buttons: buttons.map((button, index) => ({
    //                     type: "reply",
    //                     reply: {
    //                         id: button.id || `btn_${index}`,
    //                         title: button.title
    //                     }
    //                 }))
    //             }
    //         };

    //         if (headerText) {
    //             interactive.header = {
    //                 type: "text",
    //                 text: headerText
    //             };
    //         }

    //         if (footerText) {
    //             interactive.footer = {
    //                 text: footerText
    //             };
    //         }

    //         const payload = {
    //             messaging_product: "whatsapp",
    //             to: to,
    //             type: "interactive",
    //             interactive: interactive
    //         };

    //         const response = await axios.post(
    //             `${this.baseURL}/messages`,
    //             payload,
    //             {
    //                 headers: {
    //                     'Authorization': `Bearer ${this.accessToken}`,
    //                     'Content-Type': 'application/json'
    //                 }
    //             }
    //         );

    //         return {
    //             success: true,
    //             data: response.data,
    //             messageId: response.data.messages[0].id
    //         };
    //     } catch (error) {
    //         console.error('WhatsApp Interactive API Error:', error.response?.data || error.message);
    //         return {
    //             success: false,
    //             error: error.response?.data || error.message
    //         };
    //     }
    // }

    // /**
    //  * Send interactive list message
    //  * @param {string} to - Recipient phone number
    //  * @param {string} bodyText - Main message text
    //  * @param {string} buttonText - Button text to show the list
    //  * @param {Array} sections - Array of section objects with rows
    //  * @param {string} headerText - Header text (optional)
    //  * @param {string} footerText - Footer text (optional)
    //  * @returns {Promise<Object>} Response from WhatsApp API
    //  */
    // async sendInteractiveList(to, bodyText, buttonText, sections, headerText = '', footerText = '') {
    //     try {
    //         const interactive = {
    //             type: "list",
    //             body: {
    //                 text: bodyText
    //             },
    //             action: {
    //                 button: buttonText,
    //                 sections: sections
    //             }
    //         };

    //         if (headerText) {
    //             interactive.header = {
    //                 type: "text",
    //                 text: headerText
    //             };
    //         }

    //         if (footerText) {
    //             interactive.footer = {
    //                 text: footerText
    //             };
    //         }

    //         const payload = {
    //             messaging_product: "whatsapp",
    //             to: to,
    //             type: "interactive",
    //             interactive: interactive
    //         };

    //         const response = await axios.post(
    //             `${this.baseURL}/messages`,
    //             payload,
    //             {
    //                 headers: {
    //                     'Authorization': `Bearer ${this.accessToken}`,
    //                     'Content-Type': 'application/json'
    //                 }
    //             }
    //         );

    //         return {
    //             success: true,
    //             data: response.data,
    //             messageId: response.data.messages[0].id
    //         };
    //     } catch (error) {
    //         console.error('WhatsApp List API Error:', error.response?.data || error.message);
    //         return {
    //             success: false,
    //             error: error.response?.data || error.message
    //         };
    //     }
    // }

    // /**
    //  * Mark message as read
    //  * @param {string} messageId - ID of the message to mark as read
    //  * @returns {Promise<Object>} Response from WhatsApp API
    //  */
    // async markAsRead(messageId) {
    //     try {
    //         const payload = {
    //             messaging_product: "whatsapp",
    //             status: "read",
    //             message_id: messageId
    //         };

    //         const response = await axios.post(
    //             `${this.baseURL}/messages`,
    //             payload,
    //             {
    //                 headers: {
    //                     'Authorization': `Bearer ${this.accessToken}`,
    //                     'Content-Type': 'application/json'
    //                 }
    //             }
    //         );

    //         return {
    //             success: true,
    //             data: response.data
    //         };
    //     } catch (error) {
    //         console.error('WhatsApp Mark Read API Error:', error.response?.data || error.message);
    //         return {
    //             success: false,
    //             error: error.response?.data || error.message
    //         };
    //     }
    // }

    // /**
    //  * Get media URL by media ID
    //  * @param {string} mediaId - Media ID from webhook
    //  * @returns {Promise<Object>} Media URL and info
    //  */
    // async getMediaUrl(mediaId) {
    //     try {
    //         const response = await axios.get(
    //             `https://graph.facebook.com/${this.apiVersion}/${mediaId}`,
    //             {
    //                 headers: {
    //                     'Authorization': `Bearer ${this.accessToken}`
    //                 }
    //             }
    //         );

    //         return {
    //             success: true,
    //             data: response.data
    //         };
    //     } catch (error) {
    //         console.error('WhatsApp Media URL API Error:', error.response?.data || error.message);
    //         return {
    //             success: false,
    //             error: error.response?.data || error.message
    //         };
    //     }
    // }

    // /**
    //  * Verify webhook signature
    //  * @param {string} payload - Raw webhook payload
    //  * @param {string} signature - X-Hub-Signature-256 header
    //  * @returns {boolean} Whether signature is valid
    //  */
    // verifyWebhookSignature(payload, signature) {
    //     const crypto = require('crypto');
    //     const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
        
    //     if (!webhookSecret) {
    //         console.error('Webhook secret not configured');
    //         return false;
    //     }

    //     const expectedSignature = crypto
    //         .createHmac('sha256', webhookSecret)
    //         .update(payload, 'utf8')
    //         .digest('hex');

    //     const providedSignature = signature.replace('sha256=', '');
        
    //     return crypto.timingSafeEqual(
    //         Buffer.from(expectedSignature, 'hex'),
    //         Buffer.from(providedSignature, 'hex')
    //     );
    // }

}

// Create and export a singleton instance
const whatsappService = new WhatsAppService();

module.exports = whatsappService;