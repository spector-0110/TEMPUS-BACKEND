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
const patientRoutes = require('./src/routes/patient.routes');

const app = express();
const PORT = process.env.PORT || 8000;
// Service status types
const ServiceStatus = {
  HEALTHY: 'healthy',
  WARNING: 'warning',
  ERROR: 'error'
};

// Middleware
app.use(cors());
app.use(express.json());

// Health check with detailed service status
app.get('/health', async (req, res) => {
  try {
    const [redisHealth, rabbitmqHealth, dbHealth] = await Promise.all([
      redisService.checkHealth(),
      rabbitmqService.checkHealth(),
      testConnection()
    ]);

    const status = {
      status: ServiceStatus.HEALTHY,
      timestamp: new Date().toISOString(),
      services: {
        redis: {
          ...redisHealth,
          clusterMode: process.env.REDIS_CLUSTER_MODE === 'true',
          poolSize: process.env.REDIS_POOL_SIZE
        },
        rabbitmq: {
          ...rabbitmqHealth,
          clusterNodes: process.env.RABBITMQ_CLUSTER_NODES?.split(',').length || 1,
          poolSize: process.env.RABBITMQ_POOL_SIZE
        },
        database: dbHealth ? { status: ServiceStatus.HEALTHY } : { status: ServiceStatus.ERROR }
      }
    };

    // Determine overall system health
    if (redisHealth.status === ServiceStatus.ERROR || 
        rabbitmqHealth.status === ServiceStatus.ERROR || 
        !dbHealth) {
      status.status = ServiceStatus.ERROR;
    } else if (redisHealth.status === ServiceStatus.WARNING || 
               rabbitmqHealth.status === ServiceStatus.WARNING) {
      status.status = ServiceStatus.WARNING;
    }

    // Set appropriate HTTP status
    const httpStatus = status.status === ServiceStatus.ERROR ? 503 : 
                      status.status === ServiceStatus.WARNING ? 207 : 
                      200;

    res.status(httpStatus).json(status);
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      status: ServiceStatus.ERROR,
      message: 'Health check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Routes
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/patients', patientRoutes);

// Basic route
app.get('/', (req, res) => {
  res.send('Hello from Express!');
});

// Initialize connections with smarter retry logic
async function initializeServices(maxRetries = 5, timeout = 30000) {
  let retries = 0;
  const services = ['Redis', 'RabbitMQ', 'Database'];
  const serviceStatus = new Map();
  
  while (retries < maxRetries) {
    try {
      console.log(`Service initialization attempt ${retries + 1}/${maxRetries}`);

      const initPromises = [
        rabbitmqService.initialize().then(() => serviceStatus.set('RabbitMQ', true)),
        redisService.initialize().then(() => serviceStatus.set('Redis', true)),
        testConnection().then(success => serviceStatus.set('Database', success))
      ];

      // Add timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Service initialization timeout')), timeout);
      });

      await Promise.race([Promise.all(initPromises), timeoutPromise]);

      // Check if all services are initialized
      const failedServices = services.filter(service => !serviceStatus.get(service));
      
      if (failedServices.length === 0) {
        console.log('All services connected successfully');
        return true;
      } else {
        throw new Error(`Failed to initialize services: ${failedServices.join(', ')}`);
      }
    } catch (error) {
      retries++;
      console.error(`Service initialization attempt ${retries} failed:`, error);
      
      // Log which services failed
      services.forEach(service => {
        if (!serviceStatus.get(service)) {
          console.error(`- ${service} failed to initialize`);
        }
      });
      
      if (retries < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retries), 10000);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error('Failed to initialize services after max retries');
        throw error;
      }
    }
  }
}

// Enhanced graceful shutdown with timeout and status tracking
async function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  let isShutdownComplete = false;
  const shutdownTimeout = 30000; // 30 seconds

  // Create a detailed shutdown tracker
  const shutdownStatus = {
    http: false,
    redis: false,
    rabbitmq: false,
    database: false
  };

  // Set a timeout for shutdown
  const forceShutdown = setTimeout(() => {
    console.error('Could not close connections in time, forcing shutdown');
    console.error('Shutdown status:', shutdownStatus);
    process.exit(1);
  }, shutdownTimeout);

  try {
    // Stop accepting new connections first
    if (server) {
      console.log('Closing HTTP server...');
      await new Promise(resolve => server.close(resolve));
      shutdownStatus.http = true;
      console.log('HTTP server closed');
    }

    // Cleanup services in parallel with individual timeouts
    await Promise.all([
      // Cleanup Redis connections
      Promise.race([
        redisService.cleanup().then(() => {
          shutdownStatus.redis = true;
          console.log('Redis connections cleaned up');
        }),
        new Promise((_, reject) => setTimeout(() => reject('Redis cleanup timeout'), 10000))
      ]).catch(err => console.error('Redis cleanup failed:', err)),

      // Cleanup RabbitMQ connections
      Promise.race([
        (rabbitmqService.close ? rabbitmqService.close() : Promise.resolve()).then(() => {
          shutdownStatus.rabbitmq = true;
          console.log('RabbitMQ connections cleaned up');
        }),
        new Promise((_, reject) => setTimeout(() => reject('RabbitMQ cleanup timeout'), 10000))
      ]).catch(err => console.error('RabbitMQ cleanup failed:', err)),

      // Cleanup Database connections
      Promise.race([
        disconnect().then(() => {
          shutdownStatus.database = true;
          console.log('Database connections cleaned up');
        }),
        new Promise((_, reject) => setTimeout(() => reject('Database cleanup timeout'), 10000))
      ]).catch(err => console.error('Database cleanup failed:', err))
    ]);

    console.log('All services cleaned up');
    isShutdownComplete = true;
    clearTimeout(forceShutdown);
    
    // Log final shutdown status
    console.log('Final shutdown status:', shutdownStatus);
    
    // Exit with appropriate code
    const allServicesCleanedUp = Object.values(shutdownStatus).every(Boolean);
    process.exit(allServicesCleanedUp ? 0 : 1);
  } catch (error) {
    console.error('Error during shutdown:', error);
    console.error('Shutdown status:', shutdownStatus);
    if (!isShutdownComplete) {
      process.exit(1);
    }
  }
}

// Start server with enhanced error handling and monitoring
let server;
async function startServer() {
  try {
    await initializeServices();
    
    server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      
      // Log service configuration
      console.log('Service Configuration:', {
        redisClusterMode: process.env.REDIS_CLUSTER_MODE === 'true',
        redisPoolSize: process.env.REDIS_POOL_SIZE,
        rabbitMQNodes: process.env.RABBITMQ_CLUSTER_NODES?.split(',').length || 1,
        rabbitMQPoolSize: process.env.RABBITMQ_POOL_SIZE,
        environment: process.env.NODE_ENV
      });
    });

    // Enhanced error handling for the HTTP server
    server.on('error', (error) => {
      console.error('HTTP server error:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
      }
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

    // Start periodic health checks
    if (process.env.ENABLE_METRICS === 'true') {
      setInterval(async () => {
        try {
          const [redisHealth, rabbitmqHealth, dbHealth] = await Promise.all([
            redisService.checkHealth(),
            rabbitmqService.checkHealth(),
            testConnection()
          ]);

          console.log('Service Health Metrics:', {
            timestamp: new Date().toISOString(),
            redis: redisHealth.status,
            rabbitmq: rabbitmqHealth.status,
            database: dbHealth ? 'healthy' : 'error'
          });
        } catch (error) {
          console.error('Health check failed:', error);
        }
      }, 60000); // Check every minute
    }
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

startServer().catch(console.error);

