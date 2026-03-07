const OpenAI = require('openai');

class AIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    this.systemPrompt = `You are a friendly and professional lead generation assistant for a business.
Your goal is to collect the following information from users in a conversational manner:
1. Full Name
2. Email Address
3. Phone Number (if different from WhatsApp)
4. Interest/Service they're looking for
5. Budget range (if applicable)
6. Timeline/Urgency

Guidelines:
- Be conversational and friendly, not robotic
- Ask one question at a time
- Validate responses when appropriate (e.g., email format)
- If the user asks questions about the business, answer helpfully
- Keep responses concise (max 2-3 sentences)
- Use the user's name once you know it
- At the end, confirm all collected information

Respond in a natural, conversational tone.`;
  }

  async generateResponse(conversationHistory, currentMessage, leadData) {
    try {
      const messages = [
        { role: 'system', content: this.systemPrompt },
        {
          role: 'system',
          content: `Current lead data collected: ${JSON.stringify(leadData)}.
                    Use this to know what information is still needed.`
        },
        ...conversationHistory,
        { role: 'user', content: currentMessage }
      ];

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
        max_tokens: 200,
        temperature: 0.7
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('AI Service Error:', error);
      return "I apologize, but I'm having some technical difficulties. Could you please try again in a moment?";
    }
  }

  async extractLeadInfo(message, existingData) {
    try {
      const extractionPrompt = `Analyze this message and extract any lead information.
Current collected data: ${JSON.stringify(existingData)}

Message: "${message}"

Extract and return JSON with any NEW information found:
{
  "name": "extracted name or null",
  "email": "extracted email or null",
  "phone": "extracted phone or null",
  "interest": "extracted interest/service or null",
  "budget": "extracted budget or null",
  "timeline": "extracted timeline or null"
}

Only include fields that have new, valid information. Return null for fields not found.`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: extractionPrompt }],
        max_tokens: 200,
        temperature: 0
      });

      const responseText = completion.choices[0].message.content;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return {};
    } catch (error) {
      console.error('AI Extraction Error:', error);
      return {};
    }
  }
}

module.exports = new AIService();
