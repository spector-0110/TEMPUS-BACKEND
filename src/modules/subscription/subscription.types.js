/**
 * @typedef {Object} SubscriptionFeature
 * @property {string} name - Name of the feature
 * @property {string} description - Description of the feature
 * @property {boolean} isEnabled - Whether the feature is enabled
 */

/**
 * @typedef {Object} SubscriptionPlan
 * @property {string} id
 * @property {string} name - Plan name (e.g. Basic, Pro, Enterprise)
 * @property {string} description
 * @property {number} monthlyPrice - Price in cents
 * @property {number} yearlyPrice - Price in cents
 * @property {number} maxDoctors - Maximum number of doctors allowed
 * @property {SubscriptionFeature[]} features - Array of features included in the plan
 * @property {boolean} isActive - Whether the plan is currently available
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} HospitalSubscription
 * @property {string} id
 * @property {string} hospitalId
 * @property {string} planId
 * @property {string} status - active, expired, cancelled
 * @property {Date} startDate
 * @property {Date} endDate
 * @property {string} billingCycle - monthly, yearly
 * @property {number} price - Price in cents
 * @property {number} smsCredits - Remaining SMS credits
 * @property {number} emailCredits - Remaining email credits
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} SubscriptionUsage
 * @property {string} hospitalId
 * @property {string} subscriptionId
 * @property {number} doctorsCount
 * @property {number} smsUsed
 * @property {number} emailsUsed
 * @property {Date} lastUpdated
 */

module.exports = {
  // These are just type definitions
};