# bridge/Dockerfile
FROM node:20-alpine
WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm ci --omit=dev || npm i --omit=dev

# Copy only what exists
COPY src ./src
COPY views ./views
# If you later add static assets, uncomment:
# COPY public ./public

ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["node","src/index.js"]
