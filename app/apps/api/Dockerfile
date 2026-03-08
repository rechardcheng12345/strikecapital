# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/

# Install dependencies
RUN npm ci --workspace=@task-review/api

# Copy source code
COPY apps/api ./apps/api

# Build the application
WORKDIR /app/apps/api
RUN npm run build

# Production stage
FROM node:18-alpine AS production

WORKDIR /app/apps/api

# Copy package files and install production dependencies only
COPY --from=builder /app/package*.json /app/
COPY --from=builder /app/apps/api/package*.json ./

WORKDIR /app
RUN npm ci --workspace=@task-review/api --omit=dev

WORKDIR /app/apps/api

# Copy built application
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/knexfile.ts ./
COPY --from=builder /app/apps/api/migrations ./migrations

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
