FROM node:20-alpine
WORKDIR /app
COPY services/recommender/package*.json ./services/recommender/
RUN cd services/recommender && npm install
COPY services/recommender ./services/recommender
WORKDIR /app/services/recommender
CMD ["npm", "run", "start"]
