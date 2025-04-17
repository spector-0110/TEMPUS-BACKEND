const amqp = require('amqplib');

class RabbitMQClient {
  constructor() {
    this.connection = null;
    this.channel = null;
  }

  async connect() {
    try {
      this.connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
      this.channel = await this.connection.createChannel();
      console.log('RabbitMQ Connected');
    } catch (error) {
      console.error('RabbitMQ Connection Error:', error);
      throw error;
    }
  }

  async createQueue(queueName) {
    try {
      await this.channel.assertQueue(queueName, { durable: true });
    } catch (error) {
      console.error('Error creating queue:', error);
      throw error;
    }
  }

  async publishToQueue(queueName, data) {
    try {
      await this.channel.sendToQueue(queueName, Buffer.from(JSON.stringify(data)));
    } catch (error) {
      console.error('Error publishing to queue:', error);
      throw error;
    }
  }

  async consumeQueue(queueName, callback) {
    try {
      await this.channel.consume(queueName, (data) => {
        callback(JSON.parse(data.content));
        this.channel.ack(data);
      });
    } catch (error) {
      console.error('Error consuming queue:', error);
      throw error;
    }
  }
}

module.exports = new RabbitMQClient();