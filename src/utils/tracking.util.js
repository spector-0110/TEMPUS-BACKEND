const jwt = require('jsonwebtoken');
const { TRACKING_LINK } = require('../modules/appointment/appointment.constants');

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
   * @returns {string} Full tracking URL
   */
  generateTrackingLink(appointmentId, hospitalId, doctorId) {
    const token = this.generateToken(appointmentId, hospitalId, doctorId);
    return `${process.env.FRONTEND_URL || 'http://localhost:3000'}/appointment/track/${token}`;
  }

  /**
   * Verify and decode a tracking token
   * 
   * @param {string} token - The JWT token to verify
   * @returns {object} Decoded token data {appointmentId, hospitalId, doctorId}
   */
  verifyToken(token) {
    try {
      return jwt.verify(
        token, 
        process.env.JWT_SECRET || 'appointment-tracking-secret'
      );
    } catch (error) {
      throw new Error('Invalid or expired tracking token');
    }
  }
}

module.exports = new TrackingLinkUtil();
