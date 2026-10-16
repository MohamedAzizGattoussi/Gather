FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN python3 -m venv /opt/gather-python && /opt/gather-python/bin/pip install --no-cache-dir -r server/requirements.txt && npm run build
ENV NODE_ENV=production GATHER_PYTHON=/opt/gather-python/bin/python HOST=0.0.0.0 PORT=4317 GATHER_MODE=supabase
USER node
EXPOSE 4317
CMD ["node", "server/index.mjs"]
