require('dotenv').config();
const axios = require('axios');

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';

async function testSendMessage() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const testPhoneNumber = process.env.TEST_PHONE_NUMBER; // Your phone number to receive test message

  if (!phoneNumberId || !accessToken) {
    console.error('Missing environment variables. Please set:');
    console.error('- WHATSAPP_PHONE_NUMBER_ID');
    console.error('- WHATSAPP_ACCESS_TOKEN');
    console.error('- TEST_PHONE_NUMBER (your phone number with country code, e.g., 919876543210)');
    return;
  }

  if (!testPhoneNumber) {
    console.error('Please set TEST_PHONE_NUMBER in .env (e.g., 919876543210)');
    return;
  }

  console.log('Testing WhatsApp Cloud API...');
  console.log(`Phone Number ID: ${phoneNumberId}`);
  console.log(`Sending to: ${testPhoneNumber}`);

  try {
    // Test 1: Send a simple text message
    console.log('\n--- Test 1: Sending text message ---');
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: testPhoneNumber,
        type: 'text',
        text: { body: 'Hello! This is a test message from your WhatsApp Lead Bot.' }
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Message sent successfully!');
    console.log('Response:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);

    if (error.response?.data?.error) {
      const err = error.response.data.error;
      console.log('\n--- Error Details ---');
      console.log(`Code: ${err.code}`);
      console.log(`Message: ${err.message}`);
      console.log(`Type: ${err.type}`);

      if (err.code === 190) {
        console.log('\nYour access token is invalid or expired. Get a new one from:');
        console.log('https://developers.facebook.com/apps/ > Your App > WhatsApp > API Setup');
      }
      if (err.code === 100) {
        console.log('\nInvalid phone number ID or the number is not registered.');
      }
    }
  }
}

async function testTemplateMessage() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const testPhoneNumber = process.env.TEST_PHONE_NUMBER;

  console.log('\n--- Test 2: Sending hello_world template ---');

  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: testPhoneNumber,
        type: 'template',
        template: {
          name: 'hello_world',
          language: { code: 'en_US' }
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Template sent successfully!');
    console.log('Response:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('Template Error:', error.response?.data || error.message);
  }
}

// Run tests
(async () => {
  await testSendMessage();
  await testTemplateMessage();
})();
