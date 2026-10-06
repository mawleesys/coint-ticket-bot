FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package files
COPY package*.json ./
COPY tsconfig.json ./

# Устанавливаем зависимости
RUN npm ci

# Копируем исходный код
COPY src/ ./src/

# Собираем TypeScript
RUN npm run build

# ====================================
# Production image
# ====================================
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Создаем non-root пользователя
RUN addgroup -g 1001 -S botuser && \
    adduser -S -u 1001 -G botuser botuser

# Копируем только production зависимости
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force

# Копируем собранный код
COPY --from=builder /app/dist ./dist

# Копируем .env.example для справки
COPY .env.example ./

# Меняем владельца файлов
RUN chown -R botuser:botuser /app

USER botuser

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { if (r.statusCode !== 200) throw new Error('Health check failed') })"

EXPOSE 3000

CMD ["node", "dist/index.js"]
