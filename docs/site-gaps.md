# Статус пробелов Internal Ticket API (2026-10-06, round 2)

Источник: `docs/site-internal-api.md`, раздел 7. Бот выровнен под эту ревизию.

## Закрыто на сайте (бот уже использует)

| Бывший gap | Что появилось | Как бот это использует |
|---|---|---|
| #2 permission checks | 403 + `forbidden_*` / `user_banned` / `user_deleted` | Пишем реальный `user_id` staff; 403 показываем в треде |
| #3 dedupe | unique `(source, external_message_id)`, 200 `duplicate:true`, 409 cross-ticket | Шлём Discord message id; replay не создаёт петлю |
| #4 / #5 event feed | `GET /events?after_id=&limit=` + `source` + retention 90 дней | Поллинг ленты, курсор `afterId`+`lastSyncAt`; stale → resync через list |
| #6 Discord lookup | `GET /api/internal/users/by-discord/{id}` | Резолв staff; 404/409 — понятное сообщение, **без** заглушки `user_id=1` |
| #7 payload / categories | ids, owner, dates, attachments, `is_sensitive`, `sla_due_at`, `is_overdue` | Карточка, SLA, маршрутизация по `is_sensitive` |
| #10 references | 200 / 409 / `move:true`; `GET /by-reference` | Линк треда; резолв тикета из треда |
| #11 notify on resolve/close | сайт шлёт игроку | Кнопки «Решить» / «Закрыть» |
| claim / assign / unassign | `POST /{ticket}/claim|assign|unassign` | Кнопка «Взять в работу», 403 `forbidden_assign` |
| priority / category | `POST /{ticket}/priority|category` | Кнопки приоритета; 403 `forbidden_priority` / `forbidden_category` |
| list / search | `GET /` очереди + `{data, meta}`, `user_id` обязателен | Resync открытых тикетов; 403 `forbidden_view` |
| scoped attachments | `GET /{ticket}/attachments/{id}` | Предпочтительный путь; `user_id` для internal/sensitive |
| stats | `GET /stats?from&to&user_id` | Недельный отчёт; локальный расчёт только как fallback |

Флаги `FEATURE_*` по умолчанию **включены**. Выключать имеет смысл только для отката.

## Ещё открыто (не код API)

1. **Включить Internal API в prod** — выставить `SUPPORT_INTERNAL_API` и `SUPPORT_INTERNAL_TOKEN`. Пока 404 на все пути.
2. **Выключить старый Discord webhook** (`support.webhook`) после стабильного зеркала, иначе дубли в канале.
3. **Создать Discord-приложение бота** (Developer Portal: intents, форумы, токен, приглашение на сервер).

Остальное из раздела 7 спецификации — ограничения платформы, не блокеры бота: нет merge / правок сообщений, общий rate limit 60 req/min, нет бэкапа ленты до 2026-10-06, assign/priority не шлют игроку уведомление.

## Что включить на сайте перед продом бота

```env
SUPPORT_INTERNAL_API=true
SUPPORT_INTERNAL_TOKEN=<openssl rand -base64 32>
```

После того как бот стабильно зеркалит треды — очистить Discord webhook в настройках Support.
