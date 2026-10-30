FROM node:22-alpine
WORKDIR /app
COPY package.json server.ts ./
USER node
EXPOSE 9000
CMD ["node", "server.ts"]
