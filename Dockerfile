


FROM node:24-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build








RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app


COPY package*.json ./
RUN npm ci --omit=dev

# ---- Runtime stage ----
FROM node:24-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

RUN apt-get update && apt-get install -y \
    gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node modules aus Build-Stage kopieren
COPY --from=build /app/node_modules ./node_modules

# Anwendungscode (docs/ wird via .dockerignore ausgeschlossen)
COPY . .


RUN mkdir -p /data /backups /app/modules /documents




# Deployments, die BACKUP_DIR selbst setzen (Compose, TrueNAS, Umbrel, Quadlet),

ENV BACKUP_DIR=/backups


COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh




ARG APP_BUILD_REVISION
ENV APP_BUILD_REVISION=${APP_BUILD_REVISION}

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server/index.js"]
