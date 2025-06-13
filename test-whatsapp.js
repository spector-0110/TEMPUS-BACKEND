#!/usr/bin/env node

/**
 * Twilio WhatsApp Integration Test Script
 * Run this script to test your Twilio WhatsApp integration
 * 
 * Usage: node test-whatsapp.js [phone_number]
 * Example: node test-whatsapp.js +1234567890
 */

require('dotenv').config();
const whatsappService = require('./src/services/whatsapp.service');

// Test phone number - replace with your own for testing
const TEST_PHONE_NUMBER = process.argv[2] || '+1234567890';

async function testWhatsAppIntegration() {
  console.log('🚀 Testing Twilio WhatsApp Integration...\n');
  
  console.log('Configuration:');
  console.log(`Account SID: ${process.env.TWILIO_ACCOUNT_SID || 'ACbd7626bd815609f5a666805c681fc8cd'}`);
  console.log(`WhatsApp Number: ${process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886'}`);
  console.log(`Test Phone: ${TEST_PHONE_NUMBER}\n`);

  const tests = [
    {
      name: 'Send Simple Message',
      test: () => whatsappService.sendMessage(
        TEST_PHONE_NUMBER,
        '🧪 Test Message: Twilio WhatsApp integration is working!'
      )
    },
    {
      name: 'Send Appointment Reminder',
      test: () => whatsappService.sendAppointmentReminder(
        TEST_PHONE_NUMBER,
        {
          doctorName: 'Dr. Test Smith',
          appointmentTime: 'Tomorrow at 10:00 AM',
          hospitalName: 'Test Hospital',
          appointmentId: 'TEST-001'
        }
      )
    },
    {
      name: 'Send OTP',
      test: () => whatsappService.sendOTP(
        TEST_PHONE_NUMBER,
        '123456',
        5
      )
    }
  ];

  const results = [];
  
  for (const test of tests) {
    try {
      console.log(`🧪 Testing: ${test.name}...`);
      const result = await test.test();
      
      if (result.success) {
        console.log(`✅ ${test.name}: SUCCESS`);
        console.log(`   Message SID: ${result.messageSid}`);
        console.log(`   Status: ${result.status}\n`);
        results.push({ name: test.name, success: true, messageSid: result.messageSid });
      } else {
        console.log(`❌ ${test.name}: FAILED`);
        console.log(`   Error: ${result.error}\n`);
        results.push({ name: test.name, success: false, error: result.error });
      }
      
      // Wait 2 seconds between tests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.log(`❌ ${test.name}: ERROR`);
      console.log(`   Error: ${error.message}\n`);
      results.push({ name: test.name, success: false, error: error.message });
    }
  }

  // Test message status for successful sends
  console.log('📊 Checking message statuses...\n');
  for (const result of results) {
    if (result.success && result.messageSid) {
      try {
        const status = await whatsappService.getMessageStatus(result.messageSid);
        console.log(`📱 ${result.name} Status: ${status.status || 'Unknown'}`);
      } catch (error) {
        console.log(`⚠️  Could not get status for ${result.name}: ${error.message}`);
      }
    }
  }

  // Summary
  console.log('\n📋 Test Summary:');
  const successful = results.filter(r => r.success).length;
  const total = results.length;
  
  console.log(`✅ Successful: ${successful}/${total}`);
  console.log(`❌ Failed: ${total - successful}/${total}`);
  
  if (successful === total) {
    console.log('\n🎉 All tests passed! Twilio WhatsApp integration is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Please check your configuration and try again.');
  }

  // Check message history
  try {
    console.log('\n📜 Recent message history:');
    const history = await whatsappService.getMessageHistory(TEST_PHONE_NUMBER, 3);
    if (history.length > 0) {
      history.forEach((msg, index) => {
        console.log(`${index + 1}. ${msg.direction}: ${msg.body?.substring(0, 50) || 'Media message'}... (${msg.status})`);
      });
    } else {
      console.log('No message history found.');
    }
  } catch (error) {
    console.log(`Could not retrieve message history: ${error.message}`);
  }

  process.exit(successful === total ? 0 : 1);
}

async function testConfiguration() {
  console.log('🔧 Testing Twilio Configuration...\n');
  
  const requiredEnvVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN'
  ];

  const missingVars = requiredEnvVars.filter(varName => 
    !process.env[varName] && 
    !['ACbd7626bd815609f5a666805c681fc8cd', '68ac82158a349f8b84a2ede7fc4833f4'].includes(process.env[varName])
  );

  if (missingVars.length > 0) {
    console.log('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.log(`   - ${varName}`));
    console.log('\nPlease set these in your .env file or as environment variables.\n');
    return false;
  }

  // Test Redis connection
  try {
    await whatsappService.redis.ping();
    console.log('✅ Redis connection: OK');
  } catch (error) {
    console.log(`⚠️  Redis connection failed: ${error.message}`);
    console.log('   WhatsApp service will work but rate limiting may not function properly.\n');
  }

  console.log('✅ Configuration looks good!\n');
  return true;
}

// Main execution
async function main() {
  console.log('='.repeat(60));
  console.log('           TWILIO WHATSAPP INTEGRATION TEST');
  console.log('='.repeat(60));
  console.log();

  // Check if phone number was provided
  if (!process.argv[2]) {
    console.log('⚠️  No phone number provided. Using default: +1234567890');
    console.log('   To test with your number, run: node test-whatsapp.js +1234567890\n');
  }

  const configOk = await testConfiguration();
  if (!configOk) {
    process.exit(1);
  }

  await testWhatsAppIntegration();
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled error:', error.message);
  process.exit(1);
});

// Run the tests
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testWhatsAppIntegration,
  testConfiguration
};
