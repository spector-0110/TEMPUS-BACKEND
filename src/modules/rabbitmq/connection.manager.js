const amqp = require('amqplib');
const { DEFAULT_CONFIG } = require('./rabbitmq.constants');
const { ConnectionError } = require('./rabbitmq.errors');
const { Logger, MetricsCollector } = require('./rabbitmq.utils');

class ConnectionManager {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connection = null;
    this.connectionAttempts = 0;
    this.initialized = false;
    this.initPromise = null;

    // Initialize utilities
    this.logger = new Logger(process.env.RABBITMQ_LOG_LEVEL);
    this.metrics = new MetricsCollector();

    // Event handlers bound to this instance
    this.handleConnectionError = this.handleConnectionError.bind(this);
    this.handleConnectionClose = this.handleConnectionClose.bind(this);
    this.handleConnectionBlocked = this.handleConnectionBlocked.bind(this);
    this.handleConnectionUnblocked = this.handleConnectionUnblocked.bind(this);
  }

  async initialize() {
    if (!this.initialized) {
      if (!this.initPromise) {
        this.initPromise = this.connectWithRetry();
      }
      await this.initPromise;
    }
    return this.initPromise;
  }

  async connectWithRetry() {
    const clusterNodes = this.getClusterNodes();

    while (this.connectionAttempts < this.config.maxConnectionAttempts) {
      try {
        // Try connecting to each node in the cluster
        for (const node of clusterNodes) {
          try {
            this.connection = await amqp.connect(node);
            
            this.setupConnectionHandlers();
            this.initialized = true;
            this.connectionAttempts = 0;
            
            this.logger.log('INFO', 'RabbitMQ Connected', { node });
            this.metrics.recordReconnection();
            
            return this.connection;
          } catch (nodeError) {
            this.logger.log('WARN', `Failed to connect to node ${node}`, {}, nodeError);
            continue;
          }
        }

        throw new ConnectionError('Failed to connect to all cluster nodes');
      } catch (error) {
        this.connectionAttempts++;
        this.logger.log('ERROR', `Connection Attempt ${this.connectionAttempts} failed`, {}, error);
        
        if (this.connectionAttempts < this.config.maxConnectionAttempts) {
          const delay = this.getBackoffDelay();
          await new Promise(res => setTimeout(res, delay));
        } else {
          this.initPromise = null;
          throw new ConnectionError('Max connection attempts reached');
        }
      }
    }
  }

  setupConnectionHandlers() {
    if (!this.connection) return;

    this.connection.on('error', this.handleConnectionError);
    this.connection.on('close', this.handleConnectionClose);
    this.connection.on('blocked', this.handleConnectionBlocked);
    this.connection.on('unblocked', this.handleConnectionUnblocked);
  }

  removeConnectionHandlers() {
    if (!this.connection) return;

    this.connection.removeListener('error', this.handleConnectionError);
    this.connection.removeListener('close', this.handleConnectionClose);
    this.connection.removeListener('blocked', this.handleConnectionBlocked);
    this.connection.removeListener('unblocked', this.handleConnectionUnblocked);
  }

  handleConnectionError(error) {
    this.logger.log('ERROR', 'Connection Error', {}, error);
    this.metrics.recordError(error);
    this.handleReconnect();
  }

  handleConnectionClose() {
    this.logger.log('WARN', 'Connection Closed');
    this.handleReconnect();
  }

  handleConnectionBlocked(reason) {
    this.logger.log('WARN', 'Connection blocked', { reason });
  }

  handleConnectionUnblocked() {
    this.logger.log('INFO', 'Connection unblocked');
  }

  async handleReconnect() {
    this.initialized = false;
    this.initPromise = null;
    this.removeConnectionHandlers();
    
    try {
      await this.initialize();
    } catch (error) {
      this.logger.log('ERROR', 'Failed to reconnect', {}, error);
    }
  }

  getConnection() {
    return this.connection;
  }

  isConnected() {
    return this.connection && !this.connection.closed;
  }

  async close() {
    if (this.connection) {
      try {
        this.removeConnectionHandlers();
        await this.connection.close();
        this.initialized = false;
        this.connection = null;
        this.logger.log('INFO', 'Connection closed');
      } catch (error) {
        this.logger.log('ERROR', 'Error closing connection', {}, error);
        throw new ConnectionError('Failed to close connection', error);
      }
    }
  }

  getBackoffDelay() {
    return this.config.reconnectDelay * Math.pow(2, this.connectionAttempts - 1);
  }

  getClusterNodes() {
    return process.env.RABBITMQ_CLUSTER_NODES ? 
      process.env.RABBITMQ_CLUSTER_NODES.split(',') : 
      [process.env.RABBITMQ_URL || 'amqp://localhost'];
  }

  getMetrics() {
    return this.metrics.getMetrics();
  }
}

module.exports = ConnectionManager;