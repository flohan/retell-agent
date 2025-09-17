FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production || npm i --only=production
COPY . .
EXPOSE 10000
ENV NODE_ENV=production
CMD ["npm","start"]
