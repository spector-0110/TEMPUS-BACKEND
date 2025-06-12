#!/usr/bin/env node

/**
 * RabbitMQ Queue Fix Tool
 * 
 * This script deletes and recreates RabbitMQ queues that have conflicting arguments.
 * Run this when you get PRECONDITION_FAILED errors due to queue argument mismatches.
 */

const amqp = require('amqplib');
require('dotenv').config();

const QUEUE_NAMES = [
  'appointments.created',
  'appointments.updated', 
  'appointments.notification'
];

async function fixRabbitMQQueues() {
  let connection = null;
  let channel = null;

  try {
    console.log('🔄 Connecting to RabbitMQ...');
    connection = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await connection.createChannel();

    console.log('✅ Connected to RabbitMQ successfully');

    // Delete problematic queues and their dead letter queues
    for (const queueName of QUEUE_NAMES) {
      const dlqName = `${queueName}.dlq`;
      const dlxName = `${queueName}.dlx`;

      try {
        // Delete main queue
        console.log(`🗑️  Deleting queue: ${queueName}`);
        await channel.deleteQueue(queueName);
        console.log(`✅ Deleted queue: ${queueName}`);
      } catch (error) {
        if (error.message.includes('NOT_FOUND')) {
          console.log(`ℹ️  Queue ${queueName} doesn't exist, skipping`);
        } else {
          console.log(`⚠️  Error deleting queue ${queueName}:`, error.message);
        }
      }

      try {
        // Delete dead letter queue
        console.log(`🗑️  Deleting dead letter queue: ${dlqName}`);
        await channel.deleteQueue(dlqName);
        console.log(`✅ Deleted dead letter queue: ${dlqName}`);
      } catch (error) {
        if (error.message.includes('NOT_FOUND')) {
          console.log(`ℹ️  Dead letter queue ${dlqName} doesn't exist, skipping`);
        } else {
          console.log(`⚠️  Error deleting dead letter queue ${dlqName}:`, error.message);
        }
      }

      try {
        // Delete dead letter exchange
        console.log(`🗑️  Deleting dead letter exchange: ${dlxName}`);
        await channel.deleteExchange(dlxName);
        console.log(`✅ Deleted dead letter exchange: ${dlxName}`);
      } catch (error) {
        if (error.message.includes('NOT_FOUND')) {
          console.log(`ℹ️  Dead letter exchange ${dlxName} doesn't exist, skipping`);
        } else {
          console.log(`⚠️  Error deleting dead letter exchange ${dlxName}:`, error.message);
        }
      }
    }

    console.log('\n🎉 Queue cleanup completed successfully!');
    console.log('📝 The application will recreate these queues with correct arguments when it starts.');
    
  } catch (error) {
    console.error('❌ Error fixing RabbitMQ queues:', error);
    process.exit(1);
  } finally {
    if (channel) {
      try {
        await channel.close();
      } catch (error) {
        console.warn('Warning: Error closing channel:', error.message);
      }
    }
    if (connection) {
      try {
        await connection.close();
      } catch (error) {
        console.warn('Warning: Error closing connection:', error.message);
      }
    }
  }
}

// Also add utility functions for individual queue management
async function deleteSpecificQueue(queueName) {
  let connection = null;
  let channel = null;

  try {
    console.log(`🔄 Connecting to RabbitMQ to delete queue: ${queueName}`);
    connection = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await connection.createChannel();

    await channel.deleteQueue(queueName);
    console.log(`✅ Successfully deleted queue: ${queueName}`);
    
  } catch (error) {
    if (error.message.includes('NOT_FOUND')) {
      console.log(`ℹ️  Queue ${queueName} doesn't exist`);
    } else {
      console.error(`❌ Error deleting queue ${queueName}:`, error);
    }
  } finally {
    if (channel) await channel.close();
    if (connection) await connection.close();
  }
}

async function listQueues() {
  let connection = null;
  let channel = null;

  try {
    console.log('🔄 Connecting to RabbitMQ to list queues...');
    connection = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await connection.createChannel();

    console.log('📋 Checking queue status:');
    
    for (const queueName of QUEUE_NAMES) {
      // Create a new channel for each queue check to avoid channel closure issues
      let checkChannel = null;
      try {
        checkChannel = await connection.createChannel();
        const queueInfo = await checkChannel.checkQueue(queueName);
        console.log(`✅ ${queueName}: ${queueInfo.messageCount} messages, ${queueInfo.consumerCount} consumers`);
      } catch (error) {
        if (error.message.includes('NOT_FOUND') || error.code === 404) {
          console.log(`❌ ${queueName}: Queue does not exist`);
        } else {
          console.log(`⚠️  ${queueName}: Error checking queue - ${error.message}`);
        }
      } finally {
        if (checkChannel) {
          try {
            await checkChannel.close();
          } catch (e) {
            // Ignore close errors
          }
        }
      }

      // Check dead letter queue
      const dlqName = `${queueName}.dlq`;
      let dlqCheckChannel = null;
      try {
        dlqCheckChannel = await connection.createChannel();
        const dlqInfo = await dlqCheckChannel.checkQueue(dlqName);
        console.log(`✅ ${dlqName}: ${dlqInfo.messageCount} messages, ${dlqInfo.consumerCount} consumers`);
      } catch (error) {
        if (error.message.includes('NOT_FOUND') || error.code === 404) {
          console.log(`❌ ${dlqName}: Dead letter queue does not exist`);
        } else {
          console.log(`⚠️  ${dlqName}: Error checking dead letter queue - ${error.message}`);
        }
      } finally {
        if (dlqCheckChannel) {
          try {
            await dlqCheckChannel.close();
          } catch (e) {
            // Ignore close errors
          }
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error listing queues:', error);
  } finally {
    if (channel) {
      try {
        await channel.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    if (connection) {
      try {
        await connection.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'fix':
      fixRabbitMQQueues();
      break;
    case 'list':
      listQueues();
      break;
    case 'delete':
      const queueToDelete = process.argv[3];
      if (!queueToDelete) {
        console.error('❌ Please specify queue name to delete');
        console.log('Usage: node fix-rabbitmq-queues.js delete <queue-name>');
        process.exit(1);
      }
      deleteSpecificQueue(queueToDelete);
      break;
    default:
      console.log('🛠️  RabbitMQ Queue Management Tool');
      console.log('');
      console.log('Usage:');
      console.log('  node fix-rabbitmq-queues.js fix     - Delete and recreate all appointment queues');
      console.log('  node fix-rabbitmq-queues.js list    - List current status of queues');
      console.log('  node fix-rabbitmq-queues.js delete <queue-name> - Delete specific queue');
      console.log('');
      console.log('Examples:');
      console.log('  node fix-rabbitmq-queues.js fix');
      console.log('  node fix-rabbitmq-queues.js list');
      console.log('  node fix-rabbitmq-queues.js delete appointments.created.dlq');
  }
}

module.exports = {
  fixRabbitMQQueues,
  deleteSpecificQueue,
  listQueues
};
