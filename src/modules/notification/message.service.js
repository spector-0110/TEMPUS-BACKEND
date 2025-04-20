const { prisma } = require('../../services/database.service');
const redisService = require('../../services/redis.service');
const { 
  MESSAGE_STATUS, 
  MESSAGE_TYPE, 
  MESSAGE_QUOTA_PER_DOCTOR,
  MESSAGE_COSTS,
  CACHE_KEYS,
  CACHE_EXPIRY,
  LIMITS 
} = require('../subscription/subscription.constants');

class MessageService {
  async logMessage(data) {
    return await prisma.messageLog.create({
      data: {
        hospitalId: data.hospitalId,
        type: data.type,
        recipient: data.recipient,
        subject: data.subject,
        messageBody: data.messageBody,
        messageTemplate: data.messageTemplate,
        relatedId: data.relatedId,
        metadata: data.metadata || {},
        cost: data.type === MESSAGE_TYPE.SMS ? MESSAGE_COSTS.SMS : MESSAGE_COSTS.EMAIL
      }
    });
  }

  async updateMessageStatus(messageId, status, errorMessage = null) {
    return await prisma.messageLog.update({
      where: { id: messageId },
      data: {
        status,
        errorMessage,
        retryCount: status === MESSAGE_STATUS.FAILED ? { increment: 1 } : undefined
      }
    });
  }

  async getMessageQuota(hospitalId) {
    const cacheKey = CACHE_KEYS.MESSAGE_QUOTA + hospitalId;
    let quota = await redisService.getCache(cacheKey);

    if (!quota) {
      quota = await this.refreshMessageQuota(hospitalId);
      await redisService.setCache(cacheKey, quota, CACHE_EXPIRY.MESSAGE_QUOTA);
    }

    return quota;
  }

  async refreshMessageQuota(hospitalId) {
    const currentDate = new Date();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);

    // Get current doctor count
    const doctorCount = await prisma.doctor.count({
      where: {
        hospitalId,
        status: 'active'
      }
    });

    let quota = await prisma.messageQuota.findFirst({
      where: {
        hospitalId,
        month: firstDayOfMonth
      }
    });

    if (!quota) {
      // Create new quota for the month
      quota = await prisma.messageQuota.create({
        data: {
          hospitalId,
          month: firstDayOfMonth,
          doctorCount,
          smsQuota: doctorCount * MESSAGE_QUOTA_PER_DOCTOR.SMS,
          emailQuota: doctorCount * MESSAGE_QUOTA_PER_DOCTOR.EMAIL,
          smsUsed: 0,
          emailUsed: 0
        }
      });
    } else if (quota.doctorCount !== doctorCount) {
      // Update quota if doctor count changed
      quota = await prisma.messageQuota.update({
        where: { id: quota.id },
        data: {
          doctorCount,
          smsQuota: doctorCount * MESSAGE_QUOTA_PER_DOCTOR.SMS,
          emailQuota: doctorCount * MESSAGE_QUOTA_PER_DOCTOR.EMAIL
        }
      });
    }

    return quota;
  }

  async checkQuota(hospitalId, messageType) {
    const quota = await this.getMessageQuota(hospitalId);
    
    if (messageType === MESSAGE_TYPE.SMS) {
      return quota.smsUsed < quota.smsQuota;
    }
    return quota.emailUsed < quota.emailQuota;
  }

  async incrementUsage(hospitalId, messageType) {
    const updateField = messageType === MESSAGE_TYPE.SMS ? 'smsUsed' : 'emailUsed';
    const currentDate = new Date();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);

    await prisma.messageQuota.updateMany({
      where: {
        hospitalId,
        month: firstDayOfMonth
      },
      data: {
        [updateField]: {
          increment: 1
        }
      }
    });

    // Invalidate cache to force refresh
    await redisService.invalidateCache(CACHE_KEYS.MESSAGE_QUOTA + hospitalId);
  }

  async getMessageStats(hospitalId, startDate, endDate) {
    return await prisma.messageLog.groupBy({
      by: ['type', 'status'],
      where: {
        hospitalId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      _count: true
    });
  }
}

module.exports = new MessageService();