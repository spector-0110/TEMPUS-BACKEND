/**
 * Represents the features available in a subscription plan
 * @interface SubscriptionPlanFeatures
 */
export interface SubscriptionPlanFeatures {
  /** Maximum number of doctors allowed in the plan */
  max_doctors: number;
  /** Base SMS credits provided with the plan */
  base_sms_credits: number;
  /** Base email credits provided with the plan */
  base_email_credits: number;
  /** Whether analytics access is enabled */
  analytics_access: boolean;
  /** Whether reporting access is enabled */
  reporting_access: boolean;
  /** Whether premium support is included */
  premium_support: boolean;
  /** Whether custom branding is allowed */
  custom_branding: boolean;
  /** Additional features included in the plan */
  additional_features: string[];
}

/**
 * Type guard to check if an object is a valid SubscriptionPlanFeatures
 */
export function isValidSubscriptionPlanFeatures(features: any): features is SubscriptionPlanFeatures {
  return (
    typeof features === 'object' &&
    features !== null &&
    typeof features.max_doctors === 'number' &&
    typeof features.base_sms_credits === 'number' &&
    typeof features.base_email_credits === 'number' &&
    typeof features.analytics_access === 'boolean' &&
    typeof features.reporting_access === 'boolean' &&
    typeof features.premium_support === 'boolean' &&
    typeof features.custom_branding === 'boolean' &&
    Array.isArray(features.additional_features) &&
    features.additional_features.every(feature => typeof feature === 'string')
  );
}

/**
 * Represents a subscription plan
 * @interface SubscriptionPlan
 */
export interface SubscriptionPlan {
  id: string;
  name: string;
  description?: string | null;
  monthlyPrice: number;
  yearlyPrice: number;
  features: SubscriptionPlanFeatures;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

/**
 * Represents a hospital's subscription
 * @interface HospitalSubscription
 */
export interface HospitalSubscription {
  id: string;
  hospitalId: string;
  planId: string;
  billingCycle: 'MONTHLY' | 'YEARLY';
  startDate: Date;
  endDate: Date;
  planFeatures: SubscriptionPlanFeatures;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
  lastNotifiedAt?: Date | null;
  autoRenew: boolean;
  paymentMethod?: string | null;
  paymentDetails?: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Represents a subscription history entry
 * @interface SubscriptionHistory
 */
export interface SubscriptionHistory {
  id: string;
  subscriptionId: string;
  hospitalId: string;
  planId: string;
  billingCycle: 'MONTHLY' | 'YEARLY';
  priceAtTime: number;
  startDate: Date;
  endDate: Date;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
  planFeatures: SubscriptionPlanFeatures;
  paymentMethod?: string | null;
  paymentDetails?: Record<string, any> | null;
  createdBy?: string | null;
  createdAt: Date;
}