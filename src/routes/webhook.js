const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsapp');
const aiService = require('../services/ai');
const leadService = require('../services/lead');

// Webhook verification (GET) - Required by Meta
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Webhook handler (POST) - Receives messages
router.post('/', async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(404);
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return res.sendStatus(200);
    }

    const message = messages[0];
    const from = message.from;
    const messageText = message.text?.body || '';
    const messageType = message.type;

    console.log(`Message from ${from}: ${messageText}`);

    // Get or create lead session
    const lead = await leadService.getOrCreateLead(from);

    // Process message based on lead flow state
    const response = await leadService.processMessage(lead, messageText, messageType);

    // Send response via WhatsApp
    if (response) {
      await whatsappService.sendMessage(from, response);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

module.exports = router;
