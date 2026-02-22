FROM node:20-bookworm

# Install build dependencies for node-pty
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --production

# Copy application source
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
