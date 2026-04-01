FROM node:20-alpine
WORKDIR /app
COPY services/scraper/package*.json ./services/scraper/
RUN cd services/scraper && npm install
COPY services/scraper ./services/scraper
WORKDIR /app/services/scraper
CMD ["npm", "run", "start"]
