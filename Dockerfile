# Use Node.js 20 slim image as base
FROM node:20-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV PRISMA_CLI_BINARY_TARGETS="debian-openssl-3.0.x"

# Install system dependencies for Prisma and other builds
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Generate Prisma client
RUN npx prisma generate

# Copy application code
COPY . .

# Expose port for the app
ENV PORT=8000
EXPOSE 8000

# Start the application
CMD ["npm", "start"]