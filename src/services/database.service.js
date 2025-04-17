const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['query', 'error', 'warn'],  // Enable logging for debugging
});

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

module.exports = {
  prisma,
  testConnection,
};