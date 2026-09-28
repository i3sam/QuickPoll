FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
USER node

CMD ["node", "server/index.js"]
