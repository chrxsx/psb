FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production || npm install --production --legacy-peer-deps
COPY src ./src
COPY views ./views
COPY public ./public
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
