const formService = require('../../services/form.service');

class HospitalValidator {
  async validateFormData(data) {
    const formConfig = await formService.getConfig();
    const errors = [];
    const transformedData = {}; 
  
    // Flatten form config fields
    const flattenedFields = this.flattenFormFields(formConfig.sections);
  
    for (const field of flattenedFields) {
      const value = data[field.id];
  
      console.log(`Validating field: ${field.id}, value: ${value}`);
  
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
        setNestedValue(transformedData, field.id, validationResult.transformedValue);
      } else {
        setNestedValue(transformedData, field.id, value);
      }
    }
  
    return {
      isValid: errors.length === 0,
      errors,
      transformedData
    };
  }

  // Helper to flatten form fields with dot notation
  flattenFormFields(sections) {
    const flattenedFields = [];
    
    const flattenField = (field, prefix = '') => {
      if (field.fields) {
        const newPrefix = prefix ? `${prefix}${field.id}.` : `${field.id}.`;
        for (const nestedField of field.fields) {
          flattenField(nestedField, newPrefix);
        }
      } else {
        flattenedFields.push({
          ...field,
          id: prefix ? `${prefix}${field.id}` : field.id
        });
      }
    };

    for (const section of sections) {
      for (const field of section.fields) {
        flattenField(field);
      }
    }
    
    return flattenedFields;
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
}



// utils/objectHelper.js
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;

  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      current[key] = value;
    } else {
      if (!current[key]) current[key] = {};
      current = current[key];
    }
  });

  return obj;
}


function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;

  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      current[key] = value;
    } else {
      if (!current[key]) current[key] = {};
      current = current[key];
    }
  });

  return obj;
}

module.exports = new HospitalValidator();

