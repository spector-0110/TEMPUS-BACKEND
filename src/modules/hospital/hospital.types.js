/**
 * @typedef {Object} Address
 * @property {string} street
 * @property {string} city
 * @property {string} state
 * @property {string} pincode
 */

/**
 * @typedef {Object} ContactInfo
 * @property {string} phone
 * @property {string} [email]
 * @property {string} [alternatePhone]
 */

/**
 * @typedef {Object} Hospital
 * @property {string} id
 * @property {string} supabaseUserId
 * @property {string} name
 * @property {string} subdomain
 * @property {string} adminEmail
 * @property {string} gstin
 * @property {string} address
 * @property {ContactInfo} contactInfo
 * @property {string} [logo]
 * @property {string} themeColor
 * @property {Date} establishedDate
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} DashboardStats
 * @property {Object} appointments
 * @property {number} appointments.total
 * @property {number} appointments.today
 * @property {Object} doctors
 * @property {number} doctors.total
 * @property {number} doctors.active
 * @property {Object} subscription
 * @property {Date} subscription.expiresAt
 * @property {string} subscription.status
 * @property {number} subscription.doctorCount
 * @property {string} subscription.billingCycle
 * @property {number} subscription.totalPrice
 * @property {boolean} subscription.autoRenew
 * @property {Array<{type: string, message: string}>} licenseWarnings
 * @property {Array<{
 *   startDate: Date,
 *   endDate: Date,
 *   status: string,
 *   doctorCount: number,
 *   totalPrice: number,
 *   billingCycle: string
 * }>} subscriptionHistory
 */

module.exports = {
  // These are just type definitions
};