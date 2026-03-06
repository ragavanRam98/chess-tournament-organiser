# API Contract Specification
## Chess Tournament Entry Platform — v2.2

> **Base URL:** `https://api.chesstournament.in/api/v1`
> **Format:** JSON. All requests with a body send `Content-Type: application/json`.
> **Auth:** `Authorization: Bearer <access_token>` unless noted. Refresh token via `httpOnly` cookie.

---

## Global Conventions

### Request / Response Envelope

**Success:**
```json
{ "data": { ... }, "meta": { "cursor": "...", "hasMore": true } }
```

**Error:**
```json
{ "error": { "code": "SEAT_LIMIT_REACHED", "message": "Category U10 is full." } }
```

### Standard Error Codes

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | DTO validation failed |
| `UNAUTHORIZED` | 401 | Missing or expired access token |
| `FORBIDDEN` | 403 | Valid token but insufficient role/ownership |
| `NOT_FOUND` | 404 | Resource not found |
| `DUPLICATE_REGISTRATION` | 409 | Same phone already registered for tournament |
| `SEAT_LIMIT_REACHED` | 409 | Category has no remaining seats |
| `TOURNAMENT_NOT_ACCEPTING` | 409 | Tournament status does not allow registration |
| `TOURNAMENT_CANCELLED` | 409 | Tournament has been cancelled |
| `PAYMENT_ALREADY_PROCESSED` | 409 | Webhook for this payment already received |
| `TOO_MANY_REQUESTS` | 429 | Phone rate limit exceeded (3/hour/tournament) |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

### Pagination

Cursor-based. Pass `cursor` from previous response `meta.cursor`. Default `limit=20`, max `limit=100`.

---

## Auth Endpoints

### `POST /auth/login`

**Auth:** None

**Request:**
```json
{ "email": "organizer@academy.com", "password": "••••••••" }
```

**Response 200:**
```json
{
  "data": {
    "access_token": "eyJ...",
    "token_type": "Bearer",
    "expires_in": 900
  }
}
```
Sets `Set-Cookie: refresh_token=<token>; HttpOnly; Secure; SameSite=Strict; Path=/auth/refresh; MaxAge=604800`

**Errors:** `401 UNAUTHORIZED` (invalid credentials), `400 VALIDATION_ERROR`

---

### `POST /auth/refresh`

**Auth:** `refresh_token` cookie

**Response 200:**
```json
{ "data": { "access_token": "eyJ...", "expires_in": 900 } }
```

**Errors:** `401 UNAUTHORIZED` (token revoked or expired)

---

### `POST /auth/logout`

**Auth:** Bearer

**Response 200:** `{ "data": { "success": true } }`

---

## Organizer — Tournament Endpoints

### `GET /organizer/tournaments`

**Auth:** Organizer

**Query params:** `status` (enum: DRAFT|PENDING_APPROVAL|APPROVED|ACTIVE|CLOSED|REJECTED|CANCELLED), `cursor`, `limit`

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Summer Open 2026",
      "city": "Chennai",
      "start_date": "2026-04-10",
      "end_date": "2026-04-12",
      "registration_deadline": "2026-04-05",
      "status": "APPROVED",
      "categories": [
        { "id": "uuid", "name": "U10", "entry_fee_paise": 30000, "max_seats": 50, "registered_count": 12 }
      ],
      "created_at": "2026-03-01T10:00:00Z"
    }
  ],
  "meta": { "cursor": "...", "hasMore": false }
}
```

---

### `POST /organizer/tournaments`

**Auth:** Organizer

**Request:**
```json
{
  "title": "Summer Open 2026",
  "description": "Annual open tournament hosted by Easy Chess Academy.",
  "city": "Chennai",
  "venue": "Sathyabama Institute, Chennai",
  "start_date": "2026-04-10",
  "end_date": "2026-04-12",
  "registration_deadline": "2026-04-05",
  "categories": [
    {
      "name": "U10",
      "min_age": 0,
      "max_age": 10,
      "entry_fee_paise": 30000,
      "max_seats": 50
    },
    {
      "name": "U14",
      "min_age": 11,
      "max_age": 14,
      "entry_fee_paise": 40000,
      "max_seats": 60
    },
    {
      "name": "Open",
      "min_age": 0,
      "max_age": 999,
      "entry_fee_paise": 50000,
      "max_seats": 100
    }
  ]
}
```

**Validation rules:**
- `start_date` must be in the future
- `registration_deadline` must be before `start_date`
- `end_date` must be >= `start_date`
- At least one category required
- `min_age` must be <= `max_age`
- `entry_fee_paise` >= 0
- `max_seats` >= 1

**Response 201:**
```json
{
  "data": {
    "id": "uuid",
    "status": "PENDING_APPROVAL",
    "title": "Summer Open 2026",
    "created_at": "2026-03-06T04:20:00Z"
  }
}
```

---

### `PATCH /organizer/tournaments/:id`

**Auth:** Organizer (must own tournament)

**Constraint:** Only allowed when `status = DRAFT`. Returns `409` otherwise.

**Request:** Partial update — include only fields to change. Categories follow same validation as POST.

**Response 200:** Updated tournament object.

---

### `GET /organizer/tournaments/:id/registrations`

**Auth:** Organizer (must own tournament)

**Query params:** `status` (default: CONFIRMED), `category_id`, `cursor`, `limit`

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "entry_number": "ECA-2026-000042",
      "player_name": "Arjun Sharma",
      "player_dob": "2016-07-15",
      "age_at_tournament": 9,
      "phone": "+919876543210",
      "email": "parent@example.com",
      "city": "Chennai",
      "fide_id": "5021234",
      "fide_rating": 1200,
      "category": { "id": "uuid", "name": "U10" },
      "payment": { "status": "PAID", "amount_paise": 30000 },
      "status": "CONFIRMED",
      "confirmed_at": "2026-03-06T05:00:00Z"
    }
  ],
  "meta": { "total_count": 1, "cursor": null, "hasMore": false }
}
```

---

### `POST /organizer/tournaments/:id/exports`

**Auth:** Organizer (must own tournament)

**Request:**
```json
{ "format": "xlsx" }
```
Allowed values: `xlsx`, `csv`.

**Response 202:**
```json
{
  "data": {
    "export_job_id": "uuid",
    "status": "QUEUED",
    "format": "xlsx",
    "requested_at": "2026-03-06T06:00:00Z",
    "expires_at": "2026-04-05T06:00:00Z"
  }
}
```

---

### `GET /organizer/exports/:jobId`

**Auth:** Organizer (must own export job)

**Response 200 (pending):**
```json
{ "data": { "export_job_id": "uuid", "status": "PROCESSING" } }
```

**Response 200 (ready):**
```json
{
  "data": {
    "export_job_id": "uuid",
    "status": "DONE",
    "format": "xlsx",
    "download_url": "https://r2.chesstournament.in/org-id/tourn-id/job-id.xlsx?X-Amz-Signature=...",
    "download_url_expires_at": "2026-03-06T06:15:00Z",
    "expires_at": "2026-04-05T06:00:00Z"
  }
}
```

---

## Player — Public Endpoints

### `GET /tournaments`

**Auth:** None

**Query params:** `city`, `status` (default: APPROVED,ACTIVE), `from_date`, `to_date`, `cursor`, `limit`

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Summer Open 2026",
      "city": "Chennai",
      "venue": "Sathyabama Institute",
      "start_date": "2026-04-10",
      "end_date": "2026-04-12",
      "registration_deadline": "2026-04-05",
      "organizer": { "academy_name": "Easy Chess Academy" },
      "categories": [
        { "id": "uuid", "name": "U10", "entry_fee_paise": 30000, "seats_available": 38 }
      ],
      "status": "APPROVED"
    }
  ],
  "meta": { "cursor": null, "hasMore": false }
}
```

---

### `GET /tournaments/:id`

**Auth:** None

**Response 200:** Full tournament object including all categories with seat availability.

**Errors:** `404 NOT_FOUND`, `403 FORBIDDEN` (if tournament not APPROVED or ACTIVE)

---

### `POST /tournaments/:id/categories/:catId/register`

**Auth:** None

**Rate limit:** 3 attempts per phone number per tournament per hour (HTTP 429 on breach).

**Request:**
```json
{
  "player_name": "Arjun Sharma",
  "player_dob": "2016-07-15",
  "phone": "+919876543210",
  "email": "parent@example.com",
  "city": "Chennai",
  "fide_id": "5021234",
  "fide_rating": 1200
}
```

**Validation:**
- `player_name`: 2–100 chars
- `player_dob`: valid date, not in the future
- `phone`: valid E.164 format
- `email`: valid email
- `city`: 2–100 chars
- `fide_id`: optional, alphanumeric up to 20 chars
- `fide_rating`: optional, 0–3500
- Age derived from `player_dob` must fall within category `min_age`–`max_age` at tournament `start_date`

**Response 201:**
```json
{
  "data": {
    "registration_id": "uuid",
    "entry_number": "ECA-2026-000043",
    "status": "PENDING_PAYMENT",
    "expires_at": "2026-03-06T08:00:00Z",
    "payment": {
      "razorpay_order_id": "order_xxx",
      "razorpay_key_id": "rzp_live_xxx",
      "amount_paise": 30000,
      "currency": "INR"
    }
  }
}
```

**Errors:** `409 DUPLICATE_REGISTRATION`, `409 SEAT_LIMIT_REACHED`, `409 TOURNAMENT_NOT_ACCEPTING`, `409 TOURNAMENT_CANCELLED`, `429 TOO_MANY_REQUESTS`, `400 VALIDATION_ERROR`

---

### `GET /registrations/:entryNumber/status`

**Auth:** None

**Response 200:**
```json
{
  "data": {
    "entry_number": "ECA-2026-000043",
    "player_name": "Arjun Sharma",
    "tournament": { "title": "Summer Open 2026", "start_date": "2026-04-10" },
    "category": "U10",
    "status": "CONFIRMED",
    "confirmed_at": "2026-03-06T06:05:00Z"
  }
}
```

---

## Payment Endpoints

### `POST /payments/webhook`

**Auth:** None. Protected by HMAC-SHA256 signature (`X-Razorpay-Signature` header).

**CRITICAL:** Raw body must be read before any JSON parsing. Signature mismatch returns `400` and logs the attempt — no further processing.

**Supported events:** `payment.captured`, `payment.failed`

**Request body (from Razorpay):**
```json
{
  "event": "payment.captured",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_xxx",
        "order_id": "order_xxx",
        "amount": 30000,
        "currency": "INR",
        "status": "captured"
      }
    }
  }
}
```

**Response on success:** `200 OK` with body `{ "status": "ok" }`. Must respond within 3 seconds (Razorpay timeout).

**Idempotency:** If `razorpay_payment_id` already exists with status `PAID`, return `200` without reprocessing.

---

## Admin Endpoints

### `GET /admin/tournaments`

**Auth:** Super Admin

**Query params:** `status`, `organizer_id`, `city`, `from_date`, `to_date`, `cursor`, `limit`

**Response 200:** Paginated tournament list with organizer info.

---

### `PATCH /admin/tournaments/:id/status`

**Auth:** Super Admin

**Request:**
```json
{
  "status": "APPROVED",
  "rejection_reason": null
}
```

Allowed transitions:
- `PENDING_APPROVAL → APPROVED`
- `PENDING_APPROVAL → REJECTED` (requires `rejection_reason`)
- `APPROVED → CANCELLED` (requires `cancellation_reason`)
- `ACTIVE → CANCELLED` (requires `cancellation_reason`)

**Response 200:** Updated tournament object.

**Side effects:**
- Audit log entry written on every transition
- On `APPROVED`: organizer email notification enqueued
- On `CANCELLED`: cancellation email enqueued for all CONFIRMED registrations

---

### `PATCH /admin/organizers/:id/verify`

**Auth:** Super Admin

**Request:**
```json
{ "status": "ACTIVE" }
```

**Response 200:** Updated organizer object with `verified_at` timestamp.

---

### `GET /admin/analytics`

**Auth:** Super Admin

**Response 200:**
```json
{
  "data": {
    "total_tournaments": 42,
    "total_registrations": 1840,
    "total_revenue_paise": 55200000,
    "active_organizers": 18,
    "registrations_this_month": 320,
    "top_categories": [
      { "name": "U10", "count": 620 },
      { "name": "Open", "count": 480 }
    ]
  }
}
```

---

### `GET /admin/audit-logs`

**Auth:** Super Admin

**Query params:**

| Param | Type | Description |
|---|---|---|
| `entity_type` | enum | `tournament`, `organizer`, `registration`, `payment` |
| `performed_by` | UUID | Filter by actor |
| `from` | ISO 8601 datetime | `performed_at >= from` |
| `to` | ISO 8601 datetime | `performed_at <= to` |
| `cursor` | string | Pagination |
| `limit` | integer | Default 50, max 200 |

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "entity_type": "tournament",
      "entity_id": "uuid",
      "action": "CANCELLED",
      "old_value": { "status": "ACTIVE" },
      "new_value": { "status": "CANCELLED", "cancellation_reason": "Venue unavailable" },
      "performed_by": { "id": "uuid", "email": "admin@easychess.in" },
      "performed_at": "2026-03-06T04:30:00Z"
    }
  ],
  "meta": { "cursor": "...", "hasMore": true }
}
```

---

## Export File Fields (XLSX / CSV)

Generated by the background worker for confirmed registrations only.

| Column | Field | Notes |
|---|---|---|
| Entry No. | `entry_number` | e.g., ECA-2026-000042 |
| Player Name | `player_name` | |
| Date of Birth | `player_dob` | YYYY-MM-DD |
| Age | Computed | Age at tournament start_date |
| Category | `category.name` | |
| FIDE ID | `fide_id` | Blank if not provided |
| FIDE Rating | `fide_rating` | Blank if not provided |
| City | `city` | |
| Phone | `phone` | |
| Email | `email` | |
| Payment Status | `payment.status` | PAID |
| Amount (₹) | `payment.amount_paise / 100` | Two decimal places |
| Registered At | `registered_at` | ISO 8601 |
| Confirmed At | `confirmed_at` | ISO 8601 |
