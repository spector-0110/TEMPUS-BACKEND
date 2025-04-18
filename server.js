require('dotenv').config();
const express = require('express');
const cors = require('cors');
const redisService = require('./src/services/redis.service');
const rabbitmqService = require('./src/services/rabbitmq.service');
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

// Health check route with detailed status
app.get('/health', async (req, res) => {
  try {
    const [redisHealth, rabbitmqHealth, dbHealth] = await Promise.all([
      redisService.checkHealth(),
      rabbitmqService.checkHealth(),
      testConnection()
    ]);

    const status = {
      status: 'healthy',
      redis: redisHealth,
      rabbitmq: rabbitmqHealth,
      database: dbHealth ? { status: 'healthy' } : { status: 'error' },
      timestamp: new Date().toISOString()
    };

    // If any service is unhealthy, mark overall status as unhealthy
    if (redisHealth.status === 'error' || 
        rabbitmqHealth.status === 'error' || 
        !dbHealth) {
      status.status = 'error';
    } else if (redisHealth.status === 'warning' || 
               rabbitmqHealth.status === 'warning') {
      status.status = 'warning';
    }

    res.json(status);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Routes
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/hospitals', hospitalRoutes);

// Basic route
app.get('/', (req, res) => {
  res.send('Hello from Express!');
});

// Initialize connections with timeout and retry
async function initializeServices(maxRetries = 5, timeout = 30000) {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      const initPromise = Promise.all([
        rabbitmqService.initialize(),
        messageProcessor.initialize(),
        redisService.initialize(),
        testConnection()
      ]);

      // Add timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Service initialization timeout')), timeout);
      });

      await Promise.race([initPromise, timeoutPromise]);
      console.log('All services connected successfully');
      return true;
    } catch (error) {
      retries++;
      console.error(`Service initialization attempt ${retries} failed:`, error);
      
      if (retries < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retries), 10000); // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error('Failed to initialize services after max retries');
        throw error;
      }
    }
  }
}

// Graceful shutdown with timeout
async function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  let isShutdownComplete = false;

  // Set a timeout for shutdown
  const forceShutdown = setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000); // 30 second timeout

  try {
    // Stop accepting new connections
    if (server) {
      console.log('Closing HTTP server...');
      await new Promise(resolve => server.close(resolve));
      console.log('HTTP server closed');
    }

    // Cleanup services
    console.log('Cleaning up services...');
    await Promise.all([
      // Disconnect database
      disconnect(),
      // Cleanup Redis connections
      redisService.cleanup(),
      // Close RabbitMQ connections
      rabbitmqService.cleanup ? rabbitmqService.cleanup() : Promise.resolve()
    ]);

    console.log('All services cleaned up');
    isShutdownComplete = true;
    clearTimeout(forceShutdown);
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    if (!isShutdownComplete) {
      process.exit(1);
    }
  }
}

// Start server with proper error handling
let server;
async function startServer() {
  try {
    await initializeServices();
    
    server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    // Handle various shutdown signals
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2']; // SIGUSR2 for nodemon restart
    signals.forEach(signal => {
      process.on(signal, () => shutdown(signal));
    });

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      shutdown('unhandledRejection');
    });
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

startServer().catch(console.error);

