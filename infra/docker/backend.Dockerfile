FROM node:20-alpine
WORKDIR /app
COPY apps/backend/package*.json ./apps/backend/
RUN cd apps/backend && npm install
COPY apps/backend ./apps/backend
WORKDIR /app/apps/backend
EXPOSE 4000
CMD ["npm", "run", "start"]
