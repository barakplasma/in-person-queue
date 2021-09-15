FROM node:lts-alpine
ARG NODE_ENV_ARG=production
ENV NODE_ENV=$NODE_ENV_ARG
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --no-optional
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]