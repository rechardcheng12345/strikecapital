FROM node:20-alpine

WORKDIR /app/server

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server ./

RUN mkdir -p uploads logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the application
CMD ["node", "src/index.js"]
