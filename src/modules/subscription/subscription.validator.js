const { 
  SUBSCRIPTION_STATUS, 
  BILLING_CYCLE,
  MIN_SUBSCRIPTION_PRICE,
  MAX_DOCTORS_PER_PLAN,
  FEATURE_LIMITS
} = require('./subscription.constants');

const Joi = require('joi');

/**
 * Validates subscription plan features structure
 */
const validatePlanFeatures = Joi.object({
  max_doctors: Joi.number()
    .required()
    .min(FEATURE_LIMITS.MIN_DOCTORS)
    .max(FEATURE_LIMITS.MAX_DOCTORS),
  base_sms_credits: Joi.number()
    .required()
    .min(FEATURE_LIMITS.MIN_SMS_CREDITS)
    .max(FEATURE_LIMITS.MAX_SMS_CREDITS),
  base_email_credits: Joi.number()
    .required()
    .min(FEATURE_LIMITS.MIN_EMAIL_CREDITS)
    .max(FEATURE_LIMITS.MAX_EMAIL_CREDITS),
  analytics_access: Joi.boolean().required(),
  reporting_access: Joi.boolean().required(),
  premium_support: Joi.boolean().required(),
  custom_branding: Joi.boolean().required(),
  additional_features: Joi.array().items(Joi.string())
});

/**
 * Schema for creating a new subscription plan
 */
const createSubscriptionPlanSchema = Joi.object({
  name: Joi.string().required().trim(),
  description: Joi.string().allow('', null),
  monthlyPrice: Joi.number().required().min(MIN_SUBSCRIPTION_PRICE).precision(2),
  yearlyPrice: Joi.number().required().min(MIN_SUBSCRIPTION_PRICE).precision(2),
  features: validatePlanFeatures.required()
});

/**
 * Schema for updating an existing subscription plan
 */
const updateSubscriptionPlanSchema = Joi.object({
  name: Joi.string().trim(),
  description: Joi.string().allow('', null),
  monthlyPrice: Joi.number().min(MIN_SUBSCRIPTION_PRICE).precision(2),
  yearlyPrice: Joi.number().min(MIN_SUBSCRIPTION_PRICE).precision(2),
  features: validatePlanFeatures,
  isActive: Joi.boolean()
}).min(1); // At least one field must be provided for update

class SubscriptionValidator {
  
  validatePlanData(data, isUpdate = false) {
    // Use appropriate schema based on operation type
    const schema = isUpdate ? updateSubscriptionPlanSchema : createSubscriptionPlanSchema;
    const validation = schema.validate(data, { abortEarly: false });

    if (validation.error) {
      return {
        isValid: false,
        errors: validation.error.details.map(err => err.message)
      };
    }

    return {
      isValid: true,
      data: validation.value
    };
  }

  validateSubscriptionData(data) {
    const schema = Joi.object({
      hospitalId: Joi.string().uuid().required(),
      planId: Joi.string().uuid().required(),
      billingCycle: Joi.string().valid(...Object.values(BILLING_CYCLE)).required(),
      startDate: Joi.date().iso().required(),
      endDate: Joi.date().iso().greater(Joi.ref('startDate')).required(),
      status: Joi.string().valid(...Object.values(SUBSCRIPTION_STATUS)).default(SUBSCRIPTION_STATUS.PENDING),
      autoRenew: Joi.boolean().default(true),
      paymentMethod: Joi.string().allow('', null),
      paymentDetails: Joi.object().allow(null)
    });

    const validation = schema.validate(data, { abortEarly: false });

    if (validation.error) {
      return {
        isValid: false,
        errors: validation.error.details.map(err => err.message)
      };
    }

    return {
      isValid: true,
      data: validation.value
    };
  }

  validateUsageUpdate(data) {
    const schema = Joi.object({
      hospitalId: Joi.string().uuid().required(),
      subscriptionId: Joi.string().uuid().required(),
      doctorsCount: Joi.number().integer().min(0).max(FEATURE_LIMITS.MAX_DOCTORS),
      smsUsed: Joi.number().integer().min(0),
      emailsUsed: Joi.number().integer().min(0)
    }).min(3); // Must include at least hospitalId, subscriptionId, and one usage metric

    const validation = schema.validate(data, { abortEarly: false });

    if (validation.error) {
      return {
        isValid: false,
        errors: validation.error.details.map(err => err.message)
      };
    }

    return {
      isValid: true,
      data: validation.value
    };
  }
}

module.exports = new SubscriptionValidator();