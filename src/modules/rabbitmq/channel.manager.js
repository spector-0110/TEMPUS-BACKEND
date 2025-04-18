const { ChannelError } = require('./rabbitmq.errors');
const { Logger, ChannelPool } = require('./rabbitmq.utils');

class ChannelManager {
  constructor(connectionManager, config = {}) {
    this.connectionManager = connectionManager;
    this.config = config;
    this.channelPool = new ChannelPool(config.maxChannels);
    this.logger = new Logger(process.env.RABBITMQ_LOG_LEVEL);
  }

  async initialize() {
    await this.initializeChannelPool();
  }

  async initializeChannelPool() {
    const connection = this.connectionManager.getConnection();
    if (!connection) {
      throw new ChannelError('No connection available');
    }

    for (let i = 0; i < this.config.maxChannels; i++) {
      const channel = await connection.createChannel();
      this.attachChannelHandlers(channel, i);
      this.channelPool.add(channel);
    }
  }

  attachChannelHandlers(channel, id) {
    // Remove existing listeners first
    channel.removeAllListeners('error');
    channel.removeAllListeners('close');
    
    // Set max listeners to prevent memory leak warnings
    channel.setMaxListeners(5);
    
    channel.on('error', (err) => {
      this.logger.log('ERROR', `Channel ${id} Error`, {}, err);
      this.handleChannelError(id);
    });

    channel.on('close', () => {
      this.logger.log('WARN', `Channel ${id} Closed`);
      this.handleChannelError(id);
    });
  }

  async handleChannelError(channelId) {
    try {
      const oldChannel = this.channelPool.get(channelId);
      if (oldChannel?.channel) {
        // Remove all listeners before closing
        oldChannel.channel.removeAllListeners();
        try {
          await oldChannel.channel.close();
        } catch (err) {
          this.logger.log('WARN', 'Error closing channel', {}, err);
        }
      }

      // Wait a short delay before creating new channel
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const connection = this.connectionManager.getConnection();
      if (!connection) {
        throw new ChannelError('No connection available');
      }

      const newChannel = await connection.createChannel();
      this.attachChannelHandlers(newChannel, channelId);
      this.channelPool.add(newChannel);
    } catch (err) {
      this.logger.log('ERROR', 'Error recovering channel', {}, err);
      this.channelPool.remove(channelId);
      throw new ChannelError(`Failed to recover channel ${channelId}`, err);
    }
  }

  async getChannel() {
    await this.connectionManager.initialize();

    const wrapper = this.channelPool.getNextAvailable();
    if (wrapper && !wrapper.closed) {
      return wrapper.channel;
    }

    this.logger.log('WARN', 'No active channel found, creating a temporary one');
    const connection = this.connectionManager.getConnection();
    if (!connection) {
      throw new ChannelError('No connection available');
    }

    const tempChannel = await connection.createChannel();
    // Don't add temporary channels to the pool
    return tempChannel;
  }

  async closeAll() {
    const promises = Array.from(this.channelPool.pool.values())
      .map(async (wrapper) => {
        if (wrapper.channel && !wrapper.closed) {
          try {
            wrapper.channel.removeAllListeners();
            await wrapper.channel.close();
          } catch (err) {
            this.logger.log('WARN', `Error closing channel ${wrapper.id}`, {}, err);
          }
        }
      });

    await Promise.all(promises);
    this.channelPool.clear();
  }

  getActiveChannelCount() {
    return this.channelPool.getActiveCount();
  }

  getPoolSize() {
    return this.channelPool.size();
  }
}

module.exports = ChannelManager;