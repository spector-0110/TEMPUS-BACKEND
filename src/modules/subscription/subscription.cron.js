const cron = require('node-cron');
const { prisma } = require('../../services/database.service');
const mailService = require('../../services/mail.service');
const subscriptionService = require('./subscription.service');
const { SUBSCRIPTION_STATUS, SUBSCRIPTION_EXPIRY_WARNING_DAYS } = require('./subscription.constants');

class SubscriptionCronService {
  constructor() {
    this.expiredSubscriptionsJob = null;
    this.expiryWarningsJob = null;
  }

  startCronJobs() {
    // Run every day at midnight to check expired subscriptions
    this.expiredSubscriptionsJob = cron.schedule('0 0 * * *', () => {
      this.checkExpiredSubscriptions();
    });

    // Run every day at 9 AM to send expiry warnings
    this.expiryWarningsJob = cron.schedule('0 9 * * *', () => {
      this.sendExpiryWarnings();
    });

    console.log(' Subscription cron jobs scheduled');
  }

  stopCronJobs() {
    if (this.expiredSubscriptionsJob) {
      this.expiredSubscriptionsJob.stop();
    }
    if (this.expiryWarningsJob) {
      this.expiryWarningsJob.stop();
    }
    console.log('Subscription cron jobs stopped');
  }

  async checkExpiredSubscriptions() {
    try {
      const now = new Date();

      const expiredSubscriptions = await prisma.hospitalSubscription.findMany({
        where: {
          status: SUBSCRIPTION_STATUS.ACTIVE,
          endDate: { lt: now }
        },
        include: {
          hospital: true
        }
      });

      for (const subscription of expiredSubscriptions) {
        await subscriptionService.updateSubscriptionStatus(
          subscription, 
          SUBSCRIPTION_STATUS.EXPIRED
        );
        await this.sendExpirationEmail(subscription);
      }
    } catch (error) {
      console.error('Error checking expired subscriptions:', error);
    }
  }

  async sendExpiryWarnings() {
    try {
      const now = new Date();
      const warningDate = new Date();
      warningDate.setDate(warningDate.getDate() + SUBSCRIPTION_EXPIRY_WARNING_DAYS);

      const expiringSubscriptions = await prisma.hospitalSubscription.findMany({
        where: {
          status: SUBSCRIPTION_STATUS.ACTIVE,
          endDate: {
            gt: now,
            lte: warningDate
          },
          lastNotifiedAt: {
            lt: new Date(now.setHours(0, 0, 0, 0))
          }
        },
        include: {
          hospital: true
        }
      });

      for (const subscription of expiringSubscriptions) {
        await this.sendWarningEmail(subscription);
        await prisma.hospitalSubscription.update({
          where: { id: subscription.id },
          data: { lastNotifiedAt: now }
        });
      }
    } catch (error) {
      console.error('Error sending expiry warnings:', error);
    }
  }

  async sendWarningEmail(subscription) {
    const daysToExpiry = Math.ceil((subscription.endDate - new Date()) / (1000 * 60 * 60 * 24));
    
    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Subscription Expiring Soon</h2>
        <p>Dear ${subscription.hospital.name} Administrator,</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
          <p><strong>Subscription Details:</strong></p>
          <ul>
            <li>Doctors Allowed: ${subscription.doctorCount}</li>
            <li>Total Price: ${subscription.totalPrice}</li>
            <li>Billing Cycle: ${subscription.billingCycle}</li>
            <li>Expires in: ${daysToExpiry} days</li>
            <li>Expiry Date: ${subscription.endDate.toLocaleDateString()}</li>
          </ul>
        </div>

        <p>To maintain uninterrupted service, please renew your subscription before expiry.</p>
        
        <div style="margin: 20px 0;">
          <p><strong>Options:</strong></p>
          <ul>
            <li>Renew your subscription</li>
            <li>Adjust doctor count if needed</li>
            <li>Contact support for assistance</li>
          </ul>
        </div>
      </div>
    `;

    await mailService.sendMail(
      subscription.hospital.adminEmail,
      'Subscription Expiring Soon',
      emailContent,
      subscription.hospitalId
    );
  }

  async sendExpirationEmail(subscription) {
    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Subscription Expired</h2>
        <p>Dear ${subscription.hospital.name} Administrator,</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
          <p><strong>Subscription Details:</strong></p>
          <ul>
            <li>Doctors Allowed: ${subscription.doctorCount}</li>
            <li>Total Price: ${subscription.totalPrice}</li>
            <li>Billing Cycle: ${subscription.billingCycle}</li>
            <li>Expired on: ${subscription.endDate.toLocaleDateString()}</li>
          </ul>
        </div>

        <p style="color: #dc2626;"><strong>Important:</strong> Your subscription has expired. Please renew to restore access.</p>
        
        <div style="margin: 20px 0;">
          <p><strong>To restore access:</strong></p>
          <ul>
            <li>Renew your subscription</li>
            <li>Adjust doctor count if needed</li>
            <li>Contact our support team for assistance</li>
          </ul>
        </div>
      </div>
    `;

    await mailService.sendMail(
      subscription.hospital.adminEmail,
      'Subscription Expired',
      emailContent,
      subscription.hospitalId
    );
  }
}

module.exports = new SubscriptionCronService();
