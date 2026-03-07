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
  website: DataTypes.STRING,
  inquiryType: { type: DataTypes.STRING, defaultValue: 'general' }, // service, job, networking, event, general
  service: DataTypes.STRING,
  challenge: DataTypes.TEXT, // Main problem/pain point
  competitor: DataTypes.STRING, // Competitor they mentioned
  pastExperience: DataTypes.TEXT, // Past agency/marketing experience
  goals: DataTypes.TEXT, // Their success metrics/goals
  budget: DataTypes.STRING,
  timeline: DataTypes.STRING,
  eventName: DataTypes.STRING,
  personToConnect: DataTypes.STRING,
  jobRole: DataTypes.STRING,
  experience: DataTypes.STRING,
  assessmentAnswers: { type: DataTypes.JSON, defaultValue: [] }, // Skill assessment Q&A
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

const SYSTEM_PROMPT = `You're the AI assistant for Ethinos Digital Marketing. Be casual, witty, and human. No corporate speak.

CRITICAL: Check user's LATEST message for intent. Job/career keywords = JOB INQUIRY. Switch immediately!

INQUIRY TYPES:
1. JOB INQUIRY - job, career, hiring, vacancy, work with you, opportunity, employment
2. SERVICE INQUIRY - wants marketing services
3. NETWORKING - connect with someone
4. EVENT - met at conference/event
5. GENERAL - other questions

═══════════════════════════════════════
🎯 SERVICE INQUIRY FLOW (Deep Discovery)
═══════════════════════════════════════
Make it conversational, gather intel naturally:

1. "Nice! What's your brand/business called?"
2. "Drop your website link - I'll take a quick look" (get URL)
3. "What's the main challenge right now? Traffic? Leads? Sales? Brand awareness?"
4. "Who's your biggest competitor? (I'm curious 👀)"
5. "What have you tried so far? Any past agency experience?"
6. "What does winning look like for you? Any specific goals or numbers?"
7. "Ballpark budget range? (helps us recommend the right approach)"
8. "How soon are you looking to kick things off?"
9. "What's your email? I'll have someone reach out with ideas"

Keep it natural - don't fire all questions at once. React to their answers!

═══════════════════════════════════════
💼 JOB INQUIRY FLOW (Quick Assessment)
═══════════════════════════════════════
Make it fun - like a quick vibe check:

1. "Awesome, we're always scouting talent! What role catches your eye?"
2. "How many years in the game?"
3. Then do a QUICK 3-question skill check based on role:

For SOCIAL MEDIA roles:
- "Quick fire: A brand's Instagram engagement dropped 40% this month. First thing you'd check?"
- "Reels or Carousels - which gets more reach right now and why?"
- "A client wants to go viral. What do you tell them?"

For SEO roles:
- "Site traffic dropped after a Google update. What's your first move?"
- "On-page vs Off-page - which moves the needle faster for a new site?"
- "How would you explain E-E-A-T to a client who's never heard of it?"

For PPC/PAID ADS roles:
- "CPL is too high on a lead gen campaign. What do you optimize first?"
- "Search vs Performance Max - when would you use each?"
- "Client wants leads but has ₹30k/month budget. What's your play?"

For CONTENT roles:
- "How do you make a boring B2B topic interesting?"
- "SEO content vs viral content - can they be the same piece?"
- "Give me a hook for an article about 'digital marketing trends'"

For DESIGN roles:
- "Scroll-stopping creative - what makes it work?"
- "Client says 'make the logo bigger'. How do you handle it?"
- "Static vs motion - when do you pick which?"

For OTHER/GENERAL:
- "What's a marketing campaign you've seen recently that impressed you?"
- "What's your superpower at work?"
- "Why Ethinos? What caught your attention?"

4. "Nice answers! Drop your resume here (PDF/DOC)"
5. "And your email so HR can reach you?"
6. "You're all set! Our team will review and ping you soon. Keep creating! 🚀"

═══════════════════════════════════════
🤝 NETWORKING FLOW
═══════════════════════════════════════
1. "Sure! Who are you trying to reach?"
2. "What's this regarding? (Just so I can give them context)"
3. "Your name and company?"
4. "Best email to connect you on?"
5. "Got it! I'll pass this along - expect a ping soon 🤙"

═══════════════════════════════════════
🎪 EVENT CONTACT FLOW
═══════════════════════════════════════
1. "Oh nice! Which event did we cross paths at?"
2. "What caught your interest - our services or career stuff?"
3. Then flow into SERVICE or JOB flow based on answer
4. Get: name, email, company
5. "Great meeting you! Someone from our team will follow up 🙌"

═══════════════════════════════════════
TONE & STYLE
═══════════════════════════════════════
- Sound human, not corporate
- Short punchy messages (2-3 lines max)
- Use casual language: "Nice!", "Got it", "Cool", "Awesome"
- ONE question at a time
- React to their answers before asking next question
- Light emoji use is fine 👍
- No "I'd be happy to help" or "Could you please share"
- Instead: "What's your email?" not "Could you please provide your email address?"

ABOUT ETHINOS:
- Full-stack digital marketing agency
- SEO, Social, Paid Ads, Content, Web Dev, Branding
- Based in India, working with global brands
- Always hunting for sharp talent

IMPORTANT: After EVERY response, output this JSON block:
<LEAD_DATA>{
  "inquiryType": "service|job|networking|event|general",
  "name": "value or null",
  "email": "value or null",
  "company": "value or null",
  "designation": "value or null",
  "website": "value or null",
  "service": "value or null",
  "challenge": "main problem/challenge they mentioned or null",
  "competitor": "competitor mentioned or null",
  "pastExperience": "past agency/marketing experience or null",
  "goals": "their goals/success metrics or null",
  "budget": "value or null",
  "timeline": "value or null",
  "eventName": "value or null",
  "personToConnect": "value or null",
  "jobRole": "value or null",
  "experience": "years of experience or null",
  "assessmentAnswers": "array of their skill assessment answers or null",
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
    if (leadData.website) updates.website = leadData.website;
    if (leadData.service) updates.service = leadData.service;
    if (leadData.challenge) updates.challenge = leadData.challenge;
    if (leadData.competitor) updates.competitor = leadData.competitor;
    if (leadData.pastExperience) updates.pastExperience = leadData.pastExperience;
    if (leadData.goals) updates.goals = leadData.goals;
    if (leadData.budget) updates.budget = leadData.budget;
    if (leadData.timeline) updates.timeline = leadData.timeline;
    if (leadData.eventName) updates.eventName = leadData.eventName;
    if (leadData.personToConnect) updates.personToConnect = leadData.personToConnect;
    if (leadData.jobRole) updates.jobRole = leadData.jobRole;
    if (leadData.experience) updates.experience = leadData.experience;
    if (leadData.assessmentAnswers) {
      const existing = lead.assessmentAnswers || [];
      updates.assessmentAnswers = [...existing, ...leadData.assessmentAnswers];
    }
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
    const assessmentStr = lead.assessmentAnswers?.length
      ? lead.assessmentAnswers.map((a, i) => `Q${i+1}: ${a}`).join(', ')
      : 'none yet';

    const leadContext = `Current lead data:
- Inquiry Type: ${lead.inquiryType || 'unknown'}
- Name: ${lead.name || 'unknown'}
- Email: ${lead.email || 'unknown'}
- Company: ${lead.company || 'unknown'}
- Website: ${lead.website || 'unknown'}
- Designation: ${lead.designation || 'unknown'}
- Service Interest: ${lead.service || 'unknown'}
- Challenge/Problem: ${lead.challenge || 'unknown'}
- Competitor: ${lead.competitor || 'unknown'}
- Past Experience: ${lead.pastExperience || 'unknown'}
- Goals: ${lead.goals || 'unknown'}
- Budget: ${lead.budget || 'unknown'}
- Timeline: ${lead.timeline || 'unknown'}
- Event: ${lead.eventName || 'unknown'}
- Person to Connect: ${lead.personToConnect || 'unknown'}
- Job Role: ${lead.jobRole || 'unknown'}
- Years Experience: ${lead.experience || 'unknown'}
- Assessment Answers: ${assessmentStr}
- Resume: ${lead.resumeLink ? 'uploaded' : 'not uploaded'}`;

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
