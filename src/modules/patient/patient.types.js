/**
 * @typedef {Object} PatientContact
 * @property {string} phone - Primary phone number
 * @property {string} [alternatePhone] - Alternative phone number
 * @property {string} [email] - Email address
 * @property {string} [emergencyContact] - Emergency contact number
 * @property {string} [emergencyContactName] - Name of emergency contact person
 */

/**
 * @typedef {Object} PatientAddress
 * @property {string} street
 * @property {string} city
 * @property {string} state
 * @property {string} pincode
 */

/**
 * @typedef {Object} PatientMedicalInfo
 * @property {string[]} [allergies]
 * @property {string[]} [chronicConditions]
 * @property {string[]} [currentMedications]
 * @property {string} [bloodGroup]
 * @property {string} [notes]
 */

/**
 * @typedef {Object} Patient
 * @property {string} id
 * @property {string} hospitalId
 * @property {string} name
 * @property {Date} dateOfBirth
 * @property {string} gender
 * @property {string} [uhid] - Unique Health Identifier
 * @property {PatientContact} contact
 * @property {PatientAddress} address
 * @property {PatientMedicalInfo} [medicalInfo]
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {string} [fileNumber] - Physical file number
 */

/**
 * @typedef {Object} PatientSearchFilters
 * @property {string} [name]
 * @property {string} [phone]
 * @property {string} [uhid]
 * @property {string} [fileNumber]
 * @property {Date} [dateOfBirth]
 */

module.exports = {
  // These are just type definitions
};