# Debian slim (glibc): Vite 8 uses Rolldown with native bindings; Alpine/musl often has no
# matching optional binary (e.g. rolldown-binding.linux-*-musl.node), breaking npm run dev/build.
FROM node:20-bookworm-slim
WORKDIR /app
COPY apps/frontend/package*.json ./apps/frontend/
RUN cd apps/frontend && npm install
COPY apps/frontend ./apps/frontend
WORKDIR /app/apps/frontend
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
