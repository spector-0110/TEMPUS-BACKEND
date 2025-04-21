# Subscription Management System

## Overview
The Subscription Management System provides a comprehensive solution for managing hospital subscriptions, including creating, updating, renewing, and canceling subscriptions. The system includes automatic price calculations, volume discounts, and subscription history tracking.

## Features
- Flexible subscription plans (Monthly/Yearly)
- Volume-based pricing with automatic discounts
- Subscription history tracking
- Cache-enabled for performance
- Secure endpoints with authentication
- Real-time price calculations
- Automatic discount application

## Pricing Structure
### Base Price
- $99.99 per doctor per month

### Volume Discounts
- 50+ doctors: 10% discount
- 100+ doctors: 15% discount
- 200+ doctors: 20% discount

### Billing Cycle Discounts
- Yearly subscription: Additional 20% discount

## API Endpoints

### 1. Create Subscription
**Endpoint:** `POST /api/subscriptions/create`

Creates a new subscription for a hospital.

```json
// Request
{
  "hospitalId": "550e8400-e29b-41d4-a716-446655440000",
  "doctorCount": 10,
  "billingCycle": "MONTHLY"
}

// Response
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "hospitalId": "550e8400-e29b-41d4-a716-446655440000",
    "doctorCount": 10,
    "billingCycle": "MONTHLY",
    "startDate": "2025-04-21T00:00:00.000Z",
    "endDate": "2025-05-21T00:00:00.000Z",
    "totalPrice": 899.91,
    "status": "ACTIVE",
    "autoRenew": true,
    "createdAt": "2025-04-21T00:00:00.000Z",
    "updatedAt": "2025-04-21T00:00:00.000Z"
  }
}
```

### 2. Update Doctor Count
**Endpoint:** `PUT /api/subscriptions/update-doctors`

Updates the number of doctors in an existing subscription.

```json
// Request
{
  "hospitalId": "550e8400-e29b-41d4-a716-446655440000",
  "newDoctorCount": 15,
  "billingCycle": "MONTHLY"
}

// Response
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "hospitalId": "550e8400-e29b-41d4-a716-446655440000",
    "doctorCount": 15,
    "billingCycle": "MONTHLY",
    "startDate": "2025-04-21T00:00:00.000Z",
    "endDate": "2025-05-21T00:00:00.000Z",
    "totalPrice": 1349.86,
    "status": "ACTIVE",
    "autoRenew": true,
    "updatedAt": "2025-04-21T00:00:00.000Z"
  }
}
```

### 3. Renew Subscription
**Endpoint:** `POST /api/subscriptions/renew`

Renews an existing subscription with optional billing cycle change.

```json
// Request
{
  "hospitalId": "550e8400-e29b-41d4-a716-446655440000",
  "billingCycle": "YEARLY"
}

// Response
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "hospitalId": "550e8400-e29b-41d4-a716-446655440000",
    "doctorCount": 15,
    "billingCycle": "YEARLY",
    "startDate": "2025-04-21T00:00:00.000Z",
    "endDate": "2026-04-21T00:00:00.000Z",
    "totalPrice": 12958.56,
    "status": "ACTIVE",
    "autoRenew": true,
    "updatedAt": "2025-04-21T00:00:00.000Z"
  }
}
```

### 4. Cancel Subscription
**Endpoint:** `POST /api/subscriptions/cancel`

Cancels an active subscription.

```json
// Request
{
  "hospitalId": "550e8400-e29b-41d4-a716-446655440000"
}

// Response
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "hospitalId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "CANCELLED",
    "updatedAt": "2025-04-21T00:00:00.000Z"
  }
}
```

### 5. Get Current Subscription
**Endpoint:** `GET /api/subscriptions/current/:hospitalId`

Retrieves the current active subscription for a hospital.

```json
// Response
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "hospitalId": "550e8400-e29b-41d4-a716-446655440000",
    "doctorCount": 15,
    "billingCycle": "YEARLY",
    "startDate": "2025-04-21T00:00:00.000Z",
    "endDate": "2026-04-21T00:00:00.000Z",
    "totalPrice": 12958.56,
    "status": "ACTIVE",
    "autoRenew": true,
    "createdAt": "2025-04-21T00:00:00.000Z",
    "updatedAt": "2025-04-21T00:00:00.000Z"
  }
}
```

### 6. Get Subscription History
**Endpoint:** `GET /api/subscriptions/history/:hospitalId`

Retrieves the subscription history for a hospital.

```json
// Response
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "subscriptionId": "550e8400-e29b-41d4-a716-446655440000",
      "hospitalId": "550e8400-e29b-41d4-a716-446655440000",
      "doctorCount": 15,
      "billingCycle": "YEARLY",
      "totalPrice": 12958.56,
      "startDate": "2025-04-21T00:00:00.000Z",
      "endDate": "2026-04-21T00:00:00.000Z",
      "status": "ACTIVE",
      "createdAt": "2025-04-21T00:00:00.000Z"
    }
  ]
}
```

## Subscription States
- **ACTIVE**: Current working subscription
- **CANCELLED**: Manually terminated subscription
- **EXPIRED**: Past-due subscription
- **SUSPENDED**: Temporarily disabled subscription

## Validation Rules
1. Doctor Count:
   - Minimum: 1 doctor
   - Maximum: 1000 doctors
2. Billing Cycle:
   - MONTHLY
   - YEARLY
3. Hospital ID must be a valid UUID
4. All date fields use ISO 8601 format
5. Prices are rounded to 2 decimal places

## Error Handling
All endpoints return standardized error responses:
```json
{
  "success": false,
  "error": "Error message description"
}
```

Common error scenarios:
- Invalid hospital ID
- No active subscription found
- Doctor count limits exceeded
- Invalid billing cycle
- Duplicate active subscription
- Authentication failures

## Authentication
All endpoints require a valid JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

## Caching
- Subscription data is cached for 1 hour
- Cache is automatically invalidated on subscription updates
- Cache key format: `hospital:subscription:<hospitalId>`

## Example Price Calculations

### Monthly Subscription
1. Base case (10 doctors):
   - 10 × $99.99 = $999.90/month

2. With volume discount (50 doctors):
   - 50 × $99.99 = $4,999.50
   - 10% discount: $4,499.55/month

### Yearly Subscription
1. Base case (10 doctors):
   - Monthly: 10 × $99.99 = $999.90
   - Yearly: $999.90 × 12 = $11,998.80
   - 20% yearly discount: $9,599.04/year

2. With volume discount (50 doctors):
   - Monthly with 10% volume discount: $4,499.55
   - Yearly: $4,499.55 × 12 = $53,994.60
   - 20% yearly discount: $43,195.68/year

## Technical Implementation
- Node.js backend with Express
- PostgreSQL database with Prisma ORM
- Redis for caching
- JWT authentication
- Transaction support for data consistency
- Automated subscription status updates
- Event-driven architecture for notifications