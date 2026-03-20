# Cloudflare WAF Rules — Chess Tournament Platform

## Rate Limiting Rules

### Rule 1: Global API Rate Limit
- **Expression**: `http.request.uri.path starts_with "/api/v1/"`
- **Action**: Rate limit — 100 requests per 10 seconds per IP
- **Response**: 429 Too Many Requests

### Rule 2: Auth Endpoint Protection
- **Expression**: `http.request.uri.path starts_with "/api/v1/auth/"`
- **Action**: Rate limit — 10 requests per minute per IP
- **Response**: 429 Too Many Requests

### Rule 3: Registration Anti-Abuse
- **Expression**: `http.request.uri.path starts_with "/api/v1/registrations" and http.request.method eq "POST"`
- **Action**: Rate limit — 5 requests per minute per IP
- **Response**: 429 Too Many Requests

## IP Access Rules

### Rule 4: Razorpay Webhook IP Allowlist
- **Expression**: `http.request.uri.path eq "/api/v1/payments/webhook"`
- **Action**: Allow only from Razorpay IP ranges:
  - `52.66.166.0/24` (Mumbai)
  - `13.232.0.0/16` (ap-south-1)
  - Refer to [Razorpay docs](https://razorpay.com/docs/webhooks/#allowed-ips) for latest ranges
- **Else**: Block with 403

## Managed Rules

### Rule 5: OWASP Core Rule Set
- Enable Cloudflare Managed Ruleset (OWASP)
- Sensitivity: High
- Action: Block

### Rule 6: Bot Management
- Block verified bots on `/api/v1/registrations` (POST)
- Allow verified bots on `/api/v1/tournaments` (GET) for SEO

## Security Headers (applied via Transform Rules)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
