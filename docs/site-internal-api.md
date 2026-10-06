# COINT site — Internal Ticket API & data model (spec for `coint-ticket-bot`)

> Source of truth: Azuriom site, plugin `plugins/support` (Azuriom "Support" 1.1.9, heavily extended in-house).
> This document was produced by reading the deployed code (read-only). It describes **what exists today**,
> plus a list of **known gaps** the bot must work around or that need site-side changes.
> No secrets / hosts / personal data are included. `{SITE_URL}` = the site's public base URL (placeholder).

---

## 1. Base URL, enablement, authentication

| Item | Value |
|---|---|
| Base prefix | `{SITE_URL}/api/internal/tickets` |
| Middleware | Laravel `api` group (`throttle:api` + route-model binding) + `EnsureInternalTicketApi` |
| Enable flag | env `SUPPORT_INTERNAL_API` (bool, default `false`) → `config('support.internal_api')` |
| Token | env `SUPPORT_INTERNAL_TOKEN` (string) → `config('support.internal_token')` |
| Auth header | `Authorization: Bearer <SUPPORT_INTERNAL_TOKEN>` (compared with `hash_equals`) |
| **Current state** | **Disabled** — neither env var is set in production yet. Must be enabled before the bot can work. |

Auth behaviour:
- API disabled → **404** for every route (indistinguishable from "route not found").
- Token not configured, missing, or wrong → **401**.

**Always send `Accept: application/json`.** Without it, Laravel renders validation errors as a **302 redirect**
instead of a JSON 422. Also send `Content-Type: application/json` (or `multipart/form-data` for file upload).

Rate limits:
- `throttle:api` = **60 requests/minute per client IP** (no authenticated user on this API, so the whole bot shares one bucket). Exceeding → **429** with `Retry-After`.
- Public (non-internal) replies are additionally throttled **per author user**: `reply_per_minute = 10` (config). Exceeding → **422** with error on `body`.

Config constants (`config/support.php`):
```php
'number_prefix'            => 'COINT',
'reply_per_minute'         => 10,
'attachment_max_kilobytes' => 8192,   // 8 MB
'attachment_max_files'     => 5,      // per create/reply via website (API uploads one file per call)
```

Site settings that affect the API (DB `settings` table, managed in admin):
- `support.max_open` (default 3) — max active tickets per user (create → 422 if exceeded, except `source=system`).
- `support.create_cooldown` (seconds, default 300 if unset) — min interval between tickets per user (skipped for `source=system`).
- `support.close_after_days` — `support:close-stale` artisan command auto-closes stale tickets.
- `support.sla.{low,normal,high,urgent}_minutes` — first-response SLA (defaults 2880 / 1440 / 240 / 60).
- `support.webhook` — Discord webhook URL for the existing one-way notifications (section 6).

### Ticket route key (`{ticket}`)
`{ticket}` is resolved by **public number** (`COINT-1234`). Also accepted: legacy `COI-1234` (rewritten to `COINT-1234`)
and the raw numeric DB id. Unknown → **404**.

### Error format
- 401 / 404 / 429 / 500: Laravel default JSON `{"message": "..."}`.
- 422 validation: `{"message": "...", "errors": {"field": ["..."]}}`. Messages are localized (Russian).
- A few 422s are returned manually by the controller as `{"message": "Unsupported ticket source."}` / `{"message": "Unknown category."}` (no `errors` key).

---

## 2. Endpoints

All paths are relative to `{SITE_URL}/api/internal/tickets`.

### 2.1 `POST /` — create ticket
Body (JSON):

| Field | Rules | Notes |
|---|---|---|
| `user_id` | required, integer, exists in `users.id` | Ticket owner (site account). |
| `category_key` | required, string | Must match `support_categories.key` (see §4.5). Unknown → 422 `Unknown category.` |
| `subject` | required, string, max 100 | |
| `body` | required, string, max 5000 | First message (trimmed; empty → 422). |
| `server_id` | nullable, integer | **Required** if the category has `requires_server=true`; must exist in `servers`. |
| `fields` | nullable, object | Category form answers, validated per `form_schema` as `fields.<key>` (see §4.5). |
| `source` | optional, one of `website`/`discord`/`system` (default `website`) | Invalid → 422 `Unsupported ticket source.` `system` bypasses spam guards. |

Behaviour:
- Inactive category → 422 (`category_id`).
- Anti-spam (unless `source=system`): max active tickets (`support.max_open`) and cooldown → 422 (`subject`).
- `shop_payment`: `fields.payment_id` must be a payment (id or transaction id) **owned by that user**, else 422 (`fields.payment_id`).
- Priority = category `default_priority`; `urgent` is downgraded to `normal` when created by the owner (the API always passes the owner as actor).
- Status = `open`; team = category's `assigned_team_id`; `public_number` auto-generated (`COINT-<n>`, incrementing from the latest).
- `metadata` is filled with context: `account_user_id`, `minecraft.game_id`, `server_id`, `source`, `form` answers, `payment_id`, and `discord.{discord_user_id,name}` if the owner has linked Discord.
- Side effects after commit: staff site notifications + **Discord webhook `created`** (§6).

Response **201** — ticket payload (§2.8) with public messages only.

### 2.2 `GET /{ticket}` — show ticket
Query: `include_internal` (bool, default false) — include internal staff notes.

Response **200** — ticket payload (§2.8).

### 2.3 `POST /{ticket}/messages` — add message (reply or internal note)
Body (JSON):

| Field | Rules | Notes |
|---|---|---|
| `user_id` | required, integer, exists | Author (site account). |
| `body` | required, string, max 5000 | Trimmed. |
| `is_internal` | nullable, boolean (default false) | Internal staff note. |
| `external_message_id` | nullable, string, max 191 | e.g. Discord message snowflake. Stored on the message. |
| `source` | optional `website`/`discord`/`system` (**default `discord`**) | |

Behaviour (`TicketMessageService::reply`):
- Ticket `closed` or merged → 422 (`body`).
- `author_type` is derived: **author == ticket owner → `user`, anyone else → `staff`**. (No permission check — see gaps.)
- Owner cannot post internal notes → 422 (`visibility`).
- Public messages are throttled per author (10/min) → 422 (`body`).
- Status auto-transitions:
  - owner reply: `waiting_for_user` / `resolved` / `in_progress` → `waiting_for_staff` (`open`, `waiting_for_staff` unchanged);
  - staff reply: `open` / `in_progress` / `waiting_for_staff` / `resolved` → `waiting_for_user`;
  - staff reply sets `first_response_at` (if null) and `last_staff_message_at`; owner reply sets `last_user_message_at`.
  - These auto-transitions do **not** fire a `status` webhook (announce=false), but are recorded as events.
- Internal note → event `internal_note_added`, webhook `internal_note` (without body). No status change.
- Side effects after commit: webhook `user_replied` / `staff_replied` (with excerpt) and site/email notifications.
- `external_message_id` is written **after** the message is created (separate save).

Response **201**:
```json
{ "id": 1234, "is_internal": false }
```

### 2.4 `POST /{ticket}/attachments` — upload attachment
`multipart/form-data`:

| Field | Rules |
|---|---|
| `user_id` | required, integer, exists (uploader) |
| `message_id` | nullable, integer — must be a message **of this ticket** (else 404) |
| `file` | required, file, max 8192 KB |

Allowed types (extension **and** detected MIME must match):
`png` (image/png), `jpg`/`jpeg` (image/jpeg), `webp` (image/webp), `txt` (text/plain),
`log` (text/plain, text/x-log, application/octet-stream; rejected if it contains NUL bytes),
`zip` (application/zip variants), `mp4` (video/mp4). Otherwise 422 (`attachments`).
Stored on the local disk as `tickets/<ticket_id>/<uuid>.<ext>`; original name sanitized; sha256 stored.
Records event `attachment_added`. **No webhook** is sent for attachments.

Response **201**: `{ "id": 55 }`

### 2.5 `GET /attachments/{attachment}` — download attachment
`{attachment}` = numeric attachment id. Streams the file (`Content-Disposition: attachment; filename=<original_name>`).
404 if missing. Not scoped to a ticket and no internal/sensitive filtering (bot must enforce visibility).

### 2.6 `POST /{ticket}/status` — change status
Body: `status` (required, one of the TicketStatus values §3.1), `user_id` (nullable, integer, exists → actor; null = "system").

- Same status → no-op.
- Transition not allowed by the state machine (§3.1) → 422 (`status`).
- Sets `resolved_at` / `closed_at` accordingly; reopening clears them.
- Records `status_changed` (+ `resolved` / `closed` / `reopened`) events; sends webhook `status` / `resolved` / `closed` / `reopened`.
- Note: unlike the website flow, this endpoint does **not** send the player notification for resolved/closed.

Response **200** — ticket payload (§2.8).

### 2.7 `POST /{ticket}/references` — link an external object
Body:

| Field | Rules |
|---|---|
| `provider` | required, string, max 50, **not** `launcher` (e.g. `discord`) |
| `external_type` | required, string, max 50 (e.g. `thread`, `starter_message`, `channel`) |
| `external_id` | required, string, max 191 (snowflake) |
| `metadata` | nullable, object |

Upsert on the unique key `(provider, external_type, external_id)`. If that triple already exists **on another ticket,
it is silently moved** to this ticket and its metadata replaced.

Response **201**:
```json
{ "id": 7, "provider": "discord", "external_type": "thread", "external_id": "123456789012345678" }
```

### 2.8 Ticket payload (returned by create / show / status)
Exact shape built by `InternalTicketController::payload()`:
```json
{
  "public_number": "COINT-1207",
  "status": "waiting_for_staff",
  "priority": "normal",
  "source": "website",
  "subject": "Не заходит на сервер",
  "category": "technical",
  "messages": [
    {
      "id": 901,
      "body": "Текст сообщения",
      "is_internal": false,
      "author_type": "user",
      "source": "website",
      "external_message_id": null
    }
  ],
  "references": [
    { "provider": "discord", "external_type": "thread", "external_id": "123456789012345678" }
  ]
}
```
- `messages` are ordered by id; internal notes only with `include_internal=1` (show only).
- **Not included** (gaps): numeric ticket id, owner/assignee/team, created/updated/activity timestamps, SLA/overdue,
  `metadata`, message author user id / name / created_at, attachments (loaded but not serialized), category name or `is_sensitive`.

---

## 3. Enums

### 3.1 `TicketStatus` (`support_tickets.status`)
`open`, `in_progress`, `waiting_for_staff`, `waiting_for_user`, `resolved`, `closed`.
Active = `open`, `in_progress`, `waiting_for_staff`, `waiting_for_user`.

Allowed transitions:

| from \ to | open | in_progress | waiting_for_staff | waiting_for_user | resolved | closed |
|---|---|---|---|---|---|---|
| open | – | ✔ | ✔ | ✔ | ✔ | ✔ |
| in_progress | ✔ | – | ✔ | ✔ | ✔ | ✔ |
| waiting_for_staff | | ✔ | – | ✔ | ✔ | ✔ |
| waiting_for_user | | ✔ | ✔ | – | ✔ | ✔ |
| resolved | ✔ | | ✔ | ✔ | – | ✔ |
| closed | ✔ | | | | | – |

Russian UI labels come from `support::messages.state.<value>`.

### 3.2 `TicketPriority`
`low`, `normal`, `high`, `urgent`. (No API endpoint to change priority.)

### 3.3 `TicketSource` (ticket and message `source`)
`website`, `discord`, `system`.

### 3.4 `TicketAuthorType` (message `author_type`)
`user` (ticket owner), `staff` (anyone else), `system`.

### 3.5 `TicketEventType` (`support_ticket_events.event_type`) and payloads
| type | payload |
|---|---|
| `created` | `{source, category}` |
| `assigned` / `unassigned` | `{from_user_id, to_user_id}` |
| `team_changed` | `{from_team_id, to_team_id}` |
| `status_changed` | `{from, to}` |
| `resolved` / `closed` / `reopened` | `{from, to}` (merge-close: `{source, target}`) |
| `priority_changed` | `{from, to}` |
| `category_changed` | `{from_category_id, to_category_id}` |
| `internal_note_added` | `{message_id}` |
| `attachment_added` | `{attachment_id, name}` |
| `merged` | `{source, target}` (public numbers; recorded on both tickets) |

Events are **not exposed** by the API (no feed endpoint).

---

## 4. Database schema (ticket-related)

All ids are `increments` (unsigned int). Timestamps = `created_at`/`updated_at` unless noted.

### 4.1 `support_tickets`
`id`, `subject` (string), `author_id` (FK users, cascade), `category_id` (FK support_categories, cascade),
`assignee_id` (FK users, null on delete), `closed_at`, `created_at`, `updated_at`,
`public_number` (string, **unique**), `source` (default `website`), `server_id` (FK servers, nullable),
`priority` (default `normal`, indexed), `status` (default `open`, indexed), `assigned_team_id` (FK support_ticket_teams),
`first_response_at`, `resolved_at`, `last_user_message_at`, `last_staff_message_at`, `last_activity_at` (indexed),
`merged_into_id` (FK self), `metadata` (json).

### 4.2 `support_ticket_messages`
`id`, `ticket_id` (FK, cascade), `author_type` (string), `author_user_id` (FK users, nullable),
`source` (default `website`), `body` (text), `is_internal` (bool), `external_message_id` (string, nullable, **index, NOT unique**), timestamps.
(Legacy `support_comments` table still exists; its rows were migrated into this table.)

### 4.3 `support_ticket_attachments`
`id`, `ticket_id` (FK, cascade), `ticket_message_id` (FK messages, nullable), `uploaded_by_user_id` (FK users, nullable),
`original_name`, `storage_path`, `mime_type`, `size` (uint), `sha256` (char 64), timestamps.

### 4.4 `support_ticket_events`
`id`, `ticket_id` (FK, cascade), `actor_user_id` (FK users, nullable), `event_type`, `payload` (json),
`created_at` (no `updated_at`). Index `(ticket_id, created_at)`.

### 4.5 `support_categories`
`id`, `name`, `icon`, `description`, `key` (**unique**), `is_active`, `sort_order`, `assigned_team_id` (FK teams),
`default_priority`, `requires_server`, `is_sensitive`, `form_schema` (json `{fields:[{key,type,required,label,options?}]}`;
types `text`(≤255) / `textarea`(≤5000) / `select`(in options) / `datetime` / `checkbox`), timestamps.

Current catalog (keys are stable identifiers):

| key | team | requires_server | sensitive | form fields (`fields.*`) |
|---|---|---|---|---|
| `technical` | technical | yes | no | – |
| `server_issue` | technical | yes | no | – |
| `shop_payment` | payments | no | no | `payment_id`*, `amount`, `payment_method`, `description`* |
| `lost_items` | moderation | yes | no | `occurred_at`* (datetime), `items`* |
| `player_report` | moderation | yes | no | `reported_player`*, `description`* |
| `staff_complaint` | senior_admins | no | **yes** | `description`* |
| `appeal` | senior_admins | no | no | `punishment`*, `description`* |
| `website_bug` | technical | no | no | `page_url`, `description`* |
| `other` | – | no | no | – |

`*` = required. Admins can edit categories, so the bot should not hard-code more than the keys.

### 4.6 `support_ticket_teams`
`id`, `key` (**unique**: `technical`, `moderation`, `payments`, `senior_admins`), `name`, `description`, `is_active`, timestamps.

### 4.7 `support_ticket_external_references`
`id`, `ticket_id` (FK, cascade), `provider`, `external_type`, `external_id`, `metadata` (json), timestamps.
**Unique** `(provider, external_type, external_id)` (`support_ticket_ext_ref_unique`). Currently empty.

### 4.8 Discord account link (Azuriom core): `discord_accounts`
`id`, `name` (Discord username), `user_id` (FK users, cascade), `discord_user_id` (string snowflake, **no unique index**),
`access_token`, `refresh_token`, `expires_at`, timestamps. One row per user (`User::discordAccount()` hasOne).
Created via the profile "Link Discord" OAuth flow (Socialite `discord`); used for Discord Linked Roles
(`settings.discord.link_roles = 1`). The OAuth tokens are secrets and must never be exposed to the bot.
(`social_links` is an unrelated table for profile social links.)
Roles: `users.role_id` → `roles(id, name, power, is_admin)`; permissions: `permissions(role_id, permission)`.

---

## 5. Permissions & privacy rules

Permission keys (checked by `TicketPolicy` / `TicketAccess` on the **website** only — not on the internal API):

| Permission | Meaning |
|---|---|
| `tickets.view_own`, `tickets.create`, `tickets.reply_own` | player: own tickets |
| `tickets.staff.view` | staff queue: unassigned tickets + tickets assigned to self |
| `tickets.staff.view_all` | all tickets |
| `tickets.staff.reply` | public reply as staff |
| `tickets.staff.internal_notes` | internal notes |
| `tickets.staff.assign` / `change_status` / `change_priority` / `close` | management |
| `tickets.staff.manage_categories` / `manage_teams` | admin config |
| `tickets.staff.view_sensitive` | can see `is_sensitive` categories |
| legacy `support.tickets` / `support.categories` | imply the staff set / manage_categories |

Rules:
- `staffCanSee`: sensitive category requires `view_sensitive`; then `view_all` → yes; `view` → only if unassigned or assigned to self.
- reply (staff) = `staffCanSee` && `tickets.staff.reply`; internal note = `staffCanSee` && `tickets.staff.internal_notes`; etc.
- Owner may close own ticket (`reply_own`). Owner never sees internal notes or attachments on internal messages.
- Admin roles (`is_admin`) pass every check.

Current role setup (by role name, ordered by `power`): Владелец (admin, 10) · Тех.Администратор (9) · Куратор (8) ·
Главный модератор (7) · Модератор (6) · **Хелпер (5)** · Стажёр (4) — all staff roles from Стажёр upward have the full
staff set (view, view_all, reply, assign, change_status, change_priority, internal_notes, close);
Тех.Администратор / Куратор / Главный модератор also manage categories. **No non-admin role has `view_sensitive`.**
Player / donor / Media roles: own-ticket permissions only.

Sensitivity:
- Category `is_sensitive = true` (currently only `staff_complaint`): subject & body must be hidden outside the senior channel.
  The existing webhook replaces subject and excerpt with "Текст скрыт: чувствительная категория".
- **The internal API returns full subject/bodies for sensitive tickets** and does not expose `is_sensitive` — the bot
  must decide by `category` key (or a new endpoint) and route such tickets to a restricted channel only.

---

## 6. Existing one-way Discord webhook (`TicketDiscordWebhook`)

- Target: setting `support.webhook` (must be `discord.com`/`discordapp.com`/`canary.`/`ptb.` with `/api/webhooks/`). Currently set.
- Sent after DB commit, `timeout 5s`, failures swallowed (`rescue`), no retry, no queue.
- Payload (Discord execute-webhook JSON):
```json
{
  "username": "<site name, ≤80 chars>",
  "embeds": [{
    "title": "Новое обращение COINT-1207",
    "url": "{SITE_URL}/admin/support/tickets/COINT-1207",
    "color": 19942,
    "timestamp": "2026-10-06T10:00:00+05:00",
    "author": { "name": "<actor name>" },
    "fields": [
      { "name": "Тема", "value": "<subject ≤200 | hidden>", "inline": true },
      { "name": "Категория", "value": "<category name>", "inline": true },
      { "name": "Автор", "value": "<owner name>", "inline": true },
      { "name": "Кто изменил", "value": "<actor | Система>", "inline": false },
      { "name": "Статус", "value": "<status label>", "inline": false },
      { "name": "Изменение", "value": "<from> → <to>", "inline": false },
      { "name": "Текст", "value": "<body ≤900 | hidden>", "inline": false }
    ]
  }]
}
```
(Extra fields depend on the event; colors are hex strings converted by the core Embed class.)

Events and titles (`support::messages.webhook.events.*`):

| event | title (ru) | extra fields | trigger |
|---|---|---|---|
| `created` | Новое обращение :number | Текст (first public message) | ticket created |
| `user_replied` | Игрок ответил в :number | Кто изменил, Статус, Текст | owner public reply |
| `staff_replied` | Персонал ответил в :number | Кто изменил, Статус, Текст | non-owner public reply |
| `internal_note` | Внутренняя заметка в :number | Кто изменил (no text) | internal note |
| `status` / `resolved` / `closed` / `reopened` | Статус :number изменён / … решено / … закрыто / … открыто снова | Кто изменил, Изменение | explicit status change (not auto-transitions) |
| `priority` | Приоритет :number изменён | Кто изменил, Изменение | |
| `category` | Категория :number изменена | Кто изменил, Изменение | |
| `assigned` / `unassigned` | Назначен исполнитель в :number / Исполнитель снят с :number | Кто изменил, Изменение | |
| `team` | Команда :number изменена | Кто изменил, Изменение | |
| `merged` | :source объединён с :target | Кто изменил, Изменение | |

Not sent: attachments, auto status transitions, merge-close of the source ticket (only `merged`).
The embed does **not** carry `source`, so messages that came *from* Discord via the API are echoed back by the webhook.
This webhook is meant to be **switched off** once the bot posts into ticket threads (otherwise duplicate feeds).

---

## 7. Known gaps / required site-side work

Critical for a safe two-way sync:
1. **API disabled**: `SUPPORT_INTERNAL_API` / `SUPPORT_INTERNAL_TOKEN` not set.
2. **No author permission check** on `messages`, `status`, `attachments`: any `user_id` is accepted; any non-owner becomes
   `author_type=staff`. The bot must enforce "Хелпер+ / `tickets.staff.reply`" itself — better: site checks `TicketPolicy`
   for the given `user_id` (reply / internal_note / changeStatus) and returns 403.
3. **No dedup by `external_message_id`**: index is not unique, value is saved after creation, and webhooks/notifications fire
   even on retries. Needs: unique `(source, external_message_id)` (or lookup-before-insert) and passing it into
   `reply()` inside the transaction; return the existing message (200) on replay.
4. **No outbox / change feed**: no "list tickets/messages/events since cursor" endpoint and no webhook carrying ticket data.
   The bot cannot learn about website-side changes except by parsing the human-readable webhook embed. Needs an outbox table
   (or `GET /events?after_id=`) with event id, ticket number, type, message id, source.
5. **Loop risk**: API-created messages trigger `staff_replied`/`user_replied` webhooks; payload lacks `source`/`external_message_id`.
   The outbox must include `source` so the bot skips its own (`source=discord`) messages; the bot must ignore webhook/bot authors.
6. **No Discord↔account lookup**: no endpoint to resolve `discord_user_id → user_id (+ role, permissions)`; `discord_accounts.discord_user_id`
   is not unique. Needs e.g. `GET /api/internal/users/by-discord/{id}` returning `user_id`, name, role, staff permission flags.
7. **Payload too thin** (§2.8): missing ticket id, owner, assignee, team, timestamps, message author/created_at, attachments, category name/sensitivity.

Important:
8. No endpoints for assign/claim, priority, category, team, merge, list/search tickets, categories list, or find-by-reference.
9. `GET /attachments/{id}` is not ticket-scoped and ignores internal/sensitive visibility.
10. `storeReference` silently re-points an existing triple to another ticket (no conflict error).
11. Status changes via API skip the player notifications that the website sends on resolve/close.
12. Single shared rate bucket (60 req/min per IP) for the whole bot; per-author reply limit 10/min still applies.
13. `source=system` on create bypasses anti-spam; the bot should never send it for player-initiated tickets.
14. Message edits/deletes are not supported (no endpoint); Discord edits will not propagate.
15. Webhook sends are synchronous, best-effort (5s timeout, no retry).
16. Metrics: `first_response_at` is populated only for tickets after the 2026-09-23 migration; historic first-response
    must be derived from the first non-internal `staff` message.
