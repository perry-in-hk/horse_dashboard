FROM node:20-alpine
WORKDIR /app
COPY services/scraper/package*.json ./services/scraper/
RUN cd services/scraper && npm install
COPY services/scraper ./services/scraper
# horseDetails.js resolves ../../../horse_codes_unique.txt from src/ → /app/
COPY horse_codes_unique.txt /app/horse_codes_unique.txt
WORKDIR /app/services/scraper
CMD ["npm", "run", "start"]
