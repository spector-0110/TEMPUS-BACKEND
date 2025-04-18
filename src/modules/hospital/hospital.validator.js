const formService = require('../../services/form.service');

class HospitalValidator {
  async validateFormData(data) {
    const formConfig = await formService.getConfig();
    const errors = [];
    const transformedData = { ...data };

    // Iterate through sections and validate each field
    for (const section of formConfig.sections) {
      for (const field of section.fields) {
        const value = this.getNestedValue(data, field.id);
        
        // Skip validation if field is not required and value is not provided
        if (!field.required && (value === undefined || value === null || value === '')) {
          continue;
        }

        const validationResult = await formService.validateFieldValue(field, value);
        
        if (!validationResult.isValid) {
          errors.push({
            field: field.id,
            label: field.label,
            errors: validationResult.errors
          });
        } else if (validationResult.transformedValue !== undefined) {
          this.setNestedValue(transformedData, field.id, validationResult.transformedValue);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      transformedData
    };
  }

  validateContactInfo(contactInfo) {
    const requiredFields = ['phone'];
    const missingFields = requiredFields.filter(field => !contactInfo[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required contact fields: ${missingFields.join(', ')}`);
    }

    // Validate phone format (basic validation)
    const phoneRegex = /^\+?[\d\s-]{8,}$/;
    if (!phoneRegex.test(contactInfo.phone)) {
      throw new Error('Invalid phone format in contact info');
    }

    return true;
  }

  // Helper to get nested object value by path
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => 
      current ? current[key] : undefined, obj);
  }

  // Helper to set nested object value by path
  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((current, key) => {
      if (!current[key]) current[key] = {};
      return current[key];
    }, obj);
    target[lastKey] = value;
  }
}

module.exports = new HospitalValidator();