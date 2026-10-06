# Что сайт должен добавить для полноценной двусторонней синхронизации

Источник: `docs/site-internal-api.md`, раздел 7. Бот уже умеет работать со всеми **существующими** 7 endpoint'ами. Ниже — пробелы, без которых безопасный sync невозможен. В коде они спрятаны за feature flags и помечены `TODO/planned`.

Флаги (все по умолчанию `false`):

| Флаг | Gap | Endpoint / изменение |
|---|---|---|
| `FEATURE_SITE_EVENT_FEED` | #4 | `GET /api/internal/tickets/events?after_id=` |
| `FEATURE_DISCORD_USER_LOOKUP` | #6 | `GET /api/internal/users/by-discord/{id}` |
| `FEATURE_SITE_PERMISSION_CHECK` | #2 | проверка `TicketPolicy` на write-endpoint'ах |
| `FEATURE_MESSAGE_DEDUPE_BY_EXTERNAL_ID` | #3 | unique `(source, external_message_id)` |
| `FEATURE_CATEGORIES_ENDPOINT` | #7 | `GET /api/internal/tickets/categories` |

Включайте флаг **только после** выката соответствующей доработки на сайте. Иначе клиент бросит явную ошибку `TODO/planned endpoint`.

---

## Критично для этапа 1 (зеркало сайт → Discord)

### 1. Включить API

```env
SUPPORT_INTERNAL_API=true
SUPPORT_INTERNAL_TOKEN=<openssl rand -base64 32>
```

Сейчас API выключен: любой путь отвечает 404.

### 2. Outbox / event feed (gap #4)

Бот не может узнать о тикетах с сайта, кроме как парсить человекочитаемый webhook (его как раз нужно выключить).

Нужен либо:

```
GET {SITE_URL}/api/internal/tickets/events?after_id=N
```

либо таблица `support_ticket_outbox`.

Минимальный JSON элемента:

```json
{
  "id": 1842,
  "ticket_number": "COINT-1207",
  "event_type": "created",
  "message_id": 901,
  "source": "website",
  "created_at": "2026-10-06T10:00:00+05:00"
}
```

`source` обязателен: бот пропускает свои же `source=discord` события (защита от петли, gap #5).

После появления feed — отключить `support.webhook`.

---

## Критично для этапа 2 (ответы из Discord)

### 3. Discord → user lookup (gap #6)

```
GET {SITE_URL}/api/internal/users/by-discord/{discord_user_id}
```

```json
{
  "user_id": 123,
  "name": "Player123",
  "role": "Хелпер",
  "permissions": {
    "can_view_tickets": true,
    "can_view_all_tickets": true,
    "can_reply": true,
    "can_internal_notes": true,
    "can_view_sensitive": false,
    "is_admin": false
  }
}
```

Без этого бот не знает, какой `user_id` писать в `POST /messages`. Несвязанный Discord-аккаунт — отказ с подсказкой «привяжите Discord в профиле».

`discord_accounts.discord_user_id` сейчас без unique index: при коллизии лучше 409.

### 4. Проверка прав на API (gap #2)

`POST /messages`, `/status`, `/attachments` принимают любой `user_id`. Любой не-владелец становится `author_type=staff`.

Сайт должен прогонять `TicketPolicy` и отдавать **403**, если нет `tickets.staff.reply` / `internal_notes` / `change_status`. Бот не должен быть единственным слоем авторизации.

### 5. Dedupe по Discord message id (gap #3)

`external_message_id` индексирован, но не уникален и пишется после insert. Retry создаёт дубль и повторный webhook.

Нужно: unique `(source, external_message_id)` (или lookup-before-insert внутри транзакции) и `200` с уже существующим сообщением при повторе.

---

## Важно, но не блокирует скелет

6. **Тонкий payload (gap #7):** нет ticket id, owner, assignee, team, timestamps, автора сообщения, вложений, `is_sensitive`. Бот пока хардкодит чувствительность по ключу `staff_complaint`.
7. Нет assign/claim, priority, list/search, find-by-reference — кнопки «взять / приоритет» на этапе 2 упрутся в это.
8. `GET /attachments/{id}` не scoped к тикету и не фильтрует internal/sensitive.
9. `storeReference` молча переносит triple на другой тикет.
10. Смена статуса через API не шлёт игроку те же уведомления, что сайт.
11. Общий rate limit 60 req/min на IP бота.
12. Правки/удаления сообщений API не поддерживает.

---

## Как бот обходит пробелы сейчас

- Конфиденциальность: `src/routing/confidentiality.ts` (ключ категории, отдельный форум).
- Петли: `src/sync/loop-guard.ts` + `DedupeGuard` в памяти.
- Пользователь Discord: заглушка `user_id=1` и явный TODO (не для продакшена).
- Синхронизация сайт → Discord: нет poll'а реальных тикетов, пока нет outbox. Dry-run только логирует сценарий.
