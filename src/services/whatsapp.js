const axios = require('axios');

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';

class WhatsAppService {
  constructor() {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  }

  async sendMessage(to, message) {
    try {
      const url = `${WHATSAPP_API_URL}/${this.phoneNumberId}/messages`;

      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to,
          type: 'text',
          text: { body: message }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`Message sent to ${to}`);
      return response.data;
    } catch (error) {
      console.error('Error sending WhatsApp message:', error.response?.data || error.message);
      throw error;
    }
  }

  async sendTemplate(to, templateName, languageCode = 'en', components = []) {
    try {
      const url = `${WHATSAPP_API_URL}/${this.phoneNumberId}/messages`;

      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components: components
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`Template ${templateName} sent to ${to}`);
      return response.data;
    } catch (error) {
      console.error('Error sending template:', error.response?.data || error.message);
      throw error;
    }
  }

  async sendInteractiveButtons(to, bodyText, buttons) {
    try {
      const url = `${WHATSAPP_API_URL}/${this.phoneNumberId}/messages`;

      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: bodyText },
            action: {
              buttons: buttons.map((btn, index) => ({
                type: 'reply',
                reply: {
                  id: `btn_${index}`,
                  title: btn
                }
              }))
            }
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error sending interactive message:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new WhatsAppService();
