# COINT site — Internal Ticket API & data model (spec for `coint-ticket-bot`)

> Source of truth: Azuriom site, plugin `plugins/support` (Azuriom "Support" 1.1.9, heavily extended in-house).
> Produced by reading the deployed code. **Updated 2026-10-06:** event feed, categories, Discord user lookup, permission
> checks, message dedupe and webhook `source` were added on the site; later the same day (round 2) list/search,
> find-by-reference, stats, claim/assign/unassign, priority, category, ticket-scoped attachment download and feed
> retention. The API is still **disabled** (env not set).
> No secrets / hosts / personal data are included. `{SITE_URL}` = the site's public base URL (placeholder).

---

## 1. Base URL, enablement, authentication

| Item | Value |
|---|---|
| Base prefix | `{SITE_URL}/api/internal/tickets` (+ `{SITE_URL}/api/internal/users/...`) |
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
'outbox_retention_days'    => 90,     // env SUPPORT_OUTBOX_RETENTION_DAYS (optional); feed rows older than this are purged daily
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

All paths are relative to `{SITE_URL}/api/internal/tickets` unless stated otherwise.
`user_id` = the **site** account acting (resolve a Discord user via §2.11 first).

Common write-endpoint rules (since 2026-10-06):
- The acting user must not be deleted/banned → **403** `{"code":"user_deleted"|"user_banned"}`.
- Permissions are checked with the site `TicketPolicy` → **403** `{"message": "...", "code": "forbidden_*"}`.
- The request `source` (`website`/`discord`/`system`) is recorded on the change and in the event feed (§2.9).
- Management endpoints (§2.12–2.15) go through the same services as the admin panel: ticket history
  (`support_ticket_events`), Discord webhook (§6) and feed event are produced exactly as for a website action.

Route overview:

| Method | Path | § |
|---|---|---|
| GET | `/` (list/search) | 2.16 |
| POST | `/` | 2.1 |
| GET | `/events` · `/categories` · `/by-reference` · `/stats` | 2.9 · 2.10 · 2.17 · 2.18 |
| GET | `/{ticket}` | 2.2 |
| GET | `/{ticket}/attachments/{attachment}` (preferred) · `/attachments/{attachment}` (deprecated) | 2.5 |
| POST | `/{ticket}/messages` · `/attachments` · `/status` · `/references` | 2.3 · 2.4 · 2.6 · 2.7 |
| POST | `/{ticket}/claim` · `/assign` · `/unassign` · `/priority` · `/category` | 2.12 – 2.15 |
| GET | `{SITE_URL}/api/internal/users/by-discord/{id}` | 2.11 |

### 2.1 `POST /` — create ticket
Body (JSON):

| Field | Rules | Notes |
|---|---|---|
| `user_id` | required, integer, exists in `users.id` | Ticket owner (site account). Needs `tickets.create`, else 403 `forbidden_create`. |
| `category_key` | required, string | Must match `support_categories.key` (see §2.10). Unknown → 422 `Unknown category.` |
| `subject` | required, string, max 100 | |
| `body` | required, string, max 5000 | First message (trimmed; empty → 422). |
| `server_id` | nullable, integer | **Required** if the category has `requires_server=true`; must exist in `servers`. |
| `fields` | nullable, object | Category form answers, validated per `form_schema` as `fields.<key>`. |
| `source` | optional, `website`/`discord`/`system` (default `website`) | Invalid → 422 `Unsupported ticket source.` `system` bypasses anti-spam — never use it for player-initiated tickets. |

Behaviour:
- Inactive category → 422 (`category_id`).
- Anti-spam (unless `source=system`): max active tickets (`support.max_open`) and cooldown → 422 (`subject`).
- `shop_payment`: `fields.payment_id` must be a payment owned by that user, else 422 (`fields.payment_id`).
- Priority = category `default_priority` (`urgent` downgraded to `normal` for owner-created tickets).
- Status `open`; team = category team; `public_number` auto-generated (`COINT-<n>`).
- `metadata` gets context incl. `discord.{discord_user_id,name}` if the owner has linked Discord.
- Side effects: staff site notifications, Discord webhook `created`, feed event `created` (with `message_id` of the first message).

Response **201** — ticket payload (§2.8), public messages only.

### 2.2 `GET /{ticket}` — show ticket
Query: `include_internal` (bool, default false) — include internal notes and their attachments.
Response **200** — ticket payload (§2.8).

### 2.3 `POST /{ticket}/messages` — add message (reply or internal note)
Body (JSON):

| Field | Rules | Notes |
|---|---|---|
| `user_id` | required, integer, exists | Author (site account). |
| `body` | required, string, max 5000 | Trimmed. |
| `is_internal` | nullable, boolean (default false) | Internal staff note. |
| `external_message_id` | nullable, string, max 191 | Discord message snowflake. **Idempotency key** together with `source`. |
| `source` | optional (**default `discord`**) | |

Order of checks:
1. If `external_message_id` is given and a message with the same `(source, external_message_id)` exists:
   - same ticket → **200** with that message and `"duplicate": true` (no new row, **no webhook, no notifications, no feed event**);
   - another ticket → **409** `{"code":"external_message_conflict","ticket_number":"COINT-…","id":…}`.
2. Author deleted/banned → 403.
3. Permission (`TicketPolicy`):
   - author is the ticket owner → needs `tickets.reply_own`;
   - otherwise public reply → staff must see the ticket (sensitive → `view_sensitive`; `view_all`, or `view` + unassigned/assigned to self) **and** have `tickets.staff.reply` → else 403 `forbidden_reply`;
   - `is_internal=true` → see the ticket + `tickets.staff.internal_notes` → else 403 `forbidden_internal_note`.
   Staff is therefore determined by permission; the service also refuses non-owners without the staff permission.
4. Ticket `closed`/merged → 422 (`body`); owner internal note → 422 (`visibility`); public replies throttled 10/min per author → 422 (`body`).
5. Insert happens with `external_message_id` in the same transaction; a concurrent duplicate hits the unique index and is answered like step 1.

Status auto-transitions (no `status` webhook, but recorded as feed events):
owner reply: `waiting_for_user`/`resolved`/`in_progress` → `waiting_for_staff`; staff reply: `open`/`in_progress`/`waiting_for_staff`/`resolved` → `waiting_for_user` (+ `first_response_at`).

Response **201** (new) / **200** (duplicate):
```json
{ "id": 1234, "is_internal": false, "author_type": "staff", "duplicate": false }
```

### 2.4 `POST /{ticket}/attachments` — upload attachment
`multipart/form-data`: `user_id` (required), `message_id` (nullable, must belong to this ticket → else 404), `file` (required, ≤ 8192 KB), `source` (optional, default `discord`).
Permission: attaching to an internal message → `internal_notes` rule; otherwise the reply rule (§2.3) → 403 `forbidden_attachment`.
Allowed types (extension **and** detected MIME): png, jpg/jpeg, webp, txt, log (no NUL bytes), zip, mp4 → else 422 (`attachments`).
Feed event `attachment_added` (`payload.attachment_id`, `payload.name`). No webhook.
Response **201**: `{ "id": 55 }`

### 2.5 `GET /{ticket}/attachments/{attachment}` — download attachment (ticket-scoped)
Query: `user_id` (optional, integer, exists). Streams the file.
- Attachment belongs to another ticket → **404** (same as unknown id / missing file).
- With `user_id`: needs the site download right (owner of a public attachment, or staff who can see the ticket;
  sensitive ticket → `view_sensitive`) and, for attachments of internal notes, the internal-notes right → else
  **403** `forbidden_attachment_download`. Deleted/banned → 403 `user_deleted`/`user_banned`.
- Without `user_id`: public attachments of non-sensitive tickets only; an internal-note attachment or any attachment
  of a sensitive ticket → **403** `user_required`.

**Deprecated:** `GET /attachments/{attachment}` (numeric id, not ticket-scoped) still works for compatibility and
applies the same `user_id` / `user_required` rules (behaviour change vs. before: internal/sensitive attachments now
require `user_id`). Migrate to the ticket-scoped path.

### 2.6 `POST /{ticket}/status` — change status
Body: `status` (required, §3.1), `user_id` (integer, exists — **required unless `source=system`**, else 422 `user_id`), `source` (optional, default `discord`).
Permission: owner may only set `closed` (`reply_own`); staff: `closed` → `tickets.staff.close`, other statuses → `tickets.staff.change_status` (plus ticket visibility) → else 403 `forbidden_status`.
Invalid transition → 422 (`status`). Same status → no-op.
`resolved` / `closed` by a user now also send the player notification (same as the website).
Response **200** — ticket payload (§2.8).

### 2.7 `POST /{ticket}/references` — link an external object
Body: `provider` (required, ≤50, not `launcher`), `external_type` (required, ≤50), `external_id` (required, ≤191), `metadata` (object, optional), `move` (bool, optional).
Unique key `(provider, external_type, external_id)`:
- new → **201**; already on this ticket → **200** (metadata replaced);
- already on another ticket → **409** `{"code":"reference_conflict","ticket_number":"COINT-…"}` unless `move: true` (then re-pointed, 201).

Response: `{ "id": 7, "provider": "discord", "external_type": "thread", "external_id": "123456789012345678" }`

### 2.8 Ticket payload (create / show / status / management / by-reference)
```json
{
  "id": 207,
  "public_number": "COINT-1207",
  "status": "waiting_for_staff",
  "priority": "normal",
  "source": "website",
  "subject": "Не заходит на сервер",
  "category": "technical",
  "category_name": "Техническая проблема",
  "is_sensitive": false,
  "team": "technical",
  "owner_user_id": 123,
  "assignee_user_id": null,
  "server_id": 2,
  "merged_into": null,
  "created_at": "2026-10-06T10:00:00+05:00",
  "updated_at": "2026-10-06T10:05:00+05:00",
  "first_response_at": null,
  "resolved_at": null,
  "closed_at": null,
  "last_activity_at": "2026-10-06T10:05:00+05:00",
  "sla_due_at": "2026-10-07T10:00:00+05:00",
  "is_overdue": false,
  "messages": [
    {
      "id": 901,
      "body": "Текст сообщения",
      "is_internal": false,
      "author_type": "user",
      "author_user_id": 123,
      "source": "website",
      "external_message_id": null,
      "created_at": "2026-10-06T10:00:00+05:00"
    }
  ],
  "attachments": [
    { "id": 55, "message_id": 901, "original_name": "latest.log", "mime_type": "text/plain", "size": 20480, "created_at": "2026-10-06T10:00:00+05:00" }
  ],
  "references": [
    { "provider": "discord", "external_type": "thread", "external_id": "123456789012345678" }
  ]
}
```
All original keys are unchanged; the rest were added (additive, backwards compatible).
`sla_due_at` = `created_at` + first-response target of the **current** priority (not stored, so a priority change moves it);
`is_overdue` = the site's own overdue rule (`Ticket::isOverdue()`, the same one the admin panel uses for its overdue badge/queue), e.g. an already answered ticket is not overdue even if `sla_due_at` is past.
Timestamps are ISO-8601 with the
server offset. Internal messages/attachments only with `include_internal=1` (show). Bodies of sensitive tickets **are**
returned — route them by `is_sensitive` to the restricted channel only.

### 2.9 `GET /events?after_id=&limit=` — change feed (outbox)
Query: `after_id` (int ≥ 0, default 0), `limit` (1–500, default 100). Ordered by `id` ascending; `id` is the cursor.
```json
{
  "data": [
    {
      "id": 1842,
      "ticket_id": 207,
      "ticket_number": "COINT-1207",
      "category": "technical",
      "is_sensitive": false,
      "event_type": "message_created",
      "source": "discord",
      "actor_user_id": 45,
      "message_id": 901,
      "payload": { "author_type": "staff", "is_internal": false },
      "created_at": "2026-10-06T10:00:00+05:00"
    }
  ],
  "next_after_id": 1842,
  "has_more": false
}
```
- `event_type`: every `TicketEventType` (§3.5) **except** `internal_note_added`, plus `message_created`
  (any new message after ticket creation, incl. internal notes with `payload.is_internal=true`).
  Ticket creation emits only `created` (with `message_id` of the first message), not `message_created`.
- `source`: where the change came from — `website` (site UI), `discord` (internal API, default), `system` (cron/console, or API with `source=system`).
  For `created` it is the ticket's source. **Skip `source=discord` events you produced yourself** (loop guard); still
  use them for state if needed (e.g. auto status change after your reply).
- No message text in the feed. Fetch bodies via §2.2.
- `is_sensitive=true`: `payload` is reduced to non-textual keys (ids, statuses); e.g. attachment file names are removed.
- `payload` per type = §3.5; `message_created` → `{author_type, is_internal}`.
- Rows are written in the same DB transaction as the change (no lost/phantom events). The feed starts empty
  (deployed 2026-10-06); there is no backfill of older history.
- **Retention:** rows older than `support.outbox_retention_days` (default 90) are deleted daily at 03:30 by the
  scheduled command `support:purge-outbox` (manual: `php artisan support:purge-outbox [--days=N]`). A bot that is
  offline longer than the retention window must resync from §2.16/§2.2 instead of the feed.
- Poll with `after_id = last processed id`; persist the cursor on the bot side.

### 2.10 `GET /categories`
```json
{ "data": [
  { "key": "shop_payment", "name": "Магазин и оплата", "description": "…", "is_active": true, "is_sensitive": false,
    "requires_server": false, "default_priority": "normal", "team": "payments",
    "form_schema": { "fields": [ { "key": "payment_id", "type": "text", "required": true, "label": "Номер платежа" } ] } }
] }
```
Ordered by `sort_order`. `options` appears on a field only for `select`.

### 2.11 `GET {SITE_URL}/api/internal/users/by-discord/{discord_user_id}`
Same auth/enable flags. `discord_user_id` must be 5–25 digits → else 422 `invalid_discord_id`.
- not linked → **404** `{"code":"discord_not_linked"}` (tell the user to link Discord in the site profile);
- linked to several site accounts (no unique index in `discord_accounts`) → **409** `{"code":"discord_link_conflict","user_ids":[…]}`;
- linked account deleted → **404** `{"code":"user_deleted"}`;
- several rows for the same user → the most recently updated one is used.

Response **200**:
```json
{
  "user_id": 123,
  "name": "Player123",
  "discord_name": "player123",
  "role": "Хелпер",
  "role_id": 13,
  "role_power": 5,
  "is_banned": false,
  "permissions": {
    "can_view_tickets": true,
    "can_view_all_tickets": true,
    "can_reply": true,
    "can_internal_notes": true,
    "can_view_sensitive": false,
    "can_change_status": true,
    "can_change_priority": true,
    "can_assign": true,
    "can_close": true,
    "can_create_tickets": true,
    "can_reply_own": true,
    "is_admin": false
  }
}
```
Flags are computed with the same `TicketAccess` rules as the site (admin roles → all true). They are global flags;
per-ticket visibility (sensitive / assigned to someone else) is still enforced by the write endpoints.


### 2.12 `POST /{ticket}/claim` — take the ticket
Body: `user_id` (required), `source` (optional, default `discord`).
Permission `tickets.staff.assign` + ticket visibility → else **403** `forbidden_assign`. Already assigned to that user → no-op.
History `assigned`, webhook `assigned`, feed `assigned`. Response **200** — ticket payload (§2.8).

### 2.13 `POST /{ticket}/assign` — set assignee and/or team
Body: `user_id` (required, actor), `assignee_user_id` (integer or `null` = unassign), `team` (team key or `null` = no team),
`source` (optional). At least one of `assignee_user_id` / `team` must be **present** → else 422.
- Actor needs `tickets.staff.assign` + ticket visibility → else **403** `forbidden_assign`.
- Assignee must be active (not deleted/banned), have `tickets.staff.view`, and `view_sensitive` for a sensitive
  ticket → else **422** (`assignee_user_id`). Unknown team key → **422** (`team`).
- Unchanged values are skipped (no event). Feed: `assigned` / `unassigned` / `team_changed`.

`POST /{ticket}/unassign` — body `user_id`, `source?`; same permission; removes the assignee (feed `unassigned`).
Response **200** — ticket payload.

### 2.14 `POST /{ticket}/priority`
Body: `user_id`, `priority` (§3.2), `source?`. Permission `tickets.staff.change_priority` + visibility → else
**403** `forbidden_priority`. Same priority → no-op. SLA is recomputed implicitly (see `sla_due_at`, §2.8).
History/webhook/feed `priority_changed`. Response **200** — ticket payload.

### 2.15 `POST /{ticket}/category`
Body: `user_id`, `category_key` (must exist → else 422), `server_id` (optional), `source?`.
Permission: `tickets.staff.change_status` + visibility (same as the admin panel), and moving **into** a sensitive
category requires `view_sensitive` → else **403** `forbidden_category`. The team follows the admin logic of
`TicketService::changeCategory`. History/webhook/feed `category_changed`. Response **200** — ticket payload.

### 2.16 `GET /` — list / search tickets
Query:

| Param | Notes |
|---|---|
| `user_id` | **required** — the requesting site account; results are limited to what it may see |
| `queue` | `all` (default) · `inbox` (open) · `mine` (open, assigned to `user_id`) · `unassigned` (open) · `waiting-user` · `waiting-staff` · `overdue` · `resolved` (resolved + closed) — same as the admin queues |
| `status`, `priority`, `source` | enum filters |
| `category`, `team` | keys; an unknown key returns an empty page |
| `assignee_user_id` | integer or `none` |
| `server_id`, `from`, `to` | `from`/`to` = creation date (inclusive, `YYYY-MM-DD`) |
| `q` | number or subject substring (`COI-…` is normalized to `COINT-…`), max 100 chars |
| `page`, `per_page` | default 1 / 30, `per_page` 1–100 |

Visibility: staff (`staff.view`/`view_all`) → the staff visibility rule (sensitive only with `view_sensitive`;
`view` without `view_all` → unassigned + own); otherwise `tickets.view_own` → own tickets only; neither → **403**
`forbidden_view`. Deleted/banned → 403. Sorted by `last_activity_at` desc.
```json
{ "data": [ { "id": 207, "public_number": "COINT-1207", "status": "open", "priority": "normal", "source": "discord",
              "subject": "…", "category": "technical", "category_name": "…", "is_sensitive": false, "team": "technical",
              "owner_user_id": 123, "assignee_user_id": null, "created_at": "…", "first_response_at": null,
              "last_activity_at": "…", "sla_due_at": "…", "is_overdue": false,
              "references": [ { "provider": "discord", "external_type": "thread", "external_id": "…" } ] } ],
  "meta": { "page": 1, "per_page": 30, "total": 1, "last_page": 1 } }
```
List items are a summary (no messages/attachments); fetch details via §2.2.

### 2.17 `GET /by-reference` — find a ticket by external object
Query: `provider` (required), `external_type` (optional), `external_id` (required), `user_id` (optional),
`include_internal` (optional bool). Example: `provider=discord&external_type=thread&external_id=<thread id>`.
- not found → **404** `reference_not_found`;
- several tickets (only possible without `external_type`) → **409** `reference_ambiguous` with `ticket_numbers`;
- with `user_id`: must be allowed to view the ticket (and to see internal notes if `include_internal=1`) → else **403** `forbidden_view`.
Response **200** — full ticket payload (§2.8).

### 2.18 `GET /stats` — support statistics
Query: `from`, `to` (dates, inclusive; default = last 30 days up to now; `from > to` or > 366 days → 422),
`user_id` (optional; if given it needs `tickets.staff.view` → else **403** `forbidden_stats`).
Scope: tickets **created** in the period (merged tickets excluded); staff activity = public staff messages and
resolve/close events in the period. No player names, subjects or message text are returned (staff names/roles are).
```json
{
  "period": { "from": "…", "to": "…" },
  "tickets": { "created": 120, "by_status": {"open": 10}, "by_priority": {"normal": 100}, "by_source": {"website": 90, "discord": 30},
               "by_category": {"technical": 40}, "without_staff_reply": 5 },
  "first_response": { "count": 110, "avg_seconds": 5400, "median_seconds": 1800 },
  "resolution":     { "count": 95,  "avg_seconds": 86400, "median_seconds": 43200 },
  "sla": { "measured": 110, "met": 100, "breached": 10, "pending": 3, "met_rate": 0.9091,
           "targets_minutes": { "low": 2880, "normal": 1440, "high": 240, "urgent": 60 } },
  "by_channel": { "replies": {"website": 300, "discord": 80}, "first_responses": {"website": 90, "discord": 20} },
  "by_staff": [ { "user_id": 45, "name": "…", "role": "Модератор", "replies": 50, "tickets_replied": 30,
                  "replies_by_source": {"website": 40, "discord": 10}, "first_responses": 20,
                  "first_response": { "count": 20, "avg_seconds": 3600, "median_seconds": 1500 },
                  "resolved": 15, "closed": 3 } ]
}
```
- First response = `first_response_at`, or (tickets before 2026-09-23 without it) the first public staff message.
- SLA: `met` = first response within the target of the ticket's priority; `breached` = late or still unanswered past
  the target; `pending` = unanswered and still within the target (not part of `measured`).
- Resolution = `resolved_at` (or `closed_at`) − `created_at` for resolved/closed tickets.
- Channel = message `source` (`website` / `discord` / `system`). Empty maps are `{}`.

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
| `created` | `{source, category, message_id}` (message_id since 2026-10-06) |
| `assigned` / `unassigned` | `{from_user_id, to_user_id}` |
| `team_changed` | `{from_team_id, to_team_id}` |
| `status_changed` | `{from, to}` |
| `resolved` / `closed` / `reopened` | `{from, to}` (merge-close: `{source, target}`) |
| `priority_changed` | `{from, to}` |
| `category_changed` | `{from_category_id, to_category_id}` |
| `internal_note_added` | `{message_id}` |
| `attachment_added` | `{attachment_id, name}` |
| `merged` | `{source, target}` (public numbers; recorded on both tickets) |

These events (except `internal_note_added`) plus `message_created` are exposed via the feed (§2.9).

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
`source` (default `website`), `body` (text), `is_internal` (bool), `external_message_id` (string, nullable, indexed), timestamps.
**Unique** `(source, external_message_id)` (`support_ticket_messages_source_ext_unique`, NULLs allowed multiple times).
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

### 4.7b `support_ticket_outbox` (event feed, since 2026-10-06)
`id` (bigint, cursor), `ticket_id` (FK, cascade), `event_type` (≤64), `source` (≤32), `actor_user_id` (FK users, nullable),
`message_id` (nullable, no FK), `payload` (json, no message text), `created_at`. Indexes `(ticket_id, id)` and
`created_at` (for the daily retention purge, `support:purge-outbox`).

### 4.8 Discord account link (Azuriom core): `discord_accounts`
`id`, `name` (Discord username), `user_id` (FK users, cascade), `discord_user_id` (string snowflake, **no unique index**),
`access_token`, `refresh_token`, `expires_at`, timestamps. One row per user (`User::discordAccount()` hasOne).
Created via the profile "Link Discord" OAuth flow (Socialite `discord`); used for Discord Linked Roles
(`settings.discord.link_roles = 1`). The OAuth tokens are secrets and must never be exposed to the bot.
(`social_links` is an unrelated table for profile social links.) Some Discord ids are currently linked to 2 site accounts → lookup returns 409 for them.
Roles: `users.role_id` → `roles(id, name, power, is_admin)`; permissions: `permissions(role_id, permission)`.

---

## 5. Permissions & privacy rules

Permission keys (checked by `TicketPolicy` / `TicketAccess` on the website **and, since 2026-10-06, on the internal API write endpoints**):

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
- Applied by the internal API to every write endpoint, the list/search, by-reference (when `user_id` given), stats and attachment download.
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
- The internal API returns full subject/bodies for sensitive tickets but now exposes `is_sensitive` (ticket payload, feed,
  categories). Route such tickets to a restricted channel only; the feed never carries their text.

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
Since 2026-10-06 every embed has a footer `source: <website|discord|system> · COINT-1207` — the bot can ignore
webhook posts with `source: discord` if the webhook is still enabled during migration.

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
Messages that came *from* Discord via the API are still posted by the webhook (footer `source: discord`).
This webhook is meant to be **switched off** once the bot posts into ticket threads (otherwise duplicate feeds).

---

## 7. Known gaps / status (2026-10-06)

Done on the site (code + migrations deployed, covered by tests):
- ✅ #2 permission checks on write endpoints (403 + `code`), staff by permission, banned/deleted users rejected.
- ✅ #3 dedupe: unique `(source, external_message_id)`, written in the insert transaction, idempotent 200 replay without webhook/notifications, 409 on cross-ticket reuse.
- ✅ #4/#5 event feed `GET /events` with `source`, `is_sensitive`, no text; webhook embeds carry `source` in the footer.
- ✅ #6 `GET /api/internal/users/by-discord/{id}` (404 / 409 / 200 with permission flags).
- ✅ #7 categories endpoint and enriched ticket payload (ids, owner, assignee, team, timestamps, message author/time, attachments, `is_sensitive`, `sla_due_at`, `is_overdue`).
- ✅ #10 reference conflicts → 409 unless `move: true`.
- ✅ #11 resolve/close via API send player notifications.
- ✅ claim / assign / unassign / team, priority, category endpoints (§2.12–2.15) with admin-equivalent history/webhook/feed.
- ✅ list/search with admin queues and filters, pagination, permission-aware visibility (§2.16); find by reference (§2.17).
- ✅ ticket-scoped attachment download with internal/sensitive checks (§2.5); old path deprecated but compatible.
- ✅ feed retention: daily `support:purge-outbox` (90 days, configurable) + `created_at` index.
- ✅ stats endpoint (§2.18): counts, first response / resolution avg+median, SLA, per staff and per channel.

Still open:
1. **API disabled**: `SUPPORT_INTERNAL_API` / `SUPPORT_INTERNAL_TOKEN` not set (intentional until the bot is ready).
2. No endpoints for merge or server change alone (category endpoint accepts `server_id`); no message edits/deletes.
3. Single shared rate bucket (60 req/min per IP); per-author reply limit 10/min. Stats/list are not cached — poll sparingly.
4. Webhook sends are synchronous best-effort (5s, no retry); disable `support.webhook` once the bot mirrors via the feed.
5. Feed has no backfill of pre-2026-10-06 history; retention 90 days.
6. Assign/priority/category do not send player notifications (same as the admin panel).
7. Metrics: `first_response_at` exists only for tickets after 2026-09-23; stats derive older values from the first public `staff` message.
