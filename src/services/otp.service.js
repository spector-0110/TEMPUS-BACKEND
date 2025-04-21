const crypto = require('crypto');
const { redisClient } = require('./redis.service');

class OTPService {
  constructor() {
    this.OTP_LENGTH = 6;
    this.OTP_EXPIRY = 5 * 60; // 5 minutes
    this.EDIT_VERIFICATION_EXPIRY = 10 * 60; // 10 minutes
  }

  async generateOTP(hospitalId) {
    const otp = crypto.randomInt(100000, 999999).toString();
    const key = `otp:hospital:${hospitalId}`;
    
    // Store OTP with expiry
    await redisService.setCache(key, {
      otp,
      attempts: 0,
      createdAt: new Date().toISOString()
    }, this.OTP_EXPIRY);
    
    return otp;
  }

  async verifyOTP(hospitalId, submittedOTP) {
    const key = `otp:hospital:${hospitalId}`;
    const otpData = await redisService.getCache(key);
    
    if (!otpData) {
      throw new Error('OTP expired or not found');
    }

    // Increment attempts
    otpData.attempts += 1;
    await redisService.setCache(key, otpData, this.OTP_EXPIRY);

    // Check max attempts (3)
    if (otpData.attempts > 3) {
      await redisService.invalidateCache(key);
      throw new Error('Maximum OTP verification attempts exceeded');
    }

    if (otpData.otp !== submittedOTP) {
      throw new Error('Invalid OTP');
    }

    // OTP verified - set edit verification status
    await this.setEditVerificationStatus(hospitalId);
    
    // Clear the OTP
    await redisService.invalidateCache(key);
    
    return true;
  }

  async setEditVerificationStatus(hospitalId) {
    const key = `edit_verified:hospital:${hospitalId}`;
    await redisService.setCache(key, {
      verifiedAt: new Date().toISOString()
    }, this.EDIT_VERIFICATION_EXPIRY);
  }

  async checkEditVerificationStatus(hospitalId) {
    const key = `edit_verified:hospital:${hospitalId}`;
    const status = await redisService.getCache(key);
    return !!status;
  }

  async invalidateEditVerificationStatus(entityId) {
    const key = `edit_verified:${entityId}`;
    await redisClient.del(key);
  }
}

module.exports = new OTPService();