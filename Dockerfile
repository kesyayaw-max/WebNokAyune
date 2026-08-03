# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev && apk del python3 make g++

COPY . .

# Create required directories (app also creates these at runtime if missing,
# but /app/data is where the DB, uploads, and backups live when a volume is mounted there)
RUN mkdir -p uploads backups data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "server.js"]
