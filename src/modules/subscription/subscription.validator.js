const Joi = require('joi');
const { BILLING_CYCLE, LIMITS } = require('./subscription.constants');

const paymentSchema = Joi.object({
  paymentMethod: Joi.string().required(),
  paymentDetails: Joi.object({
    cardNumber: Joi.string().optional(),
    upiId: Joi.string().optional(),
    bankAccount: Joi.string().optional(),
    bankName: Joi.string().optional()
  }).required()
});

const subscriptionValidator = {
  createSubscription: {
    body: Joi.object({
      hospitalId: Joi.string().required(),
      doctorCount: Joi.number()
        .integer()
        .min(LIMITS.MIN_DOCTORS)
        .max(LIMITS.MAX_DOCTORS)
        .required(),
      billingCycle: Joi.string()
        .valid(...Object.values(BILLING_CYCLE))
        .required(),
      paymentMethod: Joi.string().required(),
      paymentDetails: Joi.object().required()
    })
  },

  updateDoctorCount: {
    body: Joi.object({
      hospitalId: Joi.string().required(),
      newDoctorCount: Joi.number()
        .integer()
        .min(LIMITS.MIN_DOCTORS)
        .max(LIMITS.MAX_DOCTORS)
        .required(),
      billingCycle: Joi.string()
        .valid(...Object.values(BILLING_CYCLE))
        .optional(),
      paymentMethod: Joi.string().optional(),
      paymentDetails: Joi.object().optional()
    })
  },

  renewSubscription: {
    body: Joi.object({
      hospitalId: Joi.string().required(),
      billingCycle: Joi.string()
        .valid(...Object.values(BILLING_CYCLE))
        .required(),
      paymentMethod: Joi.string().required(),
      paymentDetails: Joi.object().required()
    })
  },

  cancelSubscription: {
    body: Joi.object({
      hospitalId: Joi.string().required()
    })
  }
};

module.exports = subscriptionValidator;