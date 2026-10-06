# Статус пробелов Internal Ticket API (2026-10-06)

Источник: `docs/site-internal-api.md`, раздел 7. Бот выровнен под эту ревизию.

## Закрыто на сайте (бот уже использует)

| Бывший gap | Что появилось | Как бот это использует |
|---|---|---|
| #2 permission checks | 403 + `forbidden_*` / `user_banned` / `user_deleted` | Пишем реальный `user_id` staff; 403 показываем в треде |
| #3 dedupe | unique `(source, external_message_id)`, 200 `duplicate:true`, 409 cross-ticket | Шлём Discord message id; replay не создаёт петлю |
| #4 / #5 event feed | `GET /events?after_id=&limit=` + `source` | Поллинг ленты, курсор в `data/event-cursor.json`, skip `source=discord` |
| #6 Discord lookup | `GET /api/internal/users/by-discord/{id}` | Резолв staff; 404/409 — понятное сообщение, **без** заглушки `user_id=1` |
| #7 payload / categories | ids, owner, dates, attachments, `is_sensitive`; `GET /categories` | Маршрутизация по `is_sensitive`, автор в карточке |
| #10 references | 200 на тот же тикет, 409 чужой, `move:true` | Линкуем тред без тихого переноса |
| #11 notify on resolve/close | сайт шлёт игроку | Бот только меняет статус |

Флаги `FEATURE_*` по умолчанию **включены**. Выключать имеет смысл только для отката.

## Ещё открыто

1. **API выключен в prod** — нет `SUPPORT_INTERNAL_API` / `SUPPORT_INTERNAL_TOKEN`. Пока 404 на все пути.
2. **Нет assign / claim / priority / category / team / merge / list / search / find-by-reference.** Кнопки «взять» и смена приоритета некуда слать.
3. **`GET /attachments/{id}`** не scoped к тикету и не фильтрует internal/sensitive. Бот должен брать id только из `attachments[]` тикета.
4. **Нет retention/cleanup outbox** и нет бэкапа истории до 2026-10-06. Курсор бота нельзя отматывать в прошлое.
5. **Старый Discord webhook всё ещё включён.** После этапа 1 его надо выключить (`support.webhook`), иначе дубли в канале. В footer теперь есть `source:` — бот может игнорировать `source: discord`, но треды webhook не создаёт.
6. Общий rate limit 60 req/min на IP; правки/удаления сообщений API не умеет.
7. `first_response_at` пуст у тикетов до 2026-09-23 — для статистики брать первое публичное staff-сообщение.

## Что включить на сайте перед продом бота

```env
SUPPORT_INTERNAL_API=true
SUPPORT_INTERNAL_TOKEN=<openssl rand -base64 32>
```

После того как бот стабильно зеркалит треды — очистить Discord webhook в настройках Support.
