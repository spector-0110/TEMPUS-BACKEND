const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const { TRACKING_LINK } = require('../modules/appointment/appointment.constants');
const redisService = require('../services/redis.service');

/**
 * Utility to handle secure tracking link creation and verification
 */
class TrackingLinkUtil {
  /**
   * Generate a secure tracking token containing appointment, hospital, and doctor IDs
   * 
   * @param {string} appointmentId - The appointment ID
   * @param {string} hospitalId - The hospital ID
   * @param {string} doctorId - The doctor ID
   * @returns {string} JWT token containing the IDs
   */
  
  generateToken(appointmentId, hospitalId, doctorId) {
    return jwt.sign(
      { appointmentId, hospitalId, doctorId },
      process.env.JWT_SECRET || 'appointment-tracking-secret',
      { 
        expiresIn: TRACKING_LINK.TOKEN_EXPIRY, 
        algorithm: TRACKING_LINK.ALGORITHM 
      }
    );
  }

  /**
   * Generate a complete tracking link for an appointment
   * 
   * @param {string} appointmentId - The appointment ID
   * @param {string} hospitalId - The hospital ID
   * @param {string} doctorId - The doctor ID
   * @returns {Promise<string>} Full tracking URL with short token
   */
  async generateTrackingLink(appointmentId, hospitalId, doctorId) {
    const jwt = this.generateToken(appointmentId, hospitalId, doctorId);
    const shortKey = await this.storeJWT(jwt);
    return `${process.env.APPPINTMENT_FRONTEND_URL || 'http://localhost:3000'}/track/${shortKey}`;
  }


   /**
   * Generate a complete upload link for an appointment
   * 
   * @param {string} appointmentId - The appointment ID
   * @param {string} hospitalId - The hospital ID
   * @param {string} doctorId - The doctor ID
   * @returns {Promise<string>} Full upload URL with short token
   */
  async generateUploadLink(appointmentId, hospitalId, doctorId) {
    const jwt = this.generateToken(appointmentId, hospitalId, doctorId);
    const shortKey = await this.storeJWT(jwt);
    return `${process.env.APPPINTMENT_FRONTEND_URL || 'http://localhost:3000'}/upload/${shortKey}`;
  }


  /**
   * Verify and decode a tracking token
   * 
   * @param {string} token - The short nanoid token to verify
   * @returns {Promise<object>} Decoded token data {appointmentId, hospitalId, doctorId}
   */
  async verifyToken(token) {
    try {
      // First check if the token is null, undefined, or not a string
      if (!token || typeof token !== 'string' || token.trim() === '') {
        throw new Error('Token is empty or invalid format');
      }
      
      // Retrieve the JWT from Redis using the short token
      const jwtToken = await this.getJWTFromToken(token);
      
      if (!jwtToken) {
        throw new Error('Token not found or has expired');
      }
      
      const decodedToken = jwt.verify(
        jwtToken, 
        process.env.JWT_SECRET || 'appointment-tracking-secret'
      );
      
      // Validate token structure - make sure it has all required fields
      if (!decodedToken || !decodedToken.appointmentId || !decodedToken.hospitalId || !decodedToken.doctorId) {
        throw new Error('Token is missing required fields');
      }
      
      return decodedToken;
    } catch (error) {
      // Preserve the original error type and message
      if (error.name === 'TokenExpiredError') {
        console.error('Token expired:', error.message);
        error.message = 'Tracking token has expired';
        throw error;
      } else if (error.name === 'JsonWebTokenError') {
        console.error('JWT error:', error.message);
        throw error;
      } else {
        console.error('Token verification error:', error.message);
        throw new Error('Invalid or expired tracking token');
      }
    }
  }

  /**
   * Store JWT using nanoid (10–12 chars) and return short key
   * 
   * @param {string} jwt - The JWT token to store
   * @param {number} ttlSeconds - Time to live in seconds (default: 3600)
   * @returns {string} Short nanoid key
   */
  async storeJWT(jwt, ttlSeconds = 3600*24) {
    const shortKey = nanoid(10); // e.g., 'aZx8Qr12Yp'
    await redisService.set(`t:${shortKey}`, jwt, ttlSeconds);
    return shortKey;
  }

  /**
   * Retrieve JWT using the nanoid key
   * 
   * @param {string} token - The nanoid token
   * @returns {string|null} The JWT token or null if not found
   */
  async getJWTFromToken(token) {
    return await redisService.get(`t:${token}`);
  }

}

module.exports = new TrackingLinkUtil();
