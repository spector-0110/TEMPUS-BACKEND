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

      // Skip validation for optional empty fields
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
      }

      // Store the transformed value if validation passed
      if (validationResult.transformedValue !== undefined) {
        transformedData[field.id] = validationResult.transformedValue;
      } else {
        transformedData[field.id] = value;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      transformedData
    };
  }

  flattenFormFields(sections) {
    const flattenedFields = [];
    
    const flattenField = (field, prefix = '') => {
        flattenedFields.push({
          ...field,
          id: prefix ? `${prefix}${field.id}` : field.id
        });
    };

    for (const section of sections) {
      for (const field of section.fields) {
        flattenField(field);
      }
    }
    
    return flattenedFields;
  }

}

module.exports = new HospitalValidator();

