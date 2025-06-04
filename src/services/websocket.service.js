const { Server } = require('socket.io');
const redisService = require('./redis.service');
const trackingUtil = require('../utils/tracking.util');
const queueService = require('../modules/appointment/advanced-queue.service');

class WebSocketService {
  constructor() {
    this.io = null;
    this.clients = new Map();
    this.roomSubscriptions = new Map();
    this.ROOM_PREFIX = 'queue:';
  }

  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupEventHandlers();
    this.setupRedisSubscription();
    console.log('WebSocket service initialized');
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);
      
      this.clients.set(socket.id, {
        id: socket.id,
        connectedAt: Date.now(),
        rooms: new Set()
      });

      // Handle tracking token connection
      socket.on('track-queue', async (data) => {
        try {
          await this.handleTrackQueue(socket, data);
        } catch (error) {
          console.error('Error tracking queue:', error);
          socket.emit('error', { message: 'Failed to track queue' });
        }
      });

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        this.handleDisconnect(socket);
      });
    });
  }  
  
  async handleTrackQueue(socket, data) {
    const { token } = data;

    if (!token) {
      socket.emit('error', { message: 'Token is required' });
      return;
    }

    try {
      // Verify token and get appointment details
      const { appointmentId, hospitalId, doctorId } = trackingUtil.verifyToken(token);
      
      // Get room ID
      const roomId = `${this.ROOM_PREFIX}${hospitalId}:${doctorId}:${appointmentId}`;
      
      // Join the room
      socket.join(roomId);
      
      // Update client tracking info
      const client = this.clients.get(socket.id);
      if (client) {
        client.rooms.add(roomId);
        client.token = token;
      }

      // Track room subscription
      if (!this.roomSubscriptions.has(roomId)) {
        this.roomSubscriptions.set(roomId, new Set());
      }
      this.roomSubscriptions.get(roomId).add(socket.id);

      // Send initial queue status
      const queueInfo = await queueService.getAppointmentByTrackingToken(token);
      socket.emit('queue-update', queueInfo);

    } catch (error) {
      console.error('Error in handleTrackQueue:', error);
      socket.emit('error', { message: 'Invalid or expired token' });
    }
  }

  /**
   * Handle client disconnect
   * @param {Object} socket - Socket instance
   */
  handleDisconnect(socket) {
    const client = this.clients.get(socket.id);
    
    if (client) {
      // Remove from all room subscriptions
      for (const roomId of client.rooms) {
        const roomSubs = this.roomSubscriptions.get(roomId);
        if (roomSubs) {
          roomSubs.delete(socket.id);
          if (roomSubs.size === 0) {
            this.roomSubscriptions.delete(roomId);
          }
        }
      }
    }

    this.clients.delete(socket.id);
  }

  setupRedisSubscription() {
    redisService.subscribe('queue:updates', async (updateData) => {
      try {
        const { hospitalId, doctorId } = updateData;
        
        // Find all affected rooms and send updates
        for (const [roomId, subscribers] of this.roomSubscriptions.entries()) {
          if (roomId.includes(`${hospitalId}:${doctorId}`)) {
            for (const clientId of subscribers) {
              const client = this.clients.get(clientId);
              if (client && client.token) {
                const socket = this.io.sockets.sockets.get(clientId);
                if (socket) {
                  const queueInfo = await queueService.getAppointmentByTrackingToken(client.token);
                  socket.emit('queue-update', queueInfo);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Error handling queue update:', error);
      }
    });
  }

  async cleanup() {
    if (this.io) {
      this.io.close();
    }
    this.clients.clear();
    this.roomSubscriptions.clear();
  }
}

module.exports = new WebSocketService();
