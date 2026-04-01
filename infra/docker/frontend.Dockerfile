FROM node:20-alpine
WORKDIR /app
COPY apps/frontend/package*.json ./apps/frontend/
RUN cd apps/frontend && npm install
COPY apps/frontend ./apps/frontend
WORKDIR /app/apps/frontend
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
