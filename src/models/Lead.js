const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    default: null
  },
  email: {
    type: String,
    default: null
  },
  phone: {
    type: String,
    default: null
  },
  interest: {
    type: String,
    default: null
  },
  budget: {
    type: String,
    default: null
  },
  timeline: {
    type: String,
    default: null
  },
  flowState: {
    type: String,
    enum: ['greeting', 'collecting_name', 'collecting_email', 'collecting_interest', 'collecting_budget', 'collecting_timeline', 'completed'],
    default: 'greeting'
  },
  conversationHistory: [{
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true
    },
    content: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  source: {
    type: String,
    default: 'whatsapp'
  },
  tags: [{
    type: String
  }],
  notes: {
    type: String,
    default: null
  },
  lastInteraction: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
leadSchema.index({ createdAt: -1 });
leadSchema.index({ flowState: 1 });
leadSchema.index({ lastInteraction: -1 });

module.exports = mongoose.model('Lead', leadSchema);
