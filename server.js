require('dotenv').config();
const express = require('express');
const cors = require('cors');
const redis = require('./src/config/redis.config');
const rabbitmq = require('./src/config/rabbitmq.config');
const supabase = require('./src/config/supabase.config');
const { testConnection, disconnect } = require('./src/services/database.service');
const messageProcessor = require('./src/queue/messageProcessor');
const subscriptionRoutes = require('./src/routes/subscription.routes');
const hospitalRoutes = require('./src/routes/hospital.routes');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/hospitals', hospitalRoutes);

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
    
    // Initialize message processor
    await messageProcessor.initialize();
    
    // Test Redis connection
    await redis.ping();
    
    // Test database connection
    await testConnection();
    
    console.log('All services connected successfully');
  } catch (error) {
    console.error('Error initializing services:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down gracefully...');
  try {
    // Disconnect database
    await disconnect();
    
    // Close RabbitMQ connection
    const rabbitmqConnection = rabbitmq.getConnection();
    if (rabbitmqConnection) {
      await rabbitmqConnection.close();
      console.log('RabbitMQ connection closed');
    }
    
    // Close server
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });

    // Force close after 5s
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 5000);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Start server
let server;
async function startServer() {
  try {
    await initializeServices();
    
    server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

startServer().catch(console.error);

