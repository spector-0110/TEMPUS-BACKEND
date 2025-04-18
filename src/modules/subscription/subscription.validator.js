const { 
  SUBSCRIPTION_STATUS, 
  BILLING_CYCLE,
  MIN_SUBSCRIPTION_PRICE,
  MAX_DOCTORS_PER_PLAN
} = require('./subscription.constants');

class SubscriptionValidator {
  validatePlanData(data, isUpdate = false) {
    const errors = [];

    // For updates, we don't require all fields
    if (!isUpdate) {
      if (!data.name?.trim()) {
        errors.push('Plan name is required');
      }
      if (!data.maxDoctors) {
        errors.push('Maximum number of doctors is required');
      }
      if (data.monthlyPrice === undefined && data.yearlyPrice === undefined) {
        errors.push('At least one pricing option (monthly or yearly) is required');
      }
    }

    // Validate provided fields
    if (data.name !== undefined && !data.name.trim()) {
      errors.push('Plan name cannot be empty');
    }

    if (data.monthlyPrice !== undefined) {
      if (!Number.isInteger(data.monthlyPrice)) {
        errors.push('Monthly price must be an integer (in cents)');
      }
      if (data.monthlyPrice < MIN_SUBSCRIPTION_PRICE) {
        errors.push('Monthly price cannot be negative');
      }
    }

    if (data.yearlyPrice !== undefined) {
      if (!Number.isInteger(data.yearlyPrice)) {
        errors.push('Yearly price must be an integer (in cents)');
      }
      if (data.yearlyPrice < MIN_SUBSCRIPTION_PRICE) {
        errors.push('Yearly price cannot be negative');
      }
    }

    if (data.maxDoctors !== undefined) {
      if (!Number.isInteger(data.maxDoctors)) {
        errors.push('Maximum doctors must be an integer');
      }
      if (data.maxDoctors <= 0) {
        errors.push('Maximum doctors must be greater than 0');
      }
      if (data.maxDoctors > MAX_DOCTORS_PER_PLAN) {
        errors.push(`Maximum doctors cannot exceed ${MAX_DOCTORS_PER_PLAN}`);
      }
    }

    if (data.features !== undefined) {
      if (!Array.isArray(data.features)) {
        errors.push('Features must be an array');
      } else {
        data.features.forEach((feature, index) => {
          if (!feature.name) {
            errors.push(`Feature at index ${index} must have a name`);
          }
          if (feature.isEnabled === undefined) {
            errors.push(`Feature at index ${index} must specify isEnabled`);
          }
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  validateSubscriptionData(data) {
    const errors = [];

    if (!data.hospitalId) {
      errors.push('Hospital ID is required');
    }

    if (!data.planId) {
      errors.push('Plan ID is required');
    }

    if (!data.billingCycle) {
      errors.push('Billing cycle is required');
    } else if (!Object.values(BILLING_CYCLE).includes(data.billingCycle)) {
      errors.push('Invalid billing cycle');
    }

    if (data.startDate && !(new Date(data.startDate)).getTime()) {
      errors.push('Invalid start date');
    }

    if (data.endDate && !(new Date(data.endDate)).getTime()) {
      errors.push('Invalid end date');
    }

    if (data.startDate && data.endDate) {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      if (end <= start) {
        errors.push('End date must be after start date');
      }
    }

    if (data.status && !Object.values(SUBSCRIPTION_STATUS).includes(data.status)) {
      errors.push('Invalid subscription status');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  validateUsageUpdate(data) {
    const errors = [];

    if (!data.hospitalId) {
      errors.push('Hospital ID is required');
    }

    if (!data.subscriptionId) {
      errors.push('Subscription ID is required');
    }

    if (data.doctorsCount !== undefined) {
      if (!Number.isInteger(data.doctorsCount)) {
        errors.push('Doctors count must be an integer');
      }
      if (data.doctorsCount < 0) {
        errors.push('Doctors count cannot be negative');
      }
    }

    if (data.smsUsed !== undefined) {
      if (!Number.isInteger(data.smsUsed)) {
        errors.push('SMS usage must be an integer');
      }
      if (data.smsUsed < 0) {
        errors.push('SMS usage cannot be negative');
      }
    }

    if (data.emailsUsed !== undefined) {
      if (!Number.isInteger(data.emailsUsed)) {
        errors.push('Email usage must be an integer');
      }
      if (data.emailsUsed < 0) {
        errors.push('Email usage cannot be negative');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = new SubscriptionValidator();