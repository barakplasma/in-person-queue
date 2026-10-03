FROM node:26-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
USER node
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://localhost:8080/healthcheck || exit 1
CMD ["node", "server.js"]
