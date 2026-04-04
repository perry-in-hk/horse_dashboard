FROM node:20-alpine
RUN apk add --no-cache wget
WORKDIR /app
COPY apps/backend/package.json ./apps/backend/
RUN cd apps/backend && npm install --omit=dev
COPY apps/backend ./apps/backend
COPY services/scraper/package*.json ./services/scraper/
RUN cd services/scraper && npm install --omit=dev
COPY services/scraper ./services/scraper
WORKDIR /app/apps/backend
EXPOSE 4000
CMD ["npm", "run", "start"]
