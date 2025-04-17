require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const redis = require('./src/config/redis.config');
const rabbitmq = require('./src/config/rabbitmq.config');
const supabase = require('./src/config/supabase.config');
const { testConnection } = require('./src/services/database.service');
const subscriptionRoutes = require('./src/routes/subscription.routes');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Import routes

// Routes
app.use('/api/subscriptions', subscriptionRoutes);

// Basic route
app.get('/', (req, res) => {
  res.send('Hello from Express!');
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Initialize connections
async function initializeServices() {
  try {
    // Connect to RabbitMQ
    await rabbitmq.connect();
    
    // Test Redis connection
    await redis.ping();
    
    // Test Prisma connection
    await prisma.$connect();
    
    console.log('All services connected successfully');
  } catch (error) {
    console.error('Error initializing services:', error);
    process.exit(1);
  }
}

// Start server
async function startServer() {
  try {
    // Test database connection
    const isConnected = await testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to the database');
    }

    await initializeServices();
    
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

startServer().catch(console.error);

