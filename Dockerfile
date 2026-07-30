FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY migrations ./migrations
USER node
ENV NODE_ENV=production
EXPOSE 8000
CMD ["node", "src/server.js"]
