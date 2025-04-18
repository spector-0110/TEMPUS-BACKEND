# Technical Documentation: Tempus Backend

## 🔄 Core Service Flow

### Authentication Flow
```
Client Request → auth.middleware.js → Supabase JWT Validation → Hospital ID Lookup → Route Handler
```

1. **Auth Middleware (`auth.middleware.js`)**
   - Extracts Bearer token from Authorization header
   - Validates token with Supabase
   - Attaches user and hospital_id to request object
   - Skips hospital_id lookup for initial registration

### Hospital Management Flow
```
Request → Auth Middleware → Hospital Controller → Service Layer → Database/Cache → Response
```

1. **Hospital Creation (`hospital.controller.js`)**
   ```javascript
   createHospital:
   Request → Validate Input → Check Existing → Transaction:
     1. Create Hospital Record
     2. Send Welcome Email (via RabbitMQ)
   ```

2. **Hospital Update Flow**
   ```
   Update Request → Auth → OTP Verification → Update → Cache Invalidation
   ```
   - Uses Redis for OTP storage
   - Implements rate limiting for OTP requests
   - Validates edit permissions

### Subscription Management Flow
```
Request → Auth → Super Admin Check → Subscription Controller → Cache/DB → Response
```

## 🔧 Critical Code Sections Explained

### 1. Database Connection Pool (`database.service.js`)
```javascript
// Key Concepts:
- Singleton pattern for Prisma client
- Connection pooling with retry mechanism
- Graceful shutdown handling
```

**Critical Functions:**
- `getPrismaInstance()`: Manages single instance
- `testConnection()`: Health check
- `disconnect()`: Cleanup connections

### 2. Redis Service (`redis.service.js`)
```javascript
// Key Concepts:
- Circuit breaker pattern
- Pool management
- Error handling with retries
```

**Critical Methods:**
- `executeWithCircuitBreaker()`: Prevents cascade failures
- `getClient()`: Pool management
- `setCache()/getCache()`: Main caching operations

### 3. RabbitMQ Service (`rabbitmq.service.js`)
```javascript
// Key Concepts:
- Channel pooling
- Message persistence
- Dead letter exchanges
```

**Critical Operations:**
- Channel management
- Queue declaration
- Message publishing with retries

### 4. Message Processing (`messageProcessor.js`)
```javascript
// Key Concepts:
- Message queue consumers
- Task distribution
- Notification handling
```

**Queue Types:**
1. `tasks`: General background jobs
2. `notifications`: User notifications
3. `email_notifications`: Email queue
4. `sms_notifications`: SMS queue

## 🔐 Security Implementation

### 1. OTP Service (`otp.service.js`)
```javascript
// Features:
- 6-digit OTP generation
- Redis-based storage
- 5-minute expiry
- 3 max attempts
```

### 2. Rate Limiting
```javascript
// Implemented in:
- Email notifications
- OTP requests
- API endpoints
```

## 💾 Data Models & Relationships

### Hospital
```prisma
model Hospital {
  id: UUID
  supabaseUserId: UUID
  name: String
  // ...other fields
  
  // Relationships
  doctors: Doctor[]
  appointments: Appointment[]
  subscriptions: HospitalSubscription[]
}
```

### Doctor
```prisma
model Doctor {
  id: UUID
  hospitalId: UUID
  // ...other fields
  
  // Relationships
  schedules: DoctorSchedule[]
  appointments: Appointment[]
  visitNotes: VisitNote[]
}
```

## 🚀 Performance Optimizations

### 1. Caching Strategy
```javascript
// Types of Caching:
1. Subscription Plans (24h TTL)
2. Hospital Details (Variable TTL)
3. OTP Storage (5m TTL)
4. Rate Limit Data (1h TTL)
```

### 2. Database Optimizations
```sql
-- Key Indexes:
- Hospital: supabaseUserId, subdomain
- Doctor: hospitalId
- Appointment: hospitalId, doctorId
```

## 🔄 Message Queue Patterns

### 1. Email Notifications
```javascript
Flow:
Request → RabbitMQ → Email Consumer → Nodemailer → Status Update
```

### 2. Appointment Reminders
```javascript
Flow:
Scheduled Task → Delayed Queue → Notification Service → Email/SMS
```

## 🧪 Error Handling Patterns

### 1. Circuit Breaker (Redis)
```javascript
States:
CLOSED → (failures) → OPEN → (timeout) → HALF-OPEN → (success) → CLOSED
```

### 2. Retry Mechanism
```javascript
Strategy:
- Exponential backoff
- Max retry count
- Jitter implementation
```

## 📡 API Response Patterns

### Success Response
```javascript
{
  data: {}, // Response data
  message: "Operation successful"
}
```

### Error Response
```javascript
{
  error: "Error message",
  code: "ERROR_CODE",
  details: {} // Optional details
}
```

## 🔍 Debugging Guide

### 1. Service Health Checks
```
GET /health
- Redis status
- RabbitMQ connections
- Database connectivity
- Email service status
```

### 2. Logging Patterns
```javascript
// Log Levels:
ERROR: Critical failures
WARN: Non-critical issues
INFO: Important operations
DEBUG: Detailed debugging
```

### 3. Common Issues

1. **Redis Connection Issues**
   ```javascript
   // Check:
   - Circuit breaker status
   - Connection pool health
   - Redis server status
   ```

2. **RabbitMQ Problems**
   ```javascript
   // Verify:
   - Channel pool status
   - Queue bindings
   - Consumer health
   ```

## 📚 Core Concepts Explained

### 1. Circuit Breaker Pattern
Protects the system from cascading failures by:
- Monitoring failure rates
- Temporarily blocking operations
- Allowing gradual recovery

### 2. Message Queue Architecture
Benefits:
- Asynchronous processing
- Load balancing
- Fault tolerance
- System decoupling

### 3. Connection Pooling
Improves performance by:
- Reusing connections
- Managing resource limits
- Handling connection lifecycle

### 4. Rate Limiting
Protects services by:
- Tracking request frequency
- Implementing cooldown periods
- Preventing abuse

## 🎯 Best Practices

### 1. Error Handling
```javascript
try {
  // Operation
} catch (error) {
  // Log with context
  // Return appropriate status
  // Maintain system state
}
```

### 2. Transaction Management
```javascript
prisma.$transaction(async (tx) => {
  // Atomic operations
  // Rollback on failure
})
```

### 3. Cache Management
```javascript
// Cache then network strategy
const data = await redisService.getCache(key)
if (!data) {
  // Fetch and cache
}
```

## 🛠 Development Workflow

1. **Local Setup**
   ```bash
   npm install
   npx prisma generate
   npx prisma db push
   ```

2. **Service Dependencies**
   - Redis server
   - RabbitMQ server
   - PostgreSQL database
   - Supabase project

3. **Environment Configuration**
   - Copy `.env.example`
   - Configure services
   - Set up email credentials

## 🔍 Testing Guidelines

1. **Health Check**
   ```bash
   curl localhost:8000/health
   ```

2. **API Testing**
   ```bash
   # Required headers
   Authorization: Bearer <token>
   Content-Type: application/json
   ```

3. **Common Test Cases**
   - Authentication flow
   - Rate limiting
   - Error responses
   - Data validation

## 🚨 Monitoring

### 1. Service Metrics
- Connection pool status
- Queue lengths
- Cache hit rates
- Error frequencies

### 2. Performance Metrics
- Response times
- Database query times
- Queue processing rates
- Cache efficiency

## 🔄 Continuous Integration

### Pre-deployment Checks
1. Database migrations
2. Environment variables
3. Service dependencies
4. Security validations

### Post-deployment Verification
1. Health check status
2. Service connectivity
3. Queue operations
4. Cache functionality