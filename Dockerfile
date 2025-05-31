FROM node:18

WORKDIR /app

# Install build tools for native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy only package files first for better caching
COPY package*.json ./

# Clean up any old lockfiles and node_modules
RUN rm -rf node_modules package-lock.json

# Install dependencies
RUN npm install --production

# Copy the rest of your code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]

HEALTHCHECK  --interval=5m --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1
