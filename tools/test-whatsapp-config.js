// const WhatsAppService = require('../src/services/whatsapp.service');

// async function testWhatsAppConfig() {
//   console.log('🔧 Testing WhatsApp Service Configuration...\n');
  
//   // Check configuration status
//   const configStatus = WhatsAppService.isConfigured();
//   console.log('Configuration Status:', configStatus);
  
//   if (!configStatus.configured) {
//     console.log('\n❌ Configuration Issues Found:');
//     configStatus.missing.forEach(item => {
//       console.log(`   - ${item}`);
//     });
    
//     console.log('\n📋 To fix these issues:');
//     console.log('1. Go to https://console.twilio.com/');
//     console.log('2. Sign up/login to your Twilio account');
//     console.log('3. Get your Account SID and Auth Token from the dashboard');
//     console.log('4. Set up WhatsApp Sandbox: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn');
//     console.log('5. Update your .env file with the correct values');
    
//     return;
//   }
  
//   console.log('\n✅ Configuration looks good!');
//   console.log('\n🧪 Testing a simple message send...');
  
//   // Test sending a message (this will likely fail with 401 if credentials are invalid)
//   try {
//     const result = await WhatsAppService.sendMessage(
//       '+1234567890', // Test number
//       'Test message from Tiqora WhatsApp Service'
//     );
    
//     if (result.success) {
//       console.log('✅ Message sent successfully!');
//       console.log('Message SID:', result.messageSid);
//     } else {
//       console.log('❌ Message failed to send:');
//       console.log('Error:', result.error);
//       console.log('Code:', result.code);
      
//       if (result.status === 401) {
//         console.log('\n🔐 Authentication Error Solutions:');
//         console.log('1. Verify your TWILIO_ACCOUNT_SID starts with "AC"');
//         console.log('2. Verify your TWILIO_AUTH_TOKEN is 32 characters long');
//         console.log('3. Make sure you\'re using the correct credentials from https://console.twilio.com/');
//         console.log('4. Check if your Twilio account is active and not suspended');
//       }
//     }
//   } catch (error) {
//     console.error('❌ Test failed:', error.message);
//   }
// }

// // Run the test
// testWhatsAppConfig().catch(console.error);
