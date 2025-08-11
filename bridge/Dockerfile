# bridge/Dockerfile
FROM node:20-alpine
WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm ci --omit=dev || npm i --omit=dev

# Copy source
COPY src ./src
COPY views ./views
# Create empty public dir to satisfy static serving if not present
RUN mkdir -p public
COPY public ./public

ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["node","src/index.js"]
