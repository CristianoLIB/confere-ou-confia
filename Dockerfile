FROM node:22-slim
WORKDIR /app
# better-sqlite3 compila binding nativo na instalação.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY dados/questoes.json ./dados/questoes.json
ENV NODE_ENV=production PORT=3000 DB_PATH=/dados/confere.sqlite
EXPOSE 3000
CMD ["node", "src/servidor.js"]
