const PRICING = {
  BASE_PRICE_PER_DOCTOR: 4999.99,
  YEARLY_DISCOUNT_PERCENTAGE: 12,
  VOLUME_DISCOUNTS: [
    { minDoctors: 10, discount: 10 },
    { minDoctors: 20, discount: 15 },
    { minDoctors: 50, discount: 20 },
  ]
};

const LIMITS = {
  MIN_DOCTORS: 1,
  MAX_DOCTORS: 100
};

const BILLING_CYCLE = {
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY'
};
const calculatePrice = (doctorCount, billingCycle) => {
  console.log('Calculating subscription price---------------------->>>>>>', doctorCount, billingCycle);
  const basePriceTotal = PRICING.BASE_PRICE_PER_DOCTOR * doctorCount;

  // Apply volume discount
  let volumeDiscount = 0;
  for (const tier of PRICING.VOLUME_DISCOUNTS) {
    if (doctorCount >= tier.minDoctors) {
      volumeDiscount = tier.discount;
    }
  }

  const volumeDiscountAmount = (basePriceTotal * volumeDiscount) / 100;
  const priceAfterVolumeDiscount = basePriceTotal - volumeDiscountAmount;

  // Apply yearly discount if applicable
  let finalPrice = priceAfterVolumeDiscount;

  if (billingCycle === BILLING_CYCLE.YEARLY) {
    const yearlyDiscountAmount = (priceAfterVolumeDiscount * PRICING.YEARLY_DISCOUNT_PERCENTAGE) / 100;
    finalPrice = (priceAfterVolumeDiscount - yearlyDiscountAmount) * 12;
  }

  return Math.round(finalPrice * 100) / 100;
};
  console.log("--------------------------------",calculatePrice(10, 'YEARLY')); // Example usage