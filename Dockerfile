FROM node:lts-alpine
WORKDIR /app
COPY package.json .
COPY package-lock.json .
RUN npm install --production
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD [ "npm","start" ]