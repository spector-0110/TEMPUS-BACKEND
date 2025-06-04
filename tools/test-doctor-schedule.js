// Test script for doctor schedule retrieval
const queueService = require('../src/modules/appointment/advanced-queue.service');
const { v4: uuidv4 } = require('uuid');

// Generate test data
const testDoctorId = process.argv[2] || uuidv4();
const testHospitalId = process.argv[3] || uuidv4();
const testDate = process.argv[4] || new Date().toISOString();

async function testDoctorSchedule() {
  try {
    console.log('Testing doctor schedule retrieval with:');
    console.log(`- Doctor ID: ${testDoctorId}`);
    console.log(`- Hospital ID: ${testHospitalId}`);
    console.log(`- Date: ${testDate}`);
    console.log('\nAttempting to retrieve schedule...');
    
    const schedule = await queueService.getDoctorDaySchedule(
      testDoctorId,
      testDate,
      testHospitalId
    );
    
    console.log('\nSchedule retrieval successful:');
    console.log(JSON.stringify(schedule, null, 2));
    
    // Test calculating consultation time
    const consultationTime = schedule?.avgConsultationTime || queueService.DEFAULT_CONSULTATION_TIME;
    console.log(`\nConsultation time: ${consultationTime} minutes`);
    
    return true;
  } catch (error) {
    console.error('\nSchedule retrieval failed:');
    console.error(error.message);
    console.error(error.stack);
    return false;
  }
}

// Run the test
testDoctorSchedule()
  .then(success => {
    console.log('\nTest completed ' + (success ? 'successfully' : 'with errors'));
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
