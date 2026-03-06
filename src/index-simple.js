require('dotenv').config();
const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');
const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const fs = require('fs');

const app = express();

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const PORT = process.env.PORT || 3000;

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';

// Database Connection - Use PostgreSQL in production, SQLite locally
let sequelize;
if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false }
    }
  });
} else {
  // SQLite for local development
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, '..', 'database.sqlite'),
    logging: false
  });
  console.log('Using SQLite database for local development');
}

// Lead Model
const Lead = sequelize.define('Lead', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  phoneNumber: { type: DataTypes.STRING, allowNull: false, unique: true },
  whatsappName: DataTypes.STRING,
  name: DataTypes.STRING,
  email: DataTypes.STRING,
  company: DataTypes.STRING,
  designation: DataTypes.STRING,
  inquiryType: { type: DataTypes.STRING, defaultValue: 'general' }, // service, job, networking, event, general
  service: DataTypes.STRING,
  budget: DataTypes.STRING,
  timeline: DataTypes.STRING,
  eventName: DataTypes.STRING,
  personToConnect: DataTypes.STRING,
  jobRole: DataTypes.STRING,
  experience: DataTypes.STRING,
  resumeLink: DataTypes.STRING,
  resumeFileName: DataTypes.STRING,
  resumeMediaId: DataTypes.STRING,
  attachments: { type: DataTypes.JSON, defaultValue: [] }, // Array of {mediaId, fileName, mimeType, localPath}
  notes: DataTypes.TEXT,
  status: { type: DataTypes.STRING, defaultValue: 'new' }, // new, in_progress, completed, contacted
  conversationHistory: { type: DataTypes.JSON, defaultValue: [] }
}, {
  tableName: 'leads',
  timestamps: true
});

// Sync database
sequelize.sync().then(() => {
  console.log('PostgreSQL connected & synced');
}).catch(err => {
  console.error('Database error:', err);
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const SYSTEM_PROMPT = `You are a friendly and professional assistant for Ethinos Digital Marketing, a leading digital marketing agency.

CRITICAL: Always check the user's LATEST message to identify their intent. If they say anything about "job", "career", "hiring", "vacancy", "work with you", "looking for job", "opportunity" - this is a JOB INQUIRY. Switch immediately!

INQUIRY TYPES:
1. JOB INQUIRY - Keywords: job, career, hiring, vacancy, position, work with you, opportunity, looking for job, employment
2. SERVICE INQUIRY - Looking for digital marketing services
3. NETWORKING - Wants to connect with someone specific
4. EVENT CONTACT - Met us at an event
5. GENERAL - General questions

WHEN USER SAYS "looking for job" or similar - THIS IS A JOB INQUIRY. Do NOT ask about services!

FOR JOB INQUIRY (PRIORITY):
When someone mentions job/career/hiring:
1. Acknowledge their interest in joining our team
2. Ask: What role are you interested in?
3. Then ask: How many years of experience do you have?
4. Ask them to share their resume (they can send as PDF/DOC)
5. End with: "Thanks! Our HR team will review and get back to you. You can also email careers@ethinos.com"

FOR SERVICE INQUIRY:
- Name, Email, Company/Business name
- Service interested in (SEO, Social Media Marketing, PPC/Google Ads, Web Development, Content Marketing, etc.)
- Budget range, Timeline

FOR NETWORKING:
- Name, Email, Company
- Who they want to connect with and why
- Tell them: "I'll pass this to the right person. They'll reach out soon!"

FOR EVENT CONTACT:
- Name, Email, Company
- Which event they met us at
- What they discussed or their interest

GUIDELINES:
- ALWAYS check latest message for intent change (especially job-related keywords)
- Be conversational, warm and professional
- Ask ONE question at a time
- Keep responses short (2-3 sentences max)
- Use their name once you know it

ABOUT ETHINOS DIGITAL MARKETING:
- Full-service digital marketing agency
- Services: SEO, Social Media Marketing, PPC/Google Ads, Content Marketing, Web Development, Branding
- We're always looking for talented people to join our team!

IMPORTANT: After EVERY response, output this JSON block:
<LEAD_DATA>{
  "inquiryType": "service|job|networking|event|general",
  "name": "value or null",
  "email": "value or null",
  "company": "value or null",
  "designation": "value or null",
  "service": "value or null",
  "budget": "value or null",
  "timeline": "value or null",
  "eventName": "value or null",
  "personToConnect": "value or null",
  "jobRole": "value or null",
  "experience": "value or null",
  "resumeLink": "value or null",
  "notes": "any additional context or null"
}</LEAD_DATA>
Only include fields with NEW information from THIS message.`;

app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// Basic Auth for admin routes
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'ethinos123';

function basicAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required');
  }
  const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  if (credentials[0] === ADMIN_USER && credentials[1] === ADMIN_PASS) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('Invalid credentials');
}

// Public static files (not admin)
app.use(express.static(path.join(__dirname, 'public')));

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('Webhook verified!');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Webhook handler (POST)
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(404);
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    const contacts = value?.contacts;

    if (!messages || messages.length === 0) {
      return res.sendStatus(200);
    }

    const message = messages[0];
    const from = message.from;
    const messageType = message.type;
    const whatsappName = contacts?.[0]?.profile?.name || '';

    let messageText = '';
    let mediaInfo = null;

    // Handle different message types
    if (messageType === 'text') {
      messageText = message.text?.body || '';
    } else if (messageType === 'interactive') {
      // Handle button response
      const buttonReply = message.interactive?.button_reply;
      if (buttonReply) {
        messageText = buttonReply.title;
        // Map button IDs to inquiry types
        if (buttonReply.id === 'inquiry_service') {
          messageText = 'I want to know about your services';
        } else if (buttonReply.id === 'inquiry_job') {
          messageText = 'I am looking for a job';
        } else if (buttonReply.id === 'inquiry_connect') {
          messageText = 'I want to connect with someone';
        }
      }
    } else if (messageType === 'document') {
      const doc = message.document;
      mediaInfo = {
        mediaId: doc.id,
        fileName: doc.filename || 'document',
        mimeType: doc.mime_type,
        type: 'document'
      };
      messageText = `[Shared document: ${doc.filename || 'document'}]`;
    } else if (messageType === 'image') {
      const img = message.image;
      mediaInfo = {
        mediaId: img.id,
        mimeType: img.mime_type,
        caption: img.caption || '',
        type: 'image'
      };
      messageText = img.caption || '[Shared an image]';
    } else if (messageType === 'audio') {
      messageText = '[Shared an audio message]';
    } else if (messageType === 'video') {
      messageText = '[Shared a video]';
    }

    console.log(`Message from ${from} (${whatsappName}): ${messageText}`);

    // Get or create lead
    let [lead, created] = await Lead.findOrCreate({
      where: { phoneNumber: from },
      defaults: {
        phoneNumber: from,
        whatsappName,
        status: 'in_progress',
        conversationHistory: [],
        attachments: []
      }
    });

    // Send welcome message with buttons for NEW users
    if (created) {
      await sendWelcomeMessage(from, whatsappName);
      // Add welcome to history
      const history = [{
        role: 'assistant',
        content: '[Sent welcome message with options]',
        timestamp: new Date().toISOString()
      }, {
        role: 'user',
        content: messageText,
        timestamp: new Date().toISOString()
      }];
      await lead.update({ conversationHistory: history });
      return res.sendStatus(200);
    }

    // Handle media downloads (resume, documents, images)
    if (mediaInfo) {
      try {
        const downloadedFile = await downloadWhatsAppMedia(mediaInfo.mediaId, lead.id, mediaInfo.fileName || 'file');

        const attachment = {
          mediaId: mediaInfo.mediaId,
          fileName: mediaInfo.fileName || downloadedFile.fileName,
          mimeType: mediaInfo.mimeType,
          localPath: downloadedFile.localPath,
          downloadedAt: new Date().toISOString(),
          type: mediaInfo.type
        };

        const attachments = [...(lead.attachments || []), attachment];

        // If it's a document (likely resume for job inquiries), save as resume
        if (mediaInfo.type === 'document') {
          await lead.update({
            attachments,
            resumeFileName: mediaInfo.fileName,
            resumeMediaId: mediaInfo.mediaId,
            resumeLink: downloadedFile.localPath
          });
        } else {
          await lead.update({ attachments });
        }

        console.log(`Media downloaded: ${downloadedFile.localPath}`);
      } catch (err) {
        console.error('Failed to download media:', err.message);
      }
    }

    // Add user message to history
    const history = [...(lead.conversationHistory || [])];
    history.push({
      role: 'user',
      content: messageText,
      timestamp: new Date().toISOString()
    });

    // Get AI response
    const aiResponse = await getAIResponse(lead, history);

    // Parse and extract lead data from AI response
    const { cleanResponse, leadData } = parseAIResponse(aiResponse);

    // Update lead with extracted data
    const updates = {};
    if (leadData.inquiryType) updates.inquiryType = leadData.inquiryType;
    if (leadData.name) updates.name = leadData.name;
    if (leadData.email) updates.email = leadData.email;
    if (leadData.company) updates.company = leadData.company;
    if (leadData.designation) updates.designation = leadData.designation;
    if (leadData.service) updates.service = leadData.service;
    if (leadData.budget) updates.budget = leadData.budget;
    if (leadData.timeline) updates.timeline = leadData.timeline;
    if (leadData.eventName) updates.eventName = leadData.eventName;
    if (leadData.personToConnect) updates.personToConnect = leadData.personToConnect;
    if (leadData.jobRole) updates.jobRole = leadData.jobRole;
    if (leadData.experience) updates.experience = leadData.experience;
    if (leadData.resumeLink) updates.resumeLink = leadData.resumeLink;
    if (leadData.notes) updates.notes = leadData.notes;

    // Add assistant response to history
    history.push({
      role: 'assistant',
      content: cleanResponse,
      timestamp: new Date().toISOString()
    });

    updates.conversationHistory = history;

    // Check if lead is complete based on inquiry type
    const updatedLead = { ...lead.toJSON(), ...updates };
    const type = updatedLead.inquiryType || 'general';

    let isComplete = false;
    if (type === 'service' && updatedLead.name && updatedLead.email && updatedLead.company && updatedLead.service) {
      isComplete = true;
    } else if (type === 'job' && updatedLead.name && updatedLead.email && updatedLead.jobRole) {
      isComplete = true;
    } else if (type === 'networking' && updatedLead.name && updatedLead.email && updatedLead.personToConnect) {
      isComplete = true;
    } else if (type === 'event' && updatedLead.name && updatedLead.email && updatedLead.eventName) {
      isComplete = true;
    } else if (type === 'general' && updatedLead.name && updatedLead.email) {
      isComplete = true;
    }

    if (isComplete) {
      updates.status = 'completed';
    }

    await lead.update(updates);

    // Send WhatsApp message
    await sendWhatsAppMessage(from, cleanResponse);

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

async function getAIResponse(lead, history) {
  try {
    const leadContext = `Current lead data:
- Inquiry Type: ${lead.inquiryType || 'unknown'}
- Name: ${lead.name || 'unknown'}
- Email: ${lead.email || 'unknown'}
- Company: ${lead.company || 'unknown'}
- Designation: ${lead.designation || 'unknown'}
- Service Interest: ${lead.service || 'unknown'}
- Budget: ${lead.budget || 'unknown'}
- Timeline: ${lead.timeline || 'unknown'}
- Event: ${lead.eventName || 'unknown'}
- Person to Connect: ${lead.personToConnect || 'unknown'}
- Job Role: ${lead.jobRole || 'unknown'}
- Experience: ${lead.experience || 'unknown'}
- Resume: ${lead.resumeLink || 'unknown'}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: leadContext },
        ...history.slice(-20).map(m => ({ role: m.role, content: m.content }))
      ],
      max_tokens: 300,
      temperature: 0.7
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI error:', error);
    return "Sorry, I'm having some trouble right now. Please try again in a moment.";
  }
}

function parseAIResponse(response) {
  let cleanResponse = response;
  let leadData = {};

  const match = response.match(/<LEAD_DATA>(.*?)<\/LEAD_DATA>/s);
  if (match) {
    cleanResponse = response.replace(/<LEAD_DATA>.*?<\/LEAD_DATA>/s, '').trim();
    try {
      leadData = JSON.parse(match[1]);
    } catch (e) {
      console.error('Failed to parse lead data:', e);
    }
  }

  return { cleanResponse, leadData };
}

// Download media from WhatsApp
async function downloadWhatsAppMedia(mediaId, leadId, originalFileName) {
  try {
    // Step 1: Get media URL
    const mediaInfoUrl = `${WHATSAPP_API_URL}/${mediaId}`;
    const mediaInfoRes = await axios.get(mediaInfoUrl, {
      headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
    });

    const mediaUrl = mediaInfoRes.data.url;
    const mimeType = mediaInfoRes.data.mime_type;

    // Step 2: Download the file
    const fileRes = await axios.get(mediaUrl, {
      headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      responseType: 'arraybuffer'
    });

    // Determine file extension
    const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
    const fileName = `${leadId}_${Date.now()}_${originalFileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = path.join(uploadsDir, fileName);

    // Save file
    fs.writeFileSync(filePath, fileRes.data);

    return {
      localPath: `/uploads/${fileName}`,
      fileName: fileName,
      fullPath: filePath
    };
  } catch (error) {
    console.error('Media download error:', error.response?.data || error.message);
    throw error;
  }
}

async function sendWhatsAppMessage(to, message) {
  const url = `${WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

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
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );

  console.log('Reply sent to', to);
  return response.data;
}

// Send interactive buttons message
async function sendInteractiveButtons(to, bodyText, buttons) {
  const url = `${WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

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
          buttons: buttons.map((btn, idx) => ({
            type: 'reply',
            reply: {
              id: btn.id,
              title: btn.title
            }
          }))
        }
      }
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );

  console.log('Interactive buttons sent to', to);
  return response.data;
}

// Send welcome message with options
async function sendWelcomeMessage(to, name) {
  const greeting = name ? `Hi ${name}! 👋` : 'Hi there! 👋';
  const bodyText = `${greeting}\n\nThank you for reaching out to Ethinos Digital Marketing! We're excited to connect with you.\n\nHow can we help you today?`;

  const buttons = [
    { id: 'inquiry_service', title: '💼 Our Services' },
    { id: 'inquiry_job', title: '👔 Career/Jobs' },
    { id: 'inquiry_connect', title: '🤝 Connect/Other' }
  ];

  return await sendInteractiveButtons(to, bodyText, buttons);
}

// ============ ADMIN API ROUTES (Protected) ============

// Get all leads
app.get('/api/leads', basicAuth, async (req, res) => {
  try {
    const { status, search } = req.query;
    let where = {};

    if (status && status !== 'all') {
      where.status = status;
    }

    if (search) {
      const { Op } = require('sequelize');
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { company: { [Op.iLike]: `%${search}%` } },
        { phoneNumber: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const leads = await Lead.findAll({ where, order: [['updatedAt', 'DESC']] });
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single lead
app.get('/api/leads/:id', basicAuth, async (req, res) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update lead
app.patch('/api/leads/:id', basicAuth, async (req, res) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    await lead.update(req.body);
    res.json(lead);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete lead
app.delete('/api/leads/:id', basicAuth, async (req, res) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    await lead.destroy();
    res.json({ message: 'Lead deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get stats
app.get('/api/stats', basicAuth, async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const total = await Lead.count();
    const completed = await Lead.count({ where: { status: 'completed' } });
    const inProgress = await Lead.count({ where: { status: 'in_progress' } });
    const contacted = await Lead.count({ where: { status: 'contacted' } });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLeads = await Lead.count({ where: { createdAt: { [Op.gte]: today } } });

    res.json({
      total,
      completed,
      inProgress,
      contacted,
      todayLeads,
      conversionRate: total > 0 ? ((completed / total) * 100).toFixed(1) : 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send message to lead
app.post('/api/leads/:id/message', basicAuth, async (req, res) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const { message } = req.body;
    await sendWhatsAppMessage(lead.phoneNumber, message);

    const history = [...(lead.conversationHistory || [])];
    history.push({
      role: 'assistant',
      content: message,
      timestamp: new Date().toISOString()
    });
    await lead.update({ conversationHistory: history });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'WhatsApp Lead Bot is running!' });
});

// Admin panel (protected)
app.get('/admin', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
});
