# Руководство по развертыванию

## Варианты развертывания

### 1. Docker (рекомендуется)

Преимущества:
- Изоляция от системы
- Простое обновление
- Портируемость

#### Подготовка

```bash
# Клонируйте репозиторий
git clone https://github.com/your-org/coint-ticket-bot.git
cd coint-ticket-bot

# Создайте .env из примера
cp .env.example .env
nano .env  # заполните реальные токены
```

#### Запуск

```bash
# Сборка и запуск
docker-compose up -d

# Проверка логов
docker-compose logs -f

# Проверка healthcheck
curl http://localhost:3000/health
```

#### Обновление

```bash
# Остановить контейнер
docker-compose down

# Получить обновления
git pull

# Пересобрать и запустить
docker-compose up -d --build
```

---

### 2. Systemd (нативный процесс)

Подходит, если уже есть Node.js на сервере и хотите избежать Docker.

#### Установка

```bash
# 1. Подготовка
cd /opt
sudo git clone https://github.com/your-org/coint-ticket-bot.git
cd coint-ticket-bot

# 2. Установка зависимостей
sudo npm ci --omit=dev

# 3. Сборка
sudo npm run build

# 4. Создание пользователя
sudo useradd -r -s /bin/false -d /opt/coint-ticket-bot botuser

# 5. Конфигурация
sudo cp .env.example .env
sudo nano .env  # заполните

# 6. Права доступа
sudo chown -R botuser:botuser /opt/coint-ticket-bot
sudo chmod 600 .env  # защита токенов

# 7. Установка сервиса
sudo cp coint-ticket-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable coint-ticket-bot

# 8. Запуск
sudo systemctl start coint-ticket-bot

# 9. Проверка
sudo systemctl status coint-ticket-bot
sudo journalctl -u coint-ticket-bot -f
```

#### Обновление

```bash
cd /opt/coint-ticket-bot
sudo systemctl stop coint-ticket-bot
sudo -u botuser git pull
sudo -u botuser npm ci --omit=dev
sudo -u botuser npm run build
sudo systemctl start coint-ticket-bot
```

---

### 3. PM2 (альтернатива systemd)

```bash
# Установка PM2 глобально
npm install -g pm2

# Запуск
pm2 start dist/index.js --name coint-ticket-bot

# Автозапуск при перезагрузке
pm2 startup
pm2 save

# Логи
pm2 logs coint-ticket-bot

# Перезапуск
pm2 restart coint-ticket-bot
```

---

## Мониторинг

### Healthcheck

Бот предоставляет HTTP endpoint на порту `HEALTH_PORT` (по умолчанию 3000):

```bash
curl http://localhost:3000/health
```

**Ответ при работе:**
```json
{
  "status": "ok",
  "ready": true,
  "dryRun": false,
  "connectedGuilds": 1,
  "mappings": 42,
  "dedupeRecords": 15,
  "statsMetrics": 123
}
```

**Ответ при инициализации:**
```json
{
  "status": "not_ready",
  "ready": false,
  ...
}
```

### Логирование

#### Docker

```bash
# Real-time
docker-compose logs -f coint-ticket-bot

# Последние 100 строк
docker-compose logs --tail=100 coint-ticket-bot
```

#### Systemd

```bash
# Real-time
sudo journalctl -u coint-ticket-bot -f

# С фильтром по времени
sudo journalctl -u coint-ticket-bot --since "1 hour ago"

# Только ошибки
sudo journalctl -u coint-ticket-bot -p err
```

#### PM2

```bash
pm2 logs coint-ticket-bot
pm2 logs coint-ticket-bot --lines 100
```

### Метрики

Логи Pino содержат структурированные данные:

```json
{
  "level": 30,
  "time": 1696579200000,
  "module": "syncEngine",
  "ticket": "COINT-1234",
  "threadId": "1234567890",
  "msg": "Mirrored ticket to Discord"
}
```

Можно отправлять в Loki, Elasticsearch, CloudWatch и т.д.

---

## Резервное копирование

### Что бэкапить

1. **`.env`** — токены и конфигурация
2. **(Будущее) База данных маппинга** — если используется SQLite/PostgreSQL
3. **Логи** — опционально, для отладки

### Пример (systemd)

```bash
#!/bin/bash
# /opt/coint-ticket-bot/backup.sh

DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/backup/coint-ticket-bot"

mkdir -p "$BACKUP_DIR"

# .env
cp /opt/coint-ticket-bot/.env "$BACKUP_DIR/.env-$DATE"

# (если есть БД)
# cp /opt/coint-ticket-bot/data/mappings.db "$BACKUP_DIR/mappings-$DATE.db"

# Удалить старые (>7 дней)
find "$BACKUP_DIR" -type f -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR"
```

Добавьте в cron:

```bash
sudo crontab -e
# Каждый день в 3:00
0 3 * * * /opt/coint-ticket-bot/backup.sh
```

---

## Безопасность

### Защита токенов

```bash
# Права доступа .env
sudo chmod 600 /opt/coint-ticket-bot/.env
sudo chown botuser:botuser /opt/coint-ticket-bot/.env
```

### Firewall

Если используете внешний healthcheck:

```bash
# Разрешить порт healthcheck только с определённых IP
sudo ufw allow from 192.168.1.0/24 to any port 3000
```

Для внутреннего использования firewall не требуется.

### Обновления

```bash
# Регулярно обновляйте зависимости
npm audit
npm audit fix

# Обновление до последней версии бота
git pull
npm ci --omit=dev
npm run build
```

---

## Диагностика проблем

### Бот не запускается

1. **Проверьте логи:**

```bash
# Docker
docker-compose logs coint-ticket-bot

# Systemd
sudo journalctl -u coint-ticket-bot -n 50
```

2. **Типичные ошибки:**

   - `Configuration validation failed`: неверный `.env` → проверьте все обязательные переменные
   - `401 Unauthorized`: неверный токен сайта → сравните с `SUPPORT_INTERNAL_TOKEN` на сайте
   - `404 Not Found` для всех API запросов: `SUPPORT_INTERNAL_API=false` → включите на сайте
   - `Invalid token` (Discord): неверный `DISCORD_TOKEN` → проверьте в Developer Portal

### Бот запустился, но тикеты не появляются

1. **Проверьте outbox/event feed:**
   - Если сайт ещё не реализовал gap #4, синхронизация сайт → Discord не работает
   - Временно: создавайте тикеты вручную через API клиент (см. тесты)

2. **Проверьте права Discord:**
   - Бот должен видеть форум-канал
   - Права: Send Messages in Threads, Create Public Threads, Manage Threads

3. **Dry-run режим:**
   - Если `DRY_RUN=true`, бот только логирует, не выполняет реальные действия
   - Установите `DRY_RUN=false` в `.env`

### Сообщения из Discord не попадают на сайт

1. **Discord user lookup (gap #6):**
   - Если сайт не реализовал endpoint, бот не может резолвить Discord ID → site user_id
   - Временная заглушка в коде использует фиктивный `user_id=1`

2. **Проверьте dedupe:**
   - Если сообщение уже обработано, оно пропускается
   - Перезапустите бота (dedupe хранится в памяти)

---

## Масштабирование

Для малых/средних проектов (до 1000 тикетов/день) одного инстанса достаточно.

Для крупных:

1. **Horizontal scaling:**
   - Запустите несколько инстансов бота за балансером
   - Требуется персистентное хранилище (PostgreSQL для маппинга)
   - Координация через distributed lock (Redis)

2. **Vertical scaling:**
   - Увеличьте лимиты памяти в Docker/systemd
   - Node.js `--max-old-space-size=512` (по умолчанию достаточно)

---

## Тестирование в продакшене

### Smoke test

После деплоя:

```bash
# 1. Healthcheck
curl http://localhost:3000/health

# 2. Проверьте логи
docker-compose logs --tail=50 coint-ticket-bot

# 3. Создайте тестовый тикет через сайт
# 4. Убедитесь, что появился тред в Discord
# 5. Отправьте сообщение в тред
# 6. Убедитесь, что оно попало на сайт (в админке тикета)
```

---

## Rollback

### Docker

```bash
# Откат на предыдущий коммит
git log --oneline  # найдите SHA коммита
git checkout <previous-sha>
docker-compose up -d --build
```

### Systemd

```bash
sudo systemctl stop coint-ticket-bot
cd /opt/coint-ticket-bot
sudo -u botuser git checkout <previous-sha>
sudo -u botuser npm ci --omit=dev
sudo -u botuser npm run build
sudo systemctl start coint-ticket-bot
```

---

## Контакты

При проблемах с развертыванием:
- GitHub Issues: https://github.com/your-org/coint-ticket-bot/issues
- Внутренний Discord: #bot-support
