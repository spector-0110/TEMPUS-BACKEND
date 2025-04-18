# Tempus Backend API

A robust Node.js backend service for hospital management with features like subscription management, appointment scheduling, and notification handling.

## 🚀 Tech Stack

- **Node.js & Express**: Backend server framework
- **PostgreSQL & Prisma**: Database and ORM
- **Redis**: Caching and rate limiting
- **RabbitMQ**: Message queue for async processing
- **Supabase**: Authentication and user management
- **Nodemailer**: Email notifications

## 📋 Prerequisites

- Node.js (v16 or higher)
- PostgreSQL
- Redis
- RabbitMQ
- Supabase account

## 🛠 Installation & Setup

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Fill in required environment variables

4. Set up the database:
```bash
npx prisma generate
npx prisma db push
```

5. Start the server:
```bash
# Development
npm run dev

# Production
npm start
```

## 🔑 Environment Variables

Required environment variables in `.env`:

```env
# Database
DATABASE_URL=postgresql://user:password@host:port/db
DIRECT_URL=postgresql://user:password@host:port/db

# Supabase
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_CLUSTER_MODE=false
REDIS_CLUSTER_NODES=redis://localhost:6379
REDIS_LOG_LEVEL=INFO

# RabbitMQ Configuration
RABBITMQ_URL=amqp://localhost
RABBITMQ_CLUSTER_NODES=amqp://node1:5672
RABBITMQ_LOG_LEVEL=INFO

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-specific-password
```

## 🏗 Architecture

### Core Services

1. **Database Service**
   - PostgreSQL with Prisma ORM
   - Handles all database operations
   - Connection pooling and retry mechanisms

2. **Redis Service**
   - Caching layer
   - Rate limiting
   - Session management
   - Circuit breaker implementation

3. **RabbitMQ Service**
   - Message queue management
   - Handles async operations
   - Notification distribution
   - Task scheduling

4. **Mail Service**
   - Email notifications
   - OTP delivery
   - Rate limiting per hospital
   - HTML sanitization

### API Routes

#### 🏥 Hospital Management
- `POST /api/hospitals/initial-details`: Create new hospital
- `GET /api/hospitals/details`: Get hospital details
- `GET /api/hospitals/dashboard`: Get dashboard statistics
- `POST /api/hospitals/request-edit-verification`: Request OTP for editing
- `POST /api/hospitals/verify-edit-otp`: Verify edit OTP
- `PUT /api/hospitals/update`: Update hospital details

#### 📊 Subscription Management
- `GET /api/subscriptions/plans`: List all subscription plans
- `POST /api/subscriptions/plans`: Create new plan (Super Admin)
- `PUT /api/subscriptions/plans/:id`: Update plan (Super Admin)
- `DELETE /api/subscriptions/plans/:id`: Delete plan (Super Admin)

### 🔐 Authentication & Authorization

- Supabase authentication integration
- JWT token validation
- Role-based access control
- Super admin middleware for privileged operations

### 📫 Notification System

The application implements a robust notification system using:
- RabbitMQ for message queuing
- Redis for rate limiting
- Email notifications via Nodemailer
- OTP system for secure operations

### 💾 Data Models

Key data models in the system:

1. **Hospital**
   - Basic information
   - Contact details
   - Branding (logo, theme)
   - Subscription management

2. **Subscription Plans**
   - Pricing tiers
   - Feature limits
   - Duration options

3. **Doctor**
   - Personal information
   - Specialization
   - Schedule management

4. **Appointments**
   - Scheduling
   - Status tracking
   - Notification management

## 🔄 Caching Strategy

- Redis-based caching for:
  - Subscription plans
  - Hospital details
  - Session data
  - Rate limiting

## 📨 Message Queue Patterns

- Appointment reminders
- Email notifications
- SMS notifications
- Subscription updates

## 🛡️ Security Features

1. **Authentication**
   - Supabase JWT validation
   - Role-based access control
   - OTP verification for sensitive operations

2. **Rate Limiting**
   - API rate limiting
   - Notification rate limiting per hospital
   - Failed attempt tracking

3. **Data Validation**
   - Input sanitization
   - Schema validation
   - HTML sanitization for emails

## 🚦 Health Monitoring

- `/health` endpoint for service status
- Detailed health checks for:
  - Database connectivity
  - Redis connection
  - RabbitMQ status
  - Email service status

## 🔄 Scaling Considerations

- Redis cluster support
- RabbitMQ cluster configuration
- Database connection pooling
- Circuit breaker patterns

## 🧪 Error Handling

- Centralized error handling
- Circuit breaker implementation
- Retry mechanisms
- Graceful degradation

## 📈 Future Enhancements

1. **Analytics**
   - Advanced dashboard metrics
   - Usage tracking
   - Performance monitoring

2. **Integration**
   - SMS gateway integration
   - Payment gateway integration
   - Third-party calendar sync

3. **Features**
   - Bulk operations
   - Advanced reporting
   - Custom notification templates

## 📝 License

[MIT License](LICENSE)