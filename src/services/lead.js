const Lead = require('../models/Lead');
const aiService = require('./ai');

class LeadService {
  async getOrCreateLead(phoneNumber) {
    let lead = await Lead.findOne({ phoneNumber });

    if (!lead) {
      lead = new Lead({
        phoneNumber,
        flowState: 'greeting',
        conversationHistory: []
      });
      await lead.save();
    }

    return lead;
  }

  async processMessage(lead, messageText, messageType) {
    // Add user message to conversation history
    lead.conversationHistory.push({
      role: 'user',
      content: messageText,
      timestamp: new Date()
    });

    // Extract any lead information from the message
    const extractedInfo = await aiService.extractLeadInfo(messageText, {
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      interest: lead.interest,
      budget: lead.budget,
      timeline: lead.timeline
    });

    // Update lead with extracted information
    if (extractedInfo.name) lead.name = extractedInfo.name;
    if (extractedInfo.email) lead.email = extractedInfo.email;
    if (extractedInfo.phone) lead.phone = extractedInfo.phone;
    if (extractedInfo.interest) lead.interest = extractedInfo.interest;
    if (extractedInfo.budget) lead.budget = extractedInfo.budget;
    if (extractedInfo.timeline) lead.timeline = extractedInfo.timeline;

    // Update flow state based on collected data
    lead.flowState = this.determineFlowState(lead);

    // Generate AI response
    const response = await aiService.generateResponse(
      lead.conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      messageText,
      {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        interest: lead.interest,
        budget: lead.budget,
        timeline: lead.timeline,
        flowState: lead.flowState
      }
    );

    // Add assistant response to history
    lead.conversationHistory.push({
      role: 'assistant',
      content: response,
      timestamp: new Date()
    });

    lead.lastInteraction = new Date();
    await lead.save();

    return response;
  }

  determineFlowState(lead) {
    if (!lead.name) return 'collecting_name';
    if (!lead.email) return 'collecting_email';
    if (!lead.interest) return 'collecting_interest';
    if (!lead.budget) return 'collecting_budget';
    if (!lead.timeline) return 'collecting_timeline';
    return 'completed';
  }

  async getLeadStats() {
    const totalLeads = await Lead.countDocuments();
    const completedLeads = await Lead.countDocuments({ flowState: 'completed' });
    const todayLeads = await Lead.countDocuments({
      createdAt: { $gte: new Date().setHours(0, 0, 0, 0) }
    });

    return {
      total: totalLeads,
      completed: completedLeads,
      today: todayLeads,
      conversionRate: totalLeads > 0 ? ((completedLeads / totalLeads) * 100).toFixed(2) : 0
    };
  }

  async getAllLeads(filter = {}) {
    return Lead.find(filter).sort({ lastInteraction: -1 });
  }
}

module.exports = new LeadService();
