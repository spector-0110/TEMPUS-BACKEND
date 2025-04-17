const amqp = require('amqplib');

let connection = null;
let channel = null;

async function connect() {
  try {
    connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
    channel = await connection.createChannel();
    console.log('RabbitMQ Connected');
  } catch (error) {
    console.error('RabbitMQ Connection Error:', error);
    throw error;
  }
}

module.exports = {
  connect,
  getChannel: () => channel,
  getConnection: () => connection
};