# Advanced Patient Queue Management System

## Overview

This system provides a comprehensive, real-time queue management solution for patient appointment tracking. It handles dynamic scenarios like early arrivals, no-shows, appointment overlaps, and provides real-time updates through WebSocket connections.

## Core Features

### 1. Real-time Queue Position Tracking
- **Live Position Updates**: Patients can see their current position in the queue
- **Estimated Wait Time**: Dynamic calculation based on current queue status
- **Queue Status Messages**: Human-readable status updates
- **Real-time Notifications**: WebSocket-powered instant updates

### 2. Slot-based Scheduling (1-hour slots)
- **Time Slot Management**: Appointments are organized into 1-hour time slots
- **Overlap Handling**: Multiple appointments in the same slot are queued internally
- **Slot Optimization**: Suggests optimal time slots to minimize conflicts
- **Dynamic Slot Positioning**: Patients are positioned within their time slot

### 3. Dynamic Queue Management
- **Early Arrival Handling**: Manages patients arriving before their scheduled time
- **No-Show Management**: Automatic handling with configurable grace periods
- **Manual Queue Reordering**: Admin ability to manually adjust queue positions
- **Emergency Notifications**: Broadcast urgent messages to all patients in queue

### 4. Token-based Tracking
- **Secure Tracking Links**: JWT tokens containing appointment, hospital, and doctor IDs
- **Persistent Sessions**: Patients can track their appointment from any device
- **Cache-optimized**: Redis caching for fast tracking responses

## API Endpoints

### Public Tracking Endpoints
```
GET /api/appointments/track/:token
- Track appointment and get queue information
- No authentication required
- Returns: appointment details, queue position, estimated wait time

GET /api/appointments/refresh-queue/:token
- Get fresh queue status (bypasses cache)
- No authentication required
- Returns: updated queue information
```

### Queue Management Endpoints (Authenticated)
```
GET /api/appointments/queue/slot-based/:doctorId
- Get slot-organized queue for a doctor
- Query params: ?date=YYYY-MM-DD
- Returns: queue organized by 1-hour time slots

POST /api/appointments/queue/slot-overlaps/:doctorId
- Handle appointment overlaps within time slots
- Body: { slotStartTime, slotEndTime }
- Returns: overlap analysis and queue within slot

GET /api/appointments/queue/slot-position/:appointmentId
- Get position within specific time slot
- Returns: slot-specific queue position

GET /api/appointments/queue/suggest-slots/:doctorId
- Suggest optimal time slots for scheduling
- Query params: ?date=YYYY-MM-DD&preferredHour=14
- Returns: recommended time slots with priority scores

GET /api/appointments/queue/statistics/:doctorId
- Get queue statistics for a doctor
- Query params: ?date=YYYY-MM-DD
- Returns: queue metrics and analytics
```

### Admin Queue Management (Authenticated)
```
POST /api/appointments/queue/move/:appointmentId
- Manually move appointment position in queue
- Body: { newPosition: 3 }
- Returns: updated queue position

POST /api/appointments/queue/early-arrival/:appointmentId
- Handle early arrival scenario
- Body: {} (empty)
- Returns: updated queue status

POST /api/appointments/queue/no-show/:appointmentId
- Handle no-show scenario
- Body: { gracePeriod: 15 } (optional)
- Returns: no-show handling result

POST /api/appointments/queue/emergency/:doctorId
- Broadcast emergency notification
- Body: { message, priority, estimatedDelay }
- Returns: broadcast confirmation
```

### WebSocket Management
```
GET /api/appointments/websocket/stats
- Get WebSocket service statistics
- Returns: connection stats, room info, uptime
```

## WebSocket Events

### Client to Server Events
```javascript
// Join queue for real-time updates
socket.emit('join-queue', { token: 'tracking-token' });

// Leave queue updates
socket.emit('leave-queue', {});

// Get current queue status
socket.emit('get-queue-status', { token: 'tracking-token' });

// Send heartbeat
socket.emit('heartbeat');
```

### Server to Client Events
```javascript
// Connection confirmation
socket.on('connected', (data) => {
  console.log('Connected:', data.clientId);
});

// Queue joined confirmation
socket.on('queue-joined', (data) => {
  console.log('Joined room:', data.roomId);
});

// Real-time queue position updates
socket.on('queue-update', (data) => {
  console.log('Position changed:', data.data.queue.position);
  console.log('Wait time:', data.data.queue.estimatedWaitTime);
});

// Emergency notifications
socket.on('emergency-notification', (data) => {
  console.log('Emergency:', data.message);
});

// Heartbeat acknowledgment
socket.on('heartbeat-ack');

// Current queue status
socket.on('queue-status', (data) => {
  console.log('Current status:', data.data);
});

// General queue changes
socket.on('queue-broadcast', (data) => {
  console.log('Queue changed:', data.reason);
});

// Error messages
socket.on('error', (data) => {
  console.error('Error:', data.message);
});
```

## Queue Service Methods

### Core Queue Management
```javascript
// Build queue based on payment timestamp priority
await queueService.buildQueue(hospitalId, doctorId, date);

// Get current queue position
await queueService.getQueuePosition(appointmentId);

// Get appointment by tracking token
await queueService.getAppointmentByTrackingToken(token, skipCache);
```

### Slot-based Management
```javascript
// Get slot-organized queue
await queueService.getSlotBasedQueue(hospitalId, doctorId, date);

// Handle slot overlaps
await queueService.handleSlotOverlaps(hospitalId, doctorId, slotStart, slotEnd);

// Get slot-specific position
await queueService.getSlotQueuePosition(appointmentId);

// Suggest optimal slots
await queueService.suggestOptimalSlots(hospitalId, doctorId, date, preferredHour);
```

### Dynamic Scenarios
```javascript
// Handle early arrival
await queueService.handleEarlyArrival(appointmentId);

// Handle no-show
await queueService.handleNoShow(appointmentId, gracePeriod);

// Move appointment in queue
await queueService.moveAppointmentInQueue(appointmentId, newPosition);
```

### Cache and Updates
```javascript
// Invalidate queue cache
await queueService.invalidateQueueCache(hospitalId, doctorId, date);

// Publish queue update
await queueService.publishQueueUpdate(hospitalId, doctorId, date, reason);

// Update queue positions
await queueService.updateQueuePositions(hospitalId, doctorId, date);
```

## Configuration

### Environment Variables
```env
# Redis Configuration (for caching and pub/sub)
REDIS_URL=redis://localhost:6379
REDIS_CLUSTER_MODE=false
REDIS_POOL_SIZE=10

# WebSocket Configuration
CORS_ORIGIN=*

# Queue Settings (in constants file)
DEFAULT_CONSULTATION_TIME=15  # minutes
MAX_EARLY_ARRIVAL=30         # minutes
POSITION_TTL=300             # seconds (5 minutes)
```

### Queue Constants
```javascript
// src/modules/appointment/appointment.constants.js
const QUEUE_TRACKING = {
  CACHE_PREFIX: 'queue:',
  UPDATE_CHANNEL: 'queue_updates',
  POSITION_TTL: 300,
  DEFAULT_CONSULTATION_TIME: 15,
  MAX_EARLY_ARRIVAL: 30
};
```

## Architecture

### Components
1. **Queue Service** (`src/modules/appointment/queue.service.js`)
   - Core queue management logic
   - Slot-based scheduling
   - Cache management
   - Position calculations

2. **WebSocket Service** (`src/services/websocket.service.js`)
   - Real-time communication
   - Client connection management
   - Room-based subscriptions
   - Emergency notifications

3. **Appointment Controller** (`src/modules/appointment/appointment.controller.js`)
   - API endpoint handlers
   - Request validation
   - Response formatting

4. **Tracking Utility** (`src/utils/tracking.util.js`)
   - JWT token generation/verification
   - Secure tracking link creation

### Data Flow
1. **Queue Building**: Fetches appointments → Orders by payment timestamp → Caches result
2. **Position Tracking**: Finds appointment in queue → Calculates position → Returns with wait time
3. **Real-time Updates**: Queue changes → Redis pub/sub → WebSocket broadcast → Client updates
4. **Slot Management**: Groups by hour → Handles overlaps → Optimizes scheduling

### Caching Strategy
- **Queue Cache**: 5-minute TTL for queue data
- **Tracking Cache**: 2-minute TTL for tracking responses
- **Cache Invalidation**: Automatic on queue changes
- **Redis Pub/Sub**: Real-time cache invalidation coordination

## Usage Examples

### Patient Tracking
```javascript
// Frontend JavaScript example
const socket = io('http://localhost:8000');

// Connect and join queue
socket.emit('join-queue', { token: trackingToken });

// Listen for position updates
socket.on('queue-update', (data) => {
  updateUI({
    position: data.data.queue.position,
    waitTime: data.data.queue.estimatedWaitTime,
    status: data.data.queue.queueStatus
  });
});

// Handle emergency notifications
socket.on('emergency-notification', (data) => {
  showAlert(data.message, data.priority);
});
```

### Admin Queue Management
```javascript
// Move patient to different position
const response = await fetch('/api/appointments/queue/move/appointment-id', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ newPosition: 1 })
});

// Send emergency notification
await fetch('/api/appointments/queue/emergency/doctor-id', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    message: 'Doctor is running 30 minutes late',
    priority: 'high',
    estimatedDelay: 30
  })
});
```

### Slot Optimization
```javascript
// Get optimal time slots for scheduling
const response = await fetch('/api/appointments/queue/suggest-slots/doctor-id?date=2025-06-04&preferredHour=14');
const suggestions = await response.json();

// Display suggestions to patient
suggestions.data.suggestions.forEach(slot => {
  console.log(`${slot.timeSlot}: ${slot.currentAppointments} appointments, ${slot.estimatedWaitTime}min wait`);
});
```

## Monitoring and Analytics

### Queue Statistics
- Total appointments per day
- Average wait times
- Peak hours analysis
- No-show rates
- Early arrival patterns

### WebSocket Metrics
- Connected clients count
- Active rooms
- Message throughput
- Connection uptime
- Error rates

### Performance Monitoring
- Cache hit rates
- Redis performance
- Database query performance
- WebSocket latency

## Error Handling

### Common Scenarios
1. **Invalid Tracking Token**: Returns 400 with error message
2. **Appointment Not Found**: Returns 404 with appropriate message
3. **WebSocket Connection Lost**: Automatic reconnection attempts
4. **Redis Cache Miss**: Falls back to database query
5. **Queue Position Not Found**: Rebuilds queue and recalculates

### Graceful Degradation
- Cache failures → Database fallback
- WebSocket failures → Polling fallback
- Redis failures → In-memory temporary storage

## Security Considerations

### Token Security
- JWT tokens with expiration
- Hospital/Doctor/Appointment ID validation
- No sensitive data in tokens

### API Security
- Authentication required for admin endpoints
- Rate limiting on public endpoints
- Input validation and sanitization

### WebSocket Security
- Origin validation
- Connection rate limiting
- Automatic disconnection of idle clients

## Deployment Notes

### Dependencies
```json
{
  "socket.io": "^4.x.x",
  "ioredis": "^5.x.x",
  "jsonwebtoken": "^9.x.x",
  "joi": "^17.x.x"
}
```

### Docker Configuration
```dockerfile
# Expose WebSocket port
EXPOSE 8000

# Environment variables
ENV NODE_ENV=production
ENV REDIS_URL=redis://redis:6379
```

### Load Balancing
- Sticky sessions required for WebSocket connections
- Redis pub/sub enables multi-instance scaling
- Health check endpoint: `/health`

## Testing

### Unit Tests
- Queue service methods
- Position calculations
- Cache operations
- Token validation

### Integration Tests
- WebSocket connection flow
- Real-time updates
- Emergency notifications
- Admin queue management

### Load Testing
- High connection counts
- Concurrent queue updates
- Cache performance under load
- WebSocket message throughput

This queue system provides a robust, scalable solution for real-time patient appointment tracking with comprehensive admin controls and excellent user experience.
