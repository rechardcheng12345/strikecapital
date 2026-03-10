# Build stage
FROM node:20-alpine AS builder

WORKDIR /app/client

COPY client/package*.json ./
RUN npm install

COPY client ./
RUN npm run build

# Production stage with nginx
FROM nginx:alpine AS production

# Copy built assets from builder
COPY --from=builder /app/client/dist /usr/share/nginx/html

# Copy nginx configuration
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

# Expose ports
EXPOSE 80
EXPOSE 443

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
