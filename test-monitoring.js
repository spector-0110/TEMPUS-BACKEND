#!/usr/bin/env node

/**
 * Test script for Subscription Monitoring Service
 * This script tests the cleanup functionality for stuck renewals
 * 
 * Usage: node test-monitoring.js [test-type]
 * test-type: cleanup | health | locks | all (default: all)
 */

require('dotenv').config();
const monitoringService = require('./src/modules/subscription/subscription.monitoring');
const { prisma } = require('./src/services/database.service');
const { PAYMENT_STATUS } = require('./src/modules/subscription/subscription.constants');

async function testCleanupStuckRenewals() {
  console.log('🧪 Testing cleanup of stuck renewals...\n');
  
  try {
    // Check current pending renewals
    const currentPending = await prisma.subscriptionHistory.count({
      where: {
        paymentStatus: PAYMENT_STATUS.PENDING
      }
    });
    
    console.log(`📊 Current pending renewals: ${currentPending}`);
    
    // Find stuck renewals (older than 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const stuckBefore = await prisma.subscriptionHistory.findMany({
      where: {
        paymentStatus: PAYMENT_STATUS.PENDING,
        createdAt: {
          lt: thirtyMinutesAgo
        }
      },
      select: {
        id: true,
        createdAt: true,
        razorpayOrderId: true,
        hospitalId: true
      }
    });
    
    console.log(`🔍 Found ${stuckBefore.length} stuck renewals (older than 30 minutes):`);
    stuckBefore.forEach((renewal, index) => {
      const ageMinutes = Math.floor((Date.now() - new Date(renewal.createdAt).getTime()) / (1000 * 60));
      console.log(`  ${index + 1}. ID: ${renewal.id.substring(0, 8)}... Age: ${ageMinutes}min, Order: ${renewal.razorpayOrderId || 'None'}`);
    });
    
    if (stuckBefore.length === 0) {
      console.log('✅ No stuck renewals found. Creating a test renewal...');
      
      // Create a test stuck renewal for demonstration
      const testHospital = await prisma.hospital.findFirst();
      if (testHospital) {
        const testSubscription = await prisma.hospitalSubscription.findFirst({
          where: { hospitalId: testHospital.id }
        });
        
        if (testSubscription) {
          const testRenewal = await prisma.subscriptionHistory.create({
            data: {
              subscriptionId: testSubscription.id,
              hospitalId: testHospital.id,
              doctorCount: 1,
              billingCycle: 'MONTHLY',
              totalPrice: 4999.99,
              startDate: new Date(),
              endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
              paymentStatus: PAYMENT_STATUS.PENDING,
              createdAt: new Date(Date.now() - 35 * 60 * 1000), // 35 minutes ago
              paymentDetails: {
                testCreated: true,
                createdFor: 'monitoring_test'
              }
            }
          });
          
          console.log(`✅ Created test stuck renewal: ${testRenewal.id}`);
        }
      }
    }
    
    // Run the cleanup
    console.log('\n🚀 Running cleanup process...');
    const result = await monitoringService.cleanupStuckRenewals();
    
    console.log('📋 Cleanup Results:');
    console.log(`   Total found: ${result.total}`);
    console.log(`   Processed: ${result.processed}`);
    console.log(`   Failed: ${result.failed}`);
    
    // Check after cleanup
    const stuckAfter = await prisma.subscriptionHistory.count({
      where: {
        paymentStatus: PAYMENT_STATUS.PENDING,
        createdAt: {
          lt: thirtyMinutesAgo
        }
      }
    });
    
    console.log(`\n📊 Stuck renewals after cleanup: ${stuckAfter}`);
    
    if (stuckAfter < stuckBefore.length) {
      console.log('✅ Cleanup was successful!');
    } else if (result.total === 0) {
      console.log('ℹ️  No stuck renewals to clean up.');
    } else {
      console.log('⚠️  Some renewals may not have been processed.');
    }
    
  } catch (error) {
    console.error('❌ Error testing cleanup:', error.message);
    throw error;
  }
}

async function testSystemHealth() {
  console.log('🏥 Testing system health check...\n');
  
  try {
    const health = await monitoringService.getSystemHealth();
    
    console.log(`Overall Status: ${health.status.toUpperCase()}`);
    console.log('Service Checks:');
    Object.entries(health.checks).forEach(([service, status]) => {
      const emoji = status === 'healthy' ? '✅' : status === 'error' ? '❌' : '⚠️';
      console.log(`  ${emoji} ${service}: ${status}`);
    });
    
    console.log('\nMetrics:');
    console.log(`  Failed Payments: ${health.metrics.failedPayments}`);
    console.log(`  Consecutive Timeouts: ${health.metrics.consecutiveTimeouts}`);
    console.log(`  Duplicate Attempts: ${health.metrics.duplicateAttempts}`);
    console.log(`  Last Reset: ${health.metrics.lastReset}`);
    
  } catch (error) {
    console.error('❌ Error testing health check:', error.message);
    throw error;
  }
}

async function testOrphanedLocks() {
  console.log('🔒 Testing orphaned locks cleanup...\n');
  
  try {
    await monitoringService.cleanupOrphanedLocks();
    console.log('✅ Orphaned locks cleanup completed');
  } catch (error) {
    console.error('❌ Error testing locks cleanup:', error.message);
    throw error;
  }
}

async function testFullMonitoring() {
  console.log('🔍 Running full monitoring tasks...\n');
  
  try {
    const results = await monitoringService.runMonitoringTasks();
    
    console.log('📋 Full Monitoring Results:');
    console.log('  Stuck Renewals:', results.stuckRenewals);
    console.log('  Orphaned Locks:', results.orphanedLocks);
    console.log('  System Health:', results.systemHealth.status);
    
    return results;
  } catch (error) {
    console.error('❌ Error running full monitoring:', error.message);
    throw error;
  }
}

async function showStuckRenewalsReport() {
  console.log('📊 Stuck Renewals Report\n');
  
  try {
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const [
      pendingTotal,
      stuckTotal,
      stuckOneHour,
      stuckOneDay
    ] = await Promise.all([
      prisma.subscriptionHistory.count({
        where: { paymentStatus: PAYMENT_STATUS.PENDING }
      }),
      prisma.subscriptionHistory.count({
        where: {
          paymentStatus: PAYMENT_STATUS.PENDING,
          createdAt: { lt: thirtyMinutesAgo }
        }
      }),
      prisma.subscriptionHistory.count({
        where: {
          paymentStatus: PAYMENT_STATUS.PENDING,
          createdAt: { lt: oneHourAgo }
        }
      }),
      prisma.subscriptionHistory.count({
        where: {
          paymentStatus: PAYMENT_STATUS.PENDING,
          createdAt: { lt: oneDayAgo }
        }
      })
    ]);
    
    console.log(`Total pending renewals: ${pendingTotal}`);
    console.log(`Stuck > 30 minutes: ${stuckTotal}`);
    console.log(`Stuck > 1 hour: ${stuckOneHour}`);
    console.log(`Stuck > 24 hours: ${stuckOneDay}`);
    
    // Show details of oldest stuck renewals
    const oldestStuck = await prisma.subscriptionHistory.findMany({
      where: {
        paymentStatus: PAYMENT_STATUS.PENDING,
        createdAt: { lt: thirtyMinutesAgo }
      },
      include: {
        hospital: {
          select: { name: true, adminEmail: true }
        }
      },
      orderBy: { createdAt: 'asc' },
      take: 5
    });
    
    if (oldestStuck.length > 0) {
      console.log('\n🕐 Oldest stuck renewals:');
      oldestStuck.forEach((renewal, index) => {
        const ageHours = Math.floor((now.getTime() - new Date(renewal.createdAt).getTime()) / (1000 * 60 * 60));
        const ageMinutes = Math.floor(((now.getTime() - new Date(renewal.createdAt).getTime()) % (1000 * 60 * 60)) / (1000 * 60));
        console.log(`  ${index + 1}. ${renewal.hospital.name} - ${ageHours}h ${ageMinutes}m old - Order: ${renewal.razorpayOrderId || 'None'}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error generating report:', error.message);
    throw error;
  }
}

// Main execution
async function main() {
  const testType = process.argv[2] || 'all';
  
  console.log('='.repeat(60));
  console.log('        SUBSCRIPTION MONITORING SERVICE TEST');
  console.log('='.repeat(60));
  console.log();
  
  try {
    switch (testType.toLowerCase()) {
      case 'cleanup':
        await testCleanupStuckRenewals();
        break;
      case 'health':
        await testSystemHealth();
        break;
      case 'locks':
        await testOrphanedLocks();
        break;
      case 'report':
        await showStuckRenewalsReport();
        break;
      case 'all':
      default:
        await showStuckRenewalsReport();
        console.log('\n' + '='.repeat(60) + '\n');
        await testSystemHealth();
        console.log('\n' + '='.repeat(60) + '\n');
        await testCleanupStuckRenewals();
        console.log('\n' + '='.repeat(60) + '\n');
        await testOrphanedLocks();
        console.log('\n' + '='.repeat(60) + '\n');
        await testFullMonitoring();
        break;
    }
    
    console.log('\n✅ All tests completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled error:', error.message);
  process.exit(1);
});

// Show usage if help requested
if (process.argv[2] === '--help' || process.argv[2] === '-h') {
  console.log('Usage: node test-monitoring.js [test-type]');
  console.log('');
  console.log('Test types:');
  console.log('  cleanup  - Test stuck renewals cleanup');
  console.log('  health   - Test system health check');
  console.log('  locks    - Test orphaned locks cleanup');
  console.log('  report   - Show stuck renewals report');
  console.log('  all      - Run all tests (default)');
  console.log('');
  process.exit(0);
}

// Run the tests
if (require.main === module) {
  main().catch(console.error);
}
