const redisService = require('./redis.service');
const defaultConfig = require('../config/form.config');

class FormConfigService {
  constructor() {
    this.CACHE_KEY = 'hospital:form:config';
    this.CACHE_EXPIRY = 24 * 60 * 60; // 24 hours
    this.initializeConfig();
  }

  async initializeConfig() {
    try {
      console.log('Initializing form config...');
      const existingConfig = await redisService.getCache(this.CACHE_KEY);
      if (!existingConfig) {
        await this.updateConfig(defaultConfig);
      }
    } catch (error) {
      this.handleError('Error initializing form config', error);
      // Don't throw on init - fallback to default config
    }
  }

  async getConfig() {
    try {
      console.log('Fetching form config...');
      const config = await redisService.getCache(this.CACHE_KEY);
      return config || defaultConfig;
    } catch (error) {
      this.handleError('Error fetching form config', error);
      return defaultConfig;
    }
  }

  async updateConfig(newConfig) {
    const validationResult = this.validateConfig(newConfig);
    if (!validationResult.isValid) {
      throw new Error(`Invalid form configuration: ${validationResult.errors.join(', ')}`);
    }

    try {
      await redisService.setCache(this.CACHE_KEY, newConfig, this.CACHE_EXPIRY);
      return true;
    } catch (error) {
      this.handleError('Error updating form config', error);
      throw error;
    }
  }

  async resetToDefault() {
    try {
      await this.updateConfig(defaultConfig);
      return true;
    } catch (error) {
      this.handleError('Error resetting form config', error);
      throw error;
    }
  }

  validateConfig(config) {
    const errors = [];
    
    if (!config?.sections?.length) {
      return { isValid: false, errors: ['Configuration must include sections'] };
    }

    // Validate unique section IDs
    const sectionIds = new Set();
    const fieldIds = new Set();

    config.sections.forEach(section => {
      // Check section structure
      if (!section.id || !section.title || !Array.isArray(section.fields)) {
        errors.push(`Invalid section structure: ${section.id || 'unknown'}`);
        return;
      }

      // Check for duplicate section IDs
      if (sectionIds.has(section.id)) {
        errors.push(`Duplicate section ID: ${section.id}`);
      }
      sectionIds.add(section.id);

      // Validate fields
      section.fields.forEach(field => {
        // Check field structure
        if (!this.validateFieldStructure(field)) {
          errors.push(`Invalid field structure in section ${section.id}: ${field.id || 'unknown'}`);
          return;
        }

        // Check for duplicate field IDs
        if (fieldIds.has(field.id)) {
          errors.push(`Duplicate field ID: ${field.id}`);
        }
        fieldIds.add(field.id);

        // Validate field type and validation rules
        const fieldErrors = this.validateFieldConfiguration(field);
        errors.push(...fieldErrors);
      });
    });

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  validateFieldStructure(field) {
    return field.id && 
           field.label && 
           field.type &&
           typeof field.required === 'boolean';
  }

  validateFieldConfiguration(field) {
    const errors = [];
    const allowedTypes = ['text', 'tel', 'email', 'url', 'number', 'date', 'color', 'file'];
    
    // Validate field type
    if (!allowedTypes.includes(field.type)) {
      errors.push(`Invalid field type for ${field.id}: ${field.type}`);
    }

    // Validate validation rules if present
    if (field.validation) {
      const validationErrors = this.validateFieldValidation(field);
      errors.push(...validationErrors);
    }

    return errors;
  }

  validateFieldValidation(field) {
    const errors = [];
    const { validation } = field;

    // Type-specific validation
    switch (field.type) {
      case 'text':
      case 'tel':
      case 'email':
      case 'url':
        if (validation.minLength && typeof validation.minLength !== 'number') {
          errors.push(`Invalid minLength for ${field.id}`);
        }
        if (validation.maxLength && typeof validation.maxLength !== 'number') {
          errors.push(`Invalid maxLength for ${field.id}`);
        }
        if (validation.pattern) {
          try {
            new RegExp(validation.pattern);
          } catch {
            errors.push(`Invalid pattern for ${field.id}`);
          }
        }
        break;

      case 'file':
        if (validation.maxSize && typeof validation.maxSize !== 'number') {
          errors.push(`Invalid maxSize for ${field.id}`);
        }
        if (validation.acceptedTypes && !Array.isArray(validation.acceptedTypes)) {
          errors.push(`Invalid acceptedTypes for ${field.id}`);
        }
        break;

      case 'date':
        if (validation.min && !(new Date(validation.min)).getTime()) {
          errors.push(`Invalid min date for ${field.id}`);
        }
        if (validation.max && !(new Date(validation.max)).getTime()) {
          errors.push(`Invalid max date for ${field.id}`);
        }
        break;
    }

    // Validate transform function if present
    if (validation.transform && typeof validation.transform !== 'function') {
      errors.push(`Invalid transform function for ${field.id}`);
    }

    return errors;
  }

  async validateFieldValue(field, value) {
    if (!field.validation) return { isValid: true };

    const errors = [];
    const { validation } = field;

    // Apply transform if present
    if (validation.transform && typeof validation.transform === 'function') {
      try {
        value = validation.transform(value);
      } catch (error) {
        return { isValid: false, errors: ['Transform function failed'] };
      }
    }

    // Required check
    if (field.required && !value) {
      errors.push('Field is required');
    }

    if (value) {
      // Length checks
      if (validation.minLength && value.length < validation.minLength) {
        errors.push(`Minimum length is ${validation.minLength}`);
      }
      if (validation.maxLength && value.length > validation.maxLength) {
        errors.push(`Maximum length is ${validation.maxLength}`);
      }

      // Pattern check
      if (validation.pattern) {
        const regex = new RegExp(validation.pattern);
        if (!regex.test(value)) {
          errors.push(validation.message || 'Invalid format');
        }
      }

      // Type-specific validation
      switch (field.type) {
        case 'file':
          if (validation.maxSize && value.size > validation.maxSize) {
            errors.push(`File size must be less than ${validation.maxSize / 1024 / 1024}MB`);
          }
          if (validation.acceptedTypes && !validation.acceptedTypes.includes(value.type)) {
            errors.push(`File type must be one of: ${validation.acceptedTypes.join(', ')}`);
          }
          break;

        case 'date':
          const dateValue = new Date(value);
          if (validation.min && dateValue < new Date(validation.min)) {
            errors.push(`Date must be after ${validation.min}`);
          }
          if (validation.max && dateValue > new Date(validation.max)) {
            errors.push(`Date must be before ${validation.max}`);
          }
          break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      transformedValue: value
    };
  }

  handleError(message, error, context = {}) {
    console.error(message, {
      error: error.message,
      stack: error.stack,
      cacheKey: this.CACHE_KEY,
      context,
      timestamp: new Date().toISOString()
    });
  }
}

// Create and initialize service
const formConfigService = new FormConfigService();

module.exports = formConfigService;