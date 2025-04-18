const { GENDER_OPTIONS, BLOOD_GROUPS } = require('./patient.constants');

class PatientValidator {
  validateCreatePatientData(data) {
    const errors = [];

    // Required fields
    if (!data.name?.trim()) {
      errors.push('Name is required');
    }

    if (!data.dateOfBirth) {
      errors.push('Date of birth is required');
    } else if (!(new Date(data.dateOfBirth)).getTime()) {
      errors.push('Invalid date of birth');
    }

    if (!data.gender) {
      errors.push('Gender is required');
    } else if (!Object.values(GENDER_OPTIONS).includes(data.gender.toLowerCase())) {
      errors.push('Invalid gender option');
    }

    // Validate contact info
    if (!data.contact) {
      errors.push('Contact information is required');
    } else {
      const contactErrors = this.validateContactInfo(data.contact);
      errors.push(...contactErrors);
    }

    // Validate address if provided
    if (data.address) {
      const addressErrors = this.validateAddress(data.address);
      errors.push(...addressErrors);
    }

    // Validate medical info if provided
    if (data.medicalInfo) {
      const medicalInfoErrors = this.validateMedicalInfo(data.medicalInfo);
      errors.push(...medicalInfoErrors);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  validateContactInfo(contact) {
    const errors = [];

    if (!contact.phone) {
      errors.push('Primary phone number is required');
    } else if (!this.isValidPhone(contact.phone)) {
      errors.push('Invalid primary phone number format');
    }

    if (contact.alternatePhone && !this.isValidPhone(contact.alternatePhone)) {
      errors.push('Invalid alternate phone number format');
    }

    if (contact.email && !this.isValidEmail(contact.email)) {
      errors.push('Invalid email format');
    }

    if (contact.emergencyContact && !this.isValidPhone(contact.emergencyContact)) {
      errors.push('Invalid emergency contact number format');
    }

    return errors;
  }

  validateAddress(address) {
    const errors = [];
    const requiredFields = ['street', 'city', 'state', 'pincode'];

    requiredFields.forEach(field => {
      if (!address[field]?.trim()) {
        errors.push(`${field.charAt(0).toUpperCase() + field.slice(1)} is required in address`);
      }
    });

    if (address.pincode && !this.isValidPincode(address.pincode)) {
      errors.push('Invalid pincode format');
    }

    return errors;
  }

  validateMedicalInfo(medicalInfo) {
    const errors = [];

    if (medicalInfo.bloodGroup && !BLOOD_GROUPS.includes(medicalInfo.bloodGroup)) {
      errors.push('Invalid blood group');
    }

    // Validate arrays are actually arrays if provided
    ['allergies', 'chronicConditions', 'currentMedications'].forEach(field => {
      if (medicalInfo[field] && !Array.isArray(medicalInfo[field])) {
        errors.push(`${field} must be an array`);
      }
    });

    return errors;
  }

  validateSearchFilters(filters) {
    const errors = [];
    const allowedFilters = ['name', 'phone', 'uhid', 'fileNumber', 'dateOfBirth'];

    // Check for unknown filters
    Object.keys(filters).forEach(key => {
      if (!allowedFilters.includes(key)) {
        errors.push(`Unknown filter: ${key}`);
      }
    });

    // Validate date format if provided
    if (filters.dateOfBirth && !(new Date(filters.dateOfBirth)).getTime()) {
      errors.push('Invalid date format for dateOfBirth filter');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Helper methods
  isValidPhone(phone) {
    const phoneRegex = /^\+?[\d\s-]{10,}$/;
    return phoneRegex.test(phone);
  }

  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  isValidPincode(pincode) {
    const pincodeRegex = /^\d{6}$/;
    return pincodeRegex.test(pincode);
  }
}

module.exports = new PatientValidator();