# COINT Ticket Bot

> Discord бот для синхронизации тикетов поддержки проекта COINT Minecraft между сайтом (Azuriom с плагином Support) и Discord

[![CI](https://github.com/your-org/coint-ticket-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/coint-ticket-bot/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

## 📋 Содержание

- [Описание](#описание)
- [Архитектура](#архитектура)
- [Возможности](#возможности)
- [Структура проекта](#структура-проекта)
- [Требования](#требования)
- [Установка и настройка](#установка-и-настройка)
  - [Discord бот](#настройка-discord-бота)
  - [Сайт (Azuriom)](#настройка-на-стороне-сайта)
  - [Локальная разработка](#локальная-разработка)
- [Конфигурация](#конфигурация)
- [Запуск](#запуск)
  - [Режим dry-run](#режим-dry-run)
  - [Docker](#docker)
  - [Systemd](#systemd)
- [Тестирование](#тестирование)
- [Безопасность и конфиденциальность](#безопасность-и-конфиденциальность)
- [Дорожная карта](#дорожная-карта)
- [Расширение функциональности](#расширение-функциональности)
- [Известные ограничения](#известные-ограничения)
- [Поддержка](#поддержка)

---

## Описание

`coint-ticket-bot` — это Discord бот, обеспечивающий двустороннюю синхронизацию тикетов поддержки между сайтом COINT (платформа Azuriom с кастомным плагином Support) и Discord. Сайт остаётся единственным источником истины (single source of truth), а Discord служит удобным интерфейсом для персонала.

**Ключевые особенности:**

- **Зеркалирование тикетов:** каждый тикет с сайта создаёт отдельный тред в форум-канале Discord
- **Двусторонняя синхронизация:** сообщения из Discord попадают на сайт, изменения с сайта отражаются в Discord
- **Конфиденциальность:** чувствительные категории (жалобы на администрацию) изолированы в отдельный закрытый форум
- **Управление через Discord:** кнопки для взятия тикета в работу, изменения статуса и приоритета
- **Статистика:** сбор метрик (время первого ответа, решения, SLA-соответствие, нагрузка на персонал)
- **Сухой прогон:** режим без подключения к Discord и сайту для локальной разработки и тестирования

---

## Архитектура

```mermaid
graph TB
    subgraph "Discord"
        FORUM[Форум тикетов]
        CONF_FORUM[Конфиденциальный форум]
        STAFF[Персонал]
    end

    subgraph "Bot Infrastructure"
        BOT[Discord Bot<br/>discord.js v14]
        SYNC[Sync Engine<br/>Bidirectional]
        API[Site API Client]
        STORE[Mapping Store<br/>тикет ↔ тред]
        DEDUPE[Dedupe Guard<br/>защита от петель]
        STATS[Stats Collector]
    end

    subgraph "Azuriom Site"
        SITE_API[Internal Ticket API<br/>/api/internal/tickets]
        DB[(MariaDB)]
    end

    STAFF -->|сообщения, кнопки| FORUM
    STAFF -->|конфиденциальные| CONF_FORUM
    
    FORUM --> BOT
    CONF_FORUM --> BOT
    
    BOT --> SYNC
    SYNC --> API
    SYNC --> STORE
    SYNC --> DEDUPE
    SYNC --> STATS
    
    API <-->|HTTP + Bearer auth| SITE_API
    SITE_API <--> DB
    
    SITE_API -.->|webhook<br/>будет отключен| BOT

    style BOT fill:#5865F2
    style SYNC fill:#FFA500
    style SITE_API fill:#00D166
    style DB fill:#003545
```

### Потоки данных

#### Сайт → Discord (чтение)

1. **Новый тикет:** создаётся тред в форуме, первое сообщение — embed с деталями
2. **Обновления:** новые сообщения с сайта появляются в треде
3. **Статус/приоритет:** обновляются теги треда
4. **Ссылка сохраняется:** `POST /{ticket}/references` записывает Discord thread ID на сайте

#### Discord → Сайт (запись)

1. **Сообщение в треде:** бот резолвит Discord user → site user (`GET /users/by-discord/{id}`), затем `POST /{ticket}/messages`
2. **Префикс `!note`:** становится внутренней заметкой (`is_internal=true`)
3. **Кнопки:** «Взять» → `POST /{ticket}/claim`; приоритет → `/priority`; «Решить»/«Закрыть» → `/status`. Тикет ищется в памяти, иначе `GET /by-reference`
4. **Вложения:** предпочтительно `GET /{ticket}/attachments/{id}` (`user_id` для internal/sensitive)
5. **Dedupe:** `external_message_id` (Discord message ID) предотвращает дубли

---

## Возможности

### Этап 0: Фундамент (текущий MVP)

- ✅ API-клиент сайта, строго по спецификации
- ✅ Создание тредов для тикетов (обычные и конфиденциальные)
- ✅ Маппинг тикет ↔ тред (в памяти)
- ✅ Защита от дублирования и петель (dedupe guard)
- ✅ Скелет модуля статистики
- ✅ Dry-run режим для разработки
- ✅ Конфигурация с валидацией (Zod)
- ✅ Структурированное логирование (Pino)
- ✅ Тесты (Jest): API клиент, dedupe, маппинг, статистика
- ✅ Docker + docker-compose
- ✅ Systemd сервис
- ✅ CI/CD (GitHub Actions)

### Этап 1: Зеркалирование (read-only)

- ✅ Сайт: outbox `GET /events` (skip `source=discord`), retention 90 дней
- ✅ Бот поллит ленту, курсор на диске; stale cursor → resync через `GET /` + `GET /{ticket}`
- ⏳ Включить API в prod и выключить старый webhook
- ⏳ Пересылка вложений Discord → сайт

### Этап 2: Двусторонняя синхронизация

- ✅ `GET /users/by-discord/{id}` — без заглушки `user_id=1`
- ✅ Discord → сайт: ответы и `!note`, replay 200 / 409
- ✅ Кнопки «взять» / приоритет / решить / закрыть (claim, priority, status)
- ✅ `GET /by-reference` для резолва тикета из треда
- ⏳ Загрузка вложений Discord → сайт

### Этап 3: Статистика и отчёты

- ✅ `GET /stats` для недельного отчёта (локальный расчёт — fallback)
- ⏳ Публикация в канал, когда задан `DISCORD_STATS_CHANNEL_ID` и API включён
- ⏳ Дашборд команды (опционально)

### Этап 4: Расширенные функции

- ⏳ Создание тикетов через Discord (`/ticket`)
- ⏳ Команды модерации
- ⏳ Интеграция с другими сервисами

---

## Структура проекта

```
coint-ticket-bot/
├── src/
│   ├── api/
│   │   └── site-client.ts        # Клиент Internal Ticket API
│   ├── config/
│   │   └── index.ts               # Конфигурация с валидацией (Zod)
│   ├── discord/
│   │   ├── bot.ts                 # Главный Discord клиент
│   │   ├── event-mapper.ts        # Событие тикета → черновик Discord
│   │   └── thread-manager.ts      # Управление форумами и тредами
│   ├── routing/
│   │   └── confidentiality.ts     # Маршрутизация чувствительных категорий
│   ├── dry-run/
│   │   └── demo.ts                # Офлайн-демонстрация без токенов
│   ├── sync/
│   │   ├── dedupe-guard.ts        # Защита от дублей
│   │   ├── event-cursor.ts        # after_id + lastSyncAt
│   │   ├── event-feed.ts          # Правила outbox → Discord
│   │   ├── loop-guard.ts          # Игнор bot/webhook и source=discord
│   │   ├── mapping-store.ts       # Хранилище тикет ↔ тред
│   │   ├── resync.ts              # Stale cursor → list + GET /{ticket}
│   │   ├── staff-resolver.ts      # Discord → site user + права
│   │   ├── ticket-actions.ts      # Кнопки карточки → API
│   │   └── sync-engine.ts         # Движок синхронизации
│   ├── stats/
│   │   └── collector.ts           # Сбор статистики
│   ├── types/
│   │   ├── api.ts                 # Типы API сайта
│   │   └── discord.ts             # Типы Discord интеграции
│   ├── utils/
│   │   └── logger.ts              # Pino logger
│   └── index.ts                   # Точка входа
├── tests/
│   ├── site-client.test.ts
│   ├── mapping-store.test.ts
│   ├── dedupe-guard.test.ts
│   └── stats-collector.test.ts
├── docs/
│   ├── site-internal-api.md       # Спецификация API сайта
│   ├── site-gaps.md               # Что сайт должен добавить
│   └── deployment.md              # Docker / systemd / диагностика
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions CI
├── package.json
├── tsconfig.json
├── jest.config.js
├── .eslintrc.json
├── Dockerfile
├── docker-compose.yml
├── coint-ticket-bot.service       # Systemd юнит
├── .env.example
├── .gitignore
└── README.md
```

---

## Требования

- **Node.js**: ≥ 20.0.0 (LTS)
- **Память**: ~100-200 МБ (легковесный бот)
- **Диск**: ~50 МБ (включая зависимости)
- **Сеть**: доступ к Discord API и сайту COINT

### Для сайта (Azuriom)

- **PHP**: ≥ 8.1
- **Laravel**: 10.x
- **Plugin**: Support 1.1.9+ (с кастомным Internal API)
- **MariaDB/MySQL**: 10.3+

---

## Установка и настройка

### Настройка Discord бота

#### 1. Создание приложения

1. Откройте [Discord Developer Portal](https://discord.com/developers/applications)
2. Нажмите **New Application**, назовите (например, "COINT Tickets")
3. В разделе **Bot**:
   - Нажмите **Add Bot**
   - Включите **Privileged Gateway Intents**:
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent**
   - Скопируйте **Token** (это `DISCORD_TOKEN`)

#### 2. Добавление на сервер

Permissions calculator: выберите:
- ✅ **Read Messages/View Channels**
- ✅ **Send Messages**
- ✅ **Send Messages in Threads**
- ✅ **Create Public Threads**
- ✅ **Manage Threads**
- ✅ **Embed Links**
- ✅ **Attach Files**
- ✅ **Read Message History**
- ✅ **Add Reactions**
- ✅ **Use Application Commands** (для будущих slash-команд)

Permissions integer: `397284627520`

OAuth2 URL:
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=397284627520&scope=bot%20applications.commands
```

#### 3. Создание форум-каналов

1. **Основной форум:**
   - Тип: **Forum Channel**
   - Имя: `🎫 Тикеты поддержки`
   - Права: только персонал может писать, игроки — читать
   - Теги (создайте вручную):
     - `📋 Открыт`, `🔧 В работе`, `⏳ Ожидает персонал`, `💬 Ожидает игрока`, `✅ Решен`, `🔒 Закрыт`
     - `🟢 Низкий`, `🟡 Обычный`, `🟠 Высокий`, `🔴 Срочный`

2. **Конфиденциальный форум:**
   - Тип: **Forum Channel**
   - Имя: `🔒 Жалобы (Senior Admin)`
   - Права: только роли "Тех.Администратор", "Куратор", "Главный модератор"
   - Теги: те же

#### 4. Получение ID

Включите **Режим разработчика** в Discord (Настройки → Расширенные → Режим разработчика).

Правый клик → **Копировать ID**:
- Сервер → `DISCORD_GUILD_ID`
- Форум тикетов → `DISCORD_FORUM_CHANNEL_ID`
- Конфиденциальный форум → `DISCORD_CONFIDENTIAL_FORUM_CHANNEL_ID`
- Роль "Хелпер" (минимальная для персонала) → `DISCORD_MIN_STAFF_ROLE_ID`
- Канал для статистики → `DISCORD_STATS_CHANNEL_ID`

---

### Настройка на стороне сайта

#### 1. Включение Internal Ticket API

Добавьте в `.env` сайта:

```env
# Включить Internal API
SUPPORT_INTERNAL_API=true

# Токен (сгенерируйте безопасный: openssl rand -base64 32)
SUPPORT_INTERNAL_TOKEN=your_secure_random_token_here
```

После изменений:
```bash
php artisan config:cache
```

#### 2. Проверка доступности

```bash
curl -H "Authorization: Bearer your_secure_random_token_here" \
     -H "Accept: application/json" \
     https://your-site.com/api/internal/tickets/COINT-1
```

Ожидаемо: 200 (если тикет существует) или 404 (если нет). Не 401 или 404 для всех маршрутов.

#### 3. Что уже есть на сайте и что осталось

Код сайта (2026-10-06) закрыл outbox, lookup Discord, проверки прав, dedupe и расширенный payload. Актуальный список: [`docs/site-gaps.md`](docs/site-gaps.md).

Осталось перед продом бота:

1. Выставить `SUPPORT_INTERNAL_API` / `SUPPORT_INTERNAL_TOKEN`.
2. После стабильного зеркала — выключить старый `support.webhook`.
3. Создать Discord-приложение (intents, форумы, токен) и пригласить бота на сервер.

#### 4. Отключение старого webhook

После того как бот начнёт постить в треды, отключите:

```env
# В .env сайта: закомментируйте или удалите
# SUPPORT_WEBHOOK=https://discord.com/api/webhooks/...
```

Или в админке: **Support → Settings → Discord Webhook** → очистить.

---

### Локальная разработка

#### 1. Клонирование и установка

```bash
git clone https://github.com/your-org/coint-ticket-bot.git
cd coint-ticket-bot
npm install
```

#### 2. Конфигурация

Скопируйте `.env.example` в `.env`:

```bash
cp .env.example .env
```

Заполните реальные значения (или используйте `DRY_RUN=true` для работы без токенов).

#### 3. Запуск в dev-режиме

```bash
npm run dev
```

Это запустит TypeScript через `tsx` с hot-reload.

---

## Конфигурация

Все настройки задаются через переменные окружения (файл `.env`).

### Основные

| Переменная | Описание | По умолчанию |
|---|---|---|
| `DRY_RUN` | Режим сухого прогона (без подключения к Discord/сайту; токены не нужны) | `false` |
| `DRY_RUN_EXIT_AFTER_MS` | Автозавершение процесса в dry-run (0 = не завершать; для CI) | `0` |
| `LOG_LEVEL` | Уровень логирования (`trace` … `fatal`, `silent`) | `info` |
| `HEALTH_PORT` | Порт для healthcheck HTTP endpoint | `3000` |

### Discord

| Переменная | Обязательна | Описание |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Токен бота (из Developer Portal) |
| `DISCORD_GUILD_ID` | ✅ | ID сервера Discord |
| `DISCORD_FORUM_CHANNEL_ID` | ✅ | ID основного форум-канала |
| `DISCORD_CONFIDENTIAL_FORUM_CHANNEL_ID` | ✅ | ID конфиденциального форума |
| `DISCORD_MIN_STAFF_ROLE_ID` | | ID минимальной роли персонала (для информации) |
| `DISCORD_STATS_CHANNEL_ID` | | ID канала для публикации статистики |

### Сайт

| Переменная | Обязательна | Описание |
|---|---|---|
| `SITE_URL` | ✅ | Базовый URL сайта (без слеша на конце) |
| `SITE_API_TOKEN` | ✅ | Токен для Internal API (из `SUPPORT_INTERNAL_TOKEN`) |
| `SITE_ACTOR_USER_ID` | | Site user для list / stats / resync (`tickets.staff.view`) |
| `SITE_API_TIMEOUT` | | Таймаут запросов (мс) | `10000` |

### Синхронизация

| Переменная | По умолчанию | Описание |
|---|---|---|
| `SYNC_POLL_INTERVAL` | `30` | Интервал опроса `GET /events` (секунды) |
| `SYNC_BATCH_SIZE` | `50` | Legacy batch (не лента) |
| `SYNC_EVENTS_LIMIT` | `100` | Событий за запрос (макс. 500) |
| `SYNC_CURSOR_PATH` | `./data/event-cursor.json` | Файл курсора `after_id` + `lastSyncAt` |
| `OUTBOX_RETENTION_DAYS` | `90` | Если курсор старше — resync через `GET /` |

### Статистика

| Переменная | По умолчанию | Описание |
|---|---|---|
| `STATS_ENABLED` | `true` | Включить сбор статистики |
| `STATS_WEEKLY_REPORT_DAY` | `1` | День недели отчёта (0=вс, 1=пн, ...) |
| `STATS_WEEKLY_REPORT_HOUR` | `9` | Час отчёта (UTC, 0-23) |

### Дополнительно

| Переменная | По умолчанию | Описание |
|---|---|---|
| `MAX_ATTACHMENT_SIZE` | `8388608` | Макс. размер вложений (байты, 8 MB) |
| `DEBUG_API_REQUESTS` | `false` | Детальное логирование запросов к API |
| `FEATURE_SITE_EVENT_FEED` | `true` | Поллинг `GET /events` |
| `FEATURE_DISCORD_USER_LOOKUP` | `true` | `GET /users/by-discord/{id}` |
| `FEATURE_SITE_PERMISSION_CHECK` | `true` | Ожидать 403 `forbidden_*` с сайта |
| `FEATURE_MESSAGE_DEDUPE_BY_EXTERNAL_ID` | `true` | Идемпотентность по Discord message id |
| `FEATURE_CATEGORIES_ENDPOINT` | `true` | `GET /categories` |
| `FEATURE_TICKET_MANAGEMENT` | `true` | claim / assign / priority / category |
| `FEATURE_TICKET_LIST` | `true` | `GET /` для resync |
| `FEATURE_SITE_STATS` | `true` | `GET /stats` для недельного отчёта |

Подробный список доработок сайта: [`docs/site-gaps.md`](docs/site-gaps.md). Спецификация API: [`docs/site-internal-api.md`](docs/site-internal-api.md).

---

## Запуск

### Режим dry-run

Токены не нужны. Достаточно:

```bash
DRY_RUN=true npm start
```

или после сборки:

```bash
DRY_RUN=true DRY_RUN_EXIT_AFTER_MS=5000 node dist/index.js
```

Бот поднимает `/health`, не логинится в Discord и не ходит на сайт. В логах префикс `[DRY RUN]`: создание тредов, маршрутизация `staff_complaint`, пропуск bot/webhook, `!note`, dedupe, расчёт SLA.

### Production

```bash
npm run build
npm start
```

### Docker

#### Сборка образа

```bash
docker build -t coint-ticket-bot .
```

#### Запуск с docker-compose

1. Создайте `.env` с реальными токенами
2. Запустите:

```bash
docker-compose up -d
```

3. Логи:

```bash
docker-compose logs -f coint-ticket-bot
```

4. Остановка:

```bash
docker-compose down
```

#### Healthcheck

```bash
curl http://localhost:3000/health
```

Ответ (статус 200):
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

### Systemd

#### Установка

1. Соберите проект:

```bash
npm ci --omit=dev
npm run build
```

2. Создайте пользователя:

```bash
sudo useradd -r -s /bin/false botuser
```

3. Скопируйте файлы:

```bash
sudo mkdir -p /opt/coint-ticket-bot
sudo cp -r dist package*.json .env /opt/coint-ticket-bot/
sudo cp -r node_modules /opt/coint-ticket-bot/
sudo chown -R botuser:botuser /opt/coint-ticket-bot
```

4. Установите сервис:

```bash
sudo cp coint-ticket-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable coint-ticket-bot
sudo systemctl start coint-ticket-bot
```

#### Управление

```bash
# Статус
sudo systemctl status coint-ticket-bot

# Логи
sudo journalctl -u coint-ticket-bot -f

# Перезапуск
sudo systemctl restart coint-ticket-bot

# Остановка
sudo systemctl stop coint-ticket-bot
```

---

## Тестирование

### Запуск всех тестов

```bash
npm test
```

### Покрытие

```bash
npm test -- --coverage
```

Отчёт в `coverage/lcov-report/index.html`.

### Только один тест

```bash
npm test -- site-client.test.ts
```

### Watch mode

```bash
npm run test:watch
```

### Линтинг

```bash
npm run lint
npm run lint:fix
```

### Проверка типов

```bash
npm run type-check
```

---

## Безопасность и конфиденциальность

⚠️ **Это публичный репозиторий!**

### Что НЕ коммитить

- ❌ Реальные токены (`DISCORD_TOKEN`, `SITE_API_TOKEN`)
- ❌ IP-адреса, URL сайта
- ❌ Email, имена игроков, персональные данные
- ❌ Содержимое тикетов, логи с реальными данными

### Что безопасно

- ✅ `.env.example` с плейсхолдерами
- ✅ Примеры `COINT-1234` (фиктивные номера)
- ✅ Ссылки на публичную документацию

### Конфиденциальные категории

Тикеты категории `staff_complaint` (жалобы на администрацию):
- Создаются в **отдельном** закрытом форуме
- Доступны только Senior Admin (Тех.Администратор, Куратор, Главный модератор)
- Тема и содержимое **НЕ** отображаются в основном форуме

Код проверяет `KNOWN_CATEGORIES[categoryKey].is_sensitive` и использует `confidentialForumChannel`.

### Secrets в GitHub Actions

Если проект приватный, добавьте secrets в Settings → Secrets:
- `DISCORD_TOKEN_STAGING`
- `SITE_API_TOKEN_STAGING`

---

## Дорожная карта

### Этап 0: Подготовка (текущий)

- [x] Фундамент бота (архитектура, типы, конфиги)
- [x] API-клиент с тестами
- [x] Dry-run режим
- [x] CI/CD и Docker
  - [ ] **Сайт:** включить Internal API (`docs/site-gaps.md`) и создать первый тестовый тикет

### Этап 1: Зеркалирование (read-only)

- [x] Outbox `GET /events` на сайте и поллинг в боте
- [x] Resync через list, если курсор старше retention (90 дней)
- [ ] Включить Internal API в prod
- [ ] Отключить старый webhook после стабильного зеркала
- [ ] Создать Discord-приложение и пригласить бота

### Этап 2: Двусторонняя синхронизация

- [x] Lookup Discord и проверки прав на сайте
- [x] Ответы / `!note` из Discord без `user_id=1`
- [x] Кнопки claim / priority / resolve / close
- [ ] Вложения Discord → сайт

### Этап 3: Статистика

- [x] `GET /stats` + fallback на локальный расчёт
- [x] Еженедельный отчёт (канал, если задан `DISCORD_STATS_CHANNEL_ID`)
- [ ] Команда `/stats` для персонала

### Этап 4: Расширенные функции

- [ ] Slash-команда `/ticket` для создания тикетов из Discord
- [ ] Автоматическое закрытие неактивных тредов
- [ ] Интеграция с системой ролей Minecraft
- [ ] Дашборд (web) для визуализации статистики

---

## Расширение функциональности

### Добавление новой команды

1. Определите команду в `src/discord/commands/` (например, `ticket-command.ts`)
2. Зарегистрируйте в `src/discord/bot.ts`:

```typescript
if (interaction.isChatInputCommand()) {
  if (interaction.commandName === 'ticket') {
    await handleTicketCommand(interaction);
  }
}
```

3. Добавьте обработчик:

```typescript
async function handleTicketCommand(interaction: ChatInputCommandInteraction) {
  // Логика команды
}
```

### Добавление нового endpoint сайта

1. Определите типы в `src/types/api.ts`
2. Добавьте метод в `src/api/site-client.ts`:

```typescript
async getCustomData(ticketNumber: string): Promise<CustomResponse> {
  return await this.request<CustomResponse>('GET', `/${ticketNumber}/custom`);
}
```

3. Напишите тест в `tests/site-client.test.ts`

### Персистентное хранилище маппинга

Текущий `TicketMappingStore` работает в памяти. Для продакшена:

**Вариант 1: SQLite**

```typescript
import Database from 'better-sqlite3';

export class PersistentMappingStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ticket_mappings (
        ticket_number TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL UNIQUE,
        channel_id TEXT NOT NULL,
        is_confidential INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }

  set(mapping: TicketThreadMapping): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO ticket_mappings
      (ticket_number, thread_id, channel_id, is_confidential, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      mapping.ticketNumber,
      mapping.threadId,
      mapping.channelId,
      mapping.isConfidential ? 1 : 0,
      mapping.createdAt.toISOString()
    );
  }

  // ... остальные методы
}
```

**Вариант 2: Site API references**

Использовать `POST /{ticket}/references` и `GET /{ticket}` (поле `references`) как источник истины. При старте бота:

1. Загрузить все открытые тикеты
2. Для каждого извлечь `references` с `provider=discord, external_type=thread`
3. Построить кеш в памяти

---

## Известные ограничения

### Site API

Актуально: [`docs/site-gaps.md`](docs/site-gaps.md). Claim/assign/priority/list/by-reference/stats/scoped attachments и retention outbox уже на сайте. Открыто: API выключен в prod, старый webhook ещё жив, Discord-приложение бота ещё не создано.

### Текущие ограничения бота

- Маппинг тикет ↔ тред в памяти (ссылка на сайте через `/references` и `GET /by-reference`)
- Курсор ленты персистентен (`afterId` + `lastSyncAt`); при stale — resync
- Нет `/ticket` из Discord и автоархивации
- Статистика с сайта (`GET /stats`); локальный расчёт — fallback

---

## Поддержка

### Проблемы и вопросы

- GitHub Issues: https://github.com/your-org/coint-ticket-bot/issues
- Внутренний Discord: канал `#bot-development`

### Вклад

1. Fork репозитория
2. Создайте feature branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m 'Add some feature'`
4. Push: `git push origin feature/my-feature`
5. Откройте Pull Request

Требования:
- ✅ Тесты покрывают новый код
- ✅ Lint и type-check проходят (`npm run lint && npm run type-check`)
- ✅ CI зелёный

### Лицензия

MIT License. См. `LICENSE`.

---

**Разработано для проекта COINT Minecraft** | v0.1.0
