FROM mcr.microsoft.com/playwright:v1.46.0-jammy
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production || npm install --production --legacy-peer-deps
COPY src ./src
ENV NODE_ENV=production
CMD ["npm", "start"]
