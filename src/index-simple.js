require('dotenv').config();
const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');
const nodemailer = require('nodemailer');
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
  totalExperience: DataTypes.STRING,
  relevantExperience: DataTypes.STRING,
  currentCTC: DataTypes.STRING,
  expectedCTC: DataTypes.STRING,
  noticePeriod: DataTypes.STRING,
  assessmentQA: { type: DataTypes.JSON, defaultValue: [] }, // [{q: "question", a: "answer"}]
  resumeLink: DataTypes.STRING,
  resumeFileName: DataTypes.STRING,
  resumeMediaId: DataTypes.STRING,
  attachments: { type: DataTypes.JSON, defaultValue: [] }, // Array of {mediaId, fileName, mimeType, localPath}
  notes: DataTypes.TEXT,
  status: { type: DataTypes.STRING, defaultValue: 'new' }, // new, in_progress, completed, contacted
  conversationHistory: { type: DataTypes.JSON, defaultValue: [] },
  emailSent: { type: DataTypes.BOOLEAN, defaultValue: false },
  emailSentAt: DataTypes.DATE
}, {
  tableName: 'leads',
  timestamps: true
});

// Email Log Model
const EmailLog = sequelize.define('EmailLog', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  leadId: { type: DataTypes.UUID, allowNull: false },
  toEmail: DataTypes.STRING,
  ccEmail: DataTypes.STRING,
  subject: DataTypes.STRING,
  inquiryType: DataTypes.STRING,
  status: { type: DataTypes.STRING, defaultValue: 'sent' }, // sent, failed
  errorMessage: DataTypes.TEXT,
  sentAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'email_logs',
  timestamps: true
});

// Sync database (alter: true adds new columns without dropping data)
sequelize.sync({ alter: true }).then(() => {
  console.log('PostgreSQL connected & synced');
}).catch(err => {
  console.error('Database error:', err);
});

// Email Configuration
const EMAIL_RECIPIENTS = {
  job: 'sakshi.bichave@ethinos.com',
  service: 'siddharth.hegde@ethinos.com',
  networking: 'siddharth.hegde@ethinos.com',
  event: 'siddharth.hegde@ethinos.com',
  general: 'siddharth.hegde@ethinos.com'
};
const EMAIL_CC = 'benedict.hayes@ethinos.com, ehatesham.huseni@ethinos.com';

// Create email transporter
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-mail.outlook.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
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
4. "Who's your biggest competitor? (I'm curious)"
5. "What have you tried so far? Any past agency experience?"
6. "What does winning look like for you? Any specific goals or numbers?"
7. "Ballpark budget range? (helps us recommend the right approach)"
8. "How soon are you looking to kick things off?"
9. "What's your email? I'll have someone reach out with ideas"

Keep it natural - don't fire all questions at once. React to their answers!

═══════════════════════════════════════
💼 JOB INQUIRY FLOW (Complete Assessment)
═══════════════════════════════════════
Follow this EXACT order. Ask ONE question at a time:

STEP 1 - Basic Info:
1. "Awesome, we're always scouting talent! What role are you looking for?"
2. "How many years of total experience do you have?"
3. "And how many years specifically in [their role]?" (relevant experience)

STEP 2 - HR Questions:
4. "What's your current CTC? (annual package)"
5. "And what's your expected CTC?"
6. "What's your notice period? Can you negotiate it?"

STEP 3 - Quick Skill Assessment (1-2 questions based on role):

For SOCIAL MEDIA:
- "Quick one: A brand's Instagram engagement dropped 40%. First thing you'd check?"

For SEO:
- "Site traffic dropped after a Google update. What's your first move?"

For PPC/PAID ADS:
- "CPL is too high on a lead gen campaign. What do you optimize first?"

For CONTENT:
- "How do you make a boring B2B topic interesting?"

For DESIGN:
- "What makes a scroll-stopping creative?"

For OTHER roles:
- "What's a marketing campaign you've seen recently that impressed you?"

STEP 4 - Final:
7. "Nice! Drop your resume here (PDF/DOC works)"
8. "And your email so HR can reach you?"
9. "You're all set! Our team will review and get back to you soon."

═══════════════════════════════════════
🤝 NETWORKING FLOW
═══════════════════════════════════════
1. "Sure! Who are you trying to reach?"
2. "What's this regarding? (Just so I can give them context)"
3. "Your name and company?"
4. "Best email to connect you on?"
5. "Got it! I'll pass this along - expect a ping soon"

═══════════════════════════════════════
🎪 EVENT CONTACT FLOW
═══════════════════════════════════════
1. "Oh nice! Which event did we cross paths at?"
2. "What caught your interest - our services or career stuff?"
3. Then flow into SERVICE or JOB flow based on answer
4. Get: name, email, company
5. "Great meeting you! Someone from our team will follow up"

═══════════════════════════════════════
TONE & STYLE
═══════════════════════════════════════
- Sound human, not corporate
- Short punchy messages (2-3 lines max)
- Use casual language: "Nice!", "Got it", "Cool", "Awesome"
- ONE question at a time - NEVER ask multiple questions
- React to their answers before asking next question
- No "I'd be happy to help" or "Could you please share"

ABOUT ETHINOS:
- Full-stack digital marketing agency
- SEO, Social, Paid Ads, Content, Web Dev, Branding
- Based in India, working with global brands

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
  "totalExperience": "total years of experience or null",
  "relevantExperience": "years in specific role or null",
  "currentCTC": "current salary/package or null",
  "expectedCTC": "expected salary/package or null",
  "noticePeriod": "notice period or null",
  "assessmentQA": [{"q": "question asked", "a": "their answer"}],
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
    if (leadData.totalExperience) updates.totalExperience = leadData.totalExperience;
    if (leadData.relevantExperience) updates.relevantExperience = leadData.relevantExperience;
    if (leadData.currentCTC) updates.currentCTC = leadData.currentCTC;
    if (leadData.expectedCTC) updates.expectedCTC = leadData.expectedCTC;
    if (leadData.noticePeriod) updates.noticePeriod = leadData.noticePeriod;
    if (leadData.assessmentQA && leadData.assessmentQA.length > 0) {
      const existing = lead.assessmentQA || [];
      updates.assessmentQA = [...existing, ...leadData.assessmentQA];
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

    // Send email notification when lead is completed (and not already sent)
    if (isComplete && !lead.emailSent) {
      const refreshedLead = await Lead.findByPk(lead.id);
      sendLeadNotificationEmail(refreshedLead).catch(err => {
        console.error('Email send error:', err);
      });
    }

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
    const assessmentStr = lead.assessmentQA?.length
      ? lead.assessmentQA.map((qa, i) => `Q${i+1}: ${qa.q} -> A: ${qa.a}`).join(' | ')
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
- Total Experience: ${lead.totalExperience || 'unknown'}
- Relevant Experience: ${lead.relevantExperience || 'unknown'}
- Current CTC: ${lead.currentCTC || 'unknown'}
- Expected CTC: ${lead.expectedCTC || 'unknown'}
- Notice Period: ${lead.noticePeriod || 'unknown'}
- Assessment Q&A: ${assessmentStr}
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

// Send email notification to team head
async function sendLeadNotificationEmail(lead) {
  try {
    const type = lead.inquiryType || 'general';
    const toEmail = EMAIL_RECIPIENTS[type] || EMAIL_RECIPIENTS.general;

    // Build conversation HTML
    const conversationHtml = (lead.conversationHistory || []).map(msg => {
      const isUser = msg.role === 'user';
      return `
        <div style="margin: 10px 0; padding: 10px; background: ${isUser ? '#DCF8C6' : '#E8E8E8'}; border-radius: 8px; max-width: 80%; ${isUser ? 'margin-left: auto;' : ''}">
          <strong>${isUser ? (lead.name || lead.whatsappName || 'User') : 'Ethinos Bot'}:</strong><br>
          ${msg.content}
          <div style="font-size: 11px; color: #666; margin-top: 5px;">${new Date(msg.timestamp).toLocaleString()}</div>
        </div>
      `;
    }).join('');

    // Build details section based on inquiry type
    let detailsHtml = `
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Name</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.name || lead.whatsappName || '-'}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Phone</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.phoneNumber}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Email</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.email || '-'}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Company</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.company || '-'}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Designation</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.designation || '-'}</td></tr>
    `;

    if (type === 'job') {
      detailsHtml += `
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Job Role</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.jobRole || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Total Experience</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.totalExperience || lead.experience || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Relevant Experience</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.relevantExperience || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Current CTC</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.currentCTC || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Expected CTC</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.expectedCTC || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Notice Period</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.noticePeriod || '-'}</td></tr>
      `;

      // Add assessment Q&A
      if (lead.assessmentQA && lead.assessmentQA.length > 0) {
        const qaHtml = lead.assessmentQA.map((qa, i) => `<p><strong>Q${i+1}:</strong> ${qa.q}<br><strong>A:</strong> ${qa.a}</p>`).join('');
        detailsHtml += `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Skill Assessment</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${qaHtml}</td></tr>`;
      }
    } else if (type === 'service') {
      detailsHtml += `
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Website</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.website || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Service Interest</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.service || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Challenge</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.challenge || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Competitor</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.competitor || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Past Experience</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.pastExperience || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Goals</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.goals || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Budget</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.budget || '-'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Timeline</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.timeline || '-'}</td></tr>
      `;
    } else if (type === 'networking') {
      detailsHtml += `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Person to Connect</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.personToConnect || '-'}</td></tr>`;
    } else if (type === 'event') {
      detailsHtml += `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Event Name</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.eventName || '-'}</td></tr>`;
    }

    if (lead.notes) {
      detailsHtml += `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Notes</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${lead.notes}</td></tr>`;
    }

    // Email subject
    const subjectMap = {
      job: `New Job Application: ${lead.jobRole || 'General'} - ${lead.name || lead.whatsappName}`,
      service: `New Service Inquiry: ${lead.company || lead.name || lead.whatsappName}`,
      networking: `Networking Request: ${lead.name || lead.whatsappName}`,
      event: `Event Contact: ${lead.eventName || 'Unknown'} - ${lead.name || lead.whatsappName}`,
      general: `New WhatsApp Inquiry: ${lead.name || lead.whatsappName}`
    };
    const subject = subjectMap[type] || subjectMap.general;

    // Email HTML body
    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #25D366, #128C7E); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">New ${type.charAt(0).toUpperCase() + type.slice(1)} Inquiry</h2>
          <p style="margin: 5px 0 0 0; opacity: 0.9;">Via WhatsApp Bot - ${new Date().toLocaleString()}</p>
        </div>

        <div style="border: 1px solid #ddd; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
          <h3 style="color: #333; border-bottom: 2px solid #25D366; padding-bottom: 10px;">Lead Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            ${detailsHtml}
          </table>

          <h3 style="color: #333; border-bottom: 2px solid #25D366; padding-bottom: 10px; margin-top: 30px;">Conversation History</h3>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; max-height: 500px; overflow-y: auto;">
            ${conversationHtml || '<p style="color: #666;">No conversation recorded</p>'}
          </div>

          <div style="margin-top: 20px; padding: 15px; background: #e8f5e9; border-radius: 8px;">
            <p style="margin: 0; color: #2e7d32;">
              <strong>Quick Actions:</strong> Reply to the candidate at <a href="mailto:${lead.email}">${lead.email}</a>
              or call <a href="tel:${lead.phoneNumber}">${lead.phoneNumber}</a>
            </p>
          </div>
        </div>

        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
          This is an automated notification from Ethinos WhatsApp Lead Bot
        </p>
      </body>
      </html>
    `;

    // Prepare attachments - download from WhatsApp if mediaId exists
    const emailAttachments = [];
    if (lead.attachments && lead.attachments.length > 0) {
      for (const att of lead.attachments) {
        try {
          // First try local file
          const localFilePath = path.join(uploadsDir, path.basename(att.localPath || ''));
          if (att.localPath && fs.existsSync(localFilePath)) {
            emailAttachments.push({
              filename: att.fileName || 'attachment',
              path: localFilePath
            });
          }
          // If local file doesn't exist but we have mediaId, download from WhatsApp
          else if (att.mediaId) {
            console.log(`Downloading attachment ${att.mediaId} from WhatsApp...`);
            const mediaInfoUrl = `${WHATSAPP_API_URL}/${att.mediaId}`;
            const mediaInfoRes = await axios.get(mediaInfoUrl, {
              headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
            });

            const mediaUrl = mediaInfoRes.data.url;
            const fileRes = await axios.get(mediaUrl, {
              headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
              responseType: 'arraybuffer'
            });

            emailAttachments.push({
              filename: att.fileName || 'attachment',
              content: Buffer.from(fileRes.data)
            });
            console.log(`Attachment ${att.fileName} downloaded successfully`);
          }
        } catch (attError) {
          console.error(`Failed to attach ${att.fileName}:`, attError.message);
        }
      }
    }

    // Send email
    const mailOptions = {
      from: `"${process.env.SMTP_FROM_NAME || 'Ethinos Notifications'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: toEmail,
      cc: EMAIL_CC,
      subject: subject,
      html: htmlBody,
      attachments: emailAttachments
    };

    await emailTransporter.sendMail(mailOptions);

    // Log email
    await EmailLog.create({
      leadId: lead.id,
      toEmail: toEmail,
      ccEmail: EMAIL_CC,
      subject: subject,
      inquiryType: type,
      status: 'sent'
    });

    // Update lead
    await lead.update({ emailSent: true, emailSentAt: new Date() });

    console.log(`Email sent for lead ${lead.id} to ${toEmail}`);
    return true;

  } catch (error) {
    console.error('Email send error:', error);

    // Log failed email
    await EmailLog.create({
      leadId: lead.id,
      toEmail: EMAIL_RECIPIENTS[lead.inquiryType] || EMAIL_RECIPIENTS.general,
      ccEmail: EMAIL_CC,
      subject: `Lead notification - ${lead.name || lead.phoneNumber}`,
      inquiryType: lead.inquiryType || 'general',
      status: 'failed',
      errorMessage: error.message
    });

    return false;
  }
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

// Get email logs for a lead
app.get('/api/leads/:id/emails', basicAuth, async (req, res) => {
  try {
    const emails = await EmailLog.findAll({
      where: { leadId: req.params.id },
      order: [['sentAt', 'DESC']]
    });
    res.json(emails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resend email for a lead
app.post('/api/leads/:id/resend-email', basicAuth, async (req, res) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Reset email sent flag and resend
    await lead.update({ emailSent: false });
    const success = await sendLeadNotificationEmail(lead);

    if (success) {
      res.json({ success: true, message: 'Email sent successfully' });
    } else {
      res.status(500).json({ error: 'Failed to send email' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all email logs
app.get('/api/email-logs', basicAuth, async (req, res) => {
  try {
    const logs = await EmailLog.findAll({
      order: [['sentAt', 'DESC']],
      limit: 100
    });
    res.json(logs);
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
