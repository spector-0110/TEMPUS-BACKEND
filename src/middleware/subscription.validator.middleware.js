const subscriptionValidator = require('../modules/subscription/subscription.validator');

const validate = (schema) => {
    return (req, res, next) => {
      const bodySchema = schema.body;
      const querySchema = schema.query;
      const paramsSchema = schema.params;
  
      try {
        if (bodySchema) {
          const { error } = bodySchema.validate(req.body);
          if (error) throw error;
        }
        if (querySchema) {
          const { error } = querySchema.validate(req.query);
          if (error) throw error;
        }
        if (paramsSchema) {
          const { error } = paramsSchema.validate(req.params);
          if (error) throw error;
        }
  
        next();
      } catch (error) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.details.map((detail) => ({
            field: detail.path.join('.'),
            message: detail.message,
          })),
        });
      }
    };
  };
const subscriptionValidation = {
  validateCreateSubscription: validate(subscriptionValidator.createSubscription.body),
  validateCreateRenewSubscription: validate(subscriptionValidator.createRenewSubscription.body),
};
module.exports = subscriptionValidation;
