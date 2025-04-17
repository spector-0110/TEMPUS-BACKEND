const { PrismaClient } = require('@prisma/client');

let prismaInstance = null;

function getPrismaInstance() {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: ['query', 'error', 'warn'],
      // Configure database URL
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      }
      // Remove the invalid 'connection' property
      // Prisma manages connection pooling automatically
    });
  }
  return prismaInstance;
}

const prisma = getPrismaInstance();

// Test the connection
async function testConnection() {
  try {
    await prisma.$connect();
    console.log('Successfully connected to the database');
    return true;
  } catch (error) {
    console.error('Database connection error:', error);
    return false;
  }
}

// Cleanup function to be called when shutting down
async function disconnect() {
  if (prismaInstance) {
    // Add deallocate prepared statements before disconnecting
    try {
      await prisma.$executeRaw`DEALLOCATE ALL`;
    } catch (error) {
      console.warn('Warning: Failed to deallocate prepared statements:', error.message);
    }
    
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Termination signal received, shutting down...');
  await disconnect();
  process.exit(0);
});

module.exports = {
  prisma,
  testConnection,
  disconnect
};