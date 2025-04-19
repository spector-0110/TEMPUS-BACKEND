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

    console.log('✅ Subscription cron jobs scheduled');
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
          hospital: true,
          plan: true
        }
      });

      for (const subscription of expiredSubscriptions) {
        await subscriptionService.updateSubscriptionStatusAndHistory(
          subscription.id, 
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
          hospital: true,
          plan: true
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
    const features = subscription.planFeatures;
    
    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Subscription Expiring Soon</h2>
        <p>Dear ${subscription.hospital.name} Administrator,</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
          <p><strong>Plan:</strong> ${subscription.plan.name}</p>
          <p><strong>Expires in:</strong> ${daysToExpiry} days</p>
          <p><strong>Expiry Date:</strong> ${subscription.endDate.toLocaleDateString()}</p>
          
          <div style="margin-top: 15px;">
            <p><strong>Current Plan Features:</strong></p>
            <ul>
              <li>Maximum Doctors: ${features.max_doctors}</li>
              <li>SMS Credits: ${features.base_sms_credits}</li>
              <li>Email Credits: ${features.base_email_credits}</li>
              ${features.analytics_access ? '<li>Analytics Access</li>' : ''}
              ${features.reporting_access ? '<li>Reporting Access</li>' : ''}
              ${features.premium_support ? '<li>Premium Support</li>' : ''}
              ${features.custom_branding ? '<li>Custom Branding</li>' : ''}
            </ul>
          </div>
        </div>

        <p>To maintain uninterrupted service and keep these features, please renew your subscription before expiry.</p>
        
        <div style="margin: 20px 0;">
          <p><strong>Options:</strong></p>
          <ul>
            <li>Renew your current plan</li>
            <li>Upgrade to a different plan</li>
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
    const features = subscription.planFeatures;
    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Subscription Expired</h2>
        <p>Dear ${subscription.hospital.name} Administrator,</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; margin: 20px 0;">
          <p><strong>Plan:</strong> ${subscription.plan.name}</p>
          <p><strong>Expired on:</strong> ${subscription.endDate.toLocaleDateString()}</p>
          
          <div style="margin-top: 15px;">
            <p><strong>Previously Active Features:</strong></p>
            <ul>
              <li>Maximum Doctors: ${features.max_doctors}</li>
              <li>SMS Credits: ${features.base_sms_credits}</li>
              <li>Email Credits: ${features.base_email_credits}</li>
              ${features.analytics_access ? '<li>Analytics Access</li>' : ''}
              ${features.reporting_access ? '<li>Reporting Access</li>' : ''}
              ${features.premium_support ? '<li>Premium Support</li>' : ''}
              ${features.custom_branding ? '<li>Custom Branding</li>' : ''}
            </ul>
          </div>
        </div>

        <p style="color: #dc2626;"><strong>Important:</strong> Your access to premium features has been limited.</p>
        
        <div style="margin: 20px 0;">
          <p>To restore full access:</p>
          <ul>
            <li>Renew your subscription</li>
            <li>Upgrade to a different plan</li>
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
