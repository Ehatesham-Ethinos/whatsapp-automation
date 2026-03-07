require('dotenv').config();
const express = require('express');
const webhookRoutes = require('./routes/webhook');
const connectDB = require('./utils/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Connect to database
connectDB();

// Routes
app.use('/webhook', webhookRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'WhatsApp Lead Bot is running!' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
