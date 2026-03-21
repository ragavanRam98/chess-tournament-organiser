# ♔ KingSquare — Tournament management for Indian chess

A modern, full-stack chess tournament management platform. Organizers can create FIDE-rated tournaments, manage registrations, and track payments — while participants can browse, register, and pay seamlessly.

> A product of **Easy Chess Academy**

> 🎬 **Demo Video**: See the full platform walk-through in [`docs/full-platform-demo.webp`](docs/full-platform-demo.webp)

---

## 📸 Screenshots

<p align="center">
  <img src="docs/screenshots/01-homepage.png" alt="Homepage" width="80%"/>
  <br><em>Homepage — Browse upcoming tournaments with live seat availability</em>
</p>

<p align="center">
  <img src="docs/screenshots/03-tournament-detail.png" alt="Tournament Detail" width="80%"/>
  <br><em>Tournament Detail — Categories, dates, venue info, and registration</em>
</p>

<p align="center">
  <img src="docs/screenshots/05-organizer-dashboard.png" alt="Organizer Dashboard" width="80%"/>
  <br><em>Organizer Dashboard — Stats, tournament list, and management tools</em>
</p>

<p align="center">
  <img src="docs/screenshots/08-admin-dashboard.png" alt="Admin Dashboard" width="80%"/>
  <br><em>Admin Dashboard — Review and approve tournament submissions</em>
</p>

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript, Vanilla CSS |
| **Backend** | NestJS 11, Prisma ORM, TypeScript |
| **Database** | PostgreSQL 16 |
| **Cache / Queue** | Redis 7, BullMQ |
| **Storage** | MinIO (S3-compatible) |
| **Auth** | JWT access tokens + httpOnly refresh cookies |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20+
- **Docker Desktop** (for Postgres, Redis, MinIO)
- **npm** 10+

### 1. Clone & Install

```bash
git clone https://github.com/ragavanRam98/kingsquare.git
cd kingsquare
npm install
```

### 2. Start Infrastructure

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts:
- PostgreSQL on port `5432` (user: `chess`, password: `chess_dev_password`)
- Redis on port `6379`
- MinIO on ports `9000` / `9001`

### 3. Configure Environment

Copy `.env.example` to `.env` (or verify `.env` exists):

```env
DATABASE_URL=postgresql://chess:chess_dev_password@localhost:5432/chess_tournament
DIRECT_URL=postgresql://chess:chess_dev_password@localhost:5432/chess_tournament
JWT_SECRET=change-me-in-production
REDIS_URL=redis://localhost:6379
ADMIN_EMAIL=admin@easychess.local
ADMIN_INITIAL_PASSWORD=ChangeMe123!
FRONTEND_URL=http://localhost:3000
PORT=3001
```

### 4. Push Schema & Seed Demo Data

```bash
npx prisma db push
npx prisma db seed
```

This creates:
- Super Admin account
- Test organizer with verified academy
- 3 professional chess tournaments with realistic categories and registrations

### 5. Start Development Servers

```bash
# Terminal 1 — API (port 3001)
cd apps/api && npm run dev

# Terminal 2 — Frontend (port 3000)
cd apps/web && npm run dev
```

Open **http://localhost:3000** to see the platform.

---

## 👥 How Each User Role Works

### 🏆 Participants (Public Users)

Participants don't need to create an account. They can:

1. **Browse tournaments** at [http://localhost:3000](http://localhost:3000)
   - View tournament cards with dates, venues, and categories
   - See real-time seat availability with progress bars

2. **View tournament details** by clicking any tournament card
   - See "About this tournament" description
   - View all categories with age ranges, entry fees, and seat counts

3. **Register for a tournament**
   - Click the "Register" button on any category
   - Fill in: Player Name, Date of Birth, Phone Number
   - The selected category is auto-filled
   - Submit to get a registration confirmation

---

### 🏢 Tournament Organizers

#### How to Register as a New Organizer

1. Go to [http://localhost:3000/auth/register](http://localhost:3000/auth/register)
2. Fill in:
   - **Academy Name** (e.g., "Brilliant Minds Chess Academy")
   - **Contact Person**, **Email**, **Phone**
   - **City**, **FIDE Arbiter License** (optional)
   - **Password**
3. Submit — your account will be in **PENDING** status
4. Wait for the Super Admin to verify your academy
5. Once verified, log in to manage tournaments

#### How to Log In

1. Go to [http://localhost:3000/organizer/login](http://localhost:3000/organizer/login)
2. Enter your email and password
3. You'll be redirected to the **Tournament Dashboard**

#### Demo Organizer Credentials

| Email | Password | Status |
|-------|----------|--------|
| `brilliantminds@easychess.in` | `Organizer@2026` | ✅ Verified |
| `gmden@easychess.in` | `Organizer@2026` | ⏳ Pending |

#### Organizer Dashboard Features

- **Stats Overview**: Total tournaments, active count, total registrations
- **Tournament List**: Each tournament shows status badge, city, dates, registration count
- **Actions**: "View Registrations" to see who signed up, "Preview" to see public page
- **Create Tournament**: Click "+ Create Tournament" to add a new event

#### Creating a Tournament

1. Go to [http://localhost:3000/organizer/tournaments/new](http://localhost:3000/organizer/tournaments/new)
2. Fill in tournament details:
   - Title, Description, City, Venue
   - Start Date, End Date, Registration Deadline
3. Add categories (each with Name, Age Range, Entry Fee, Max Seats)
4. Click "Create Tournament"
5. Your tournament goes to **PENDING_APPROVAL** until the admin approves it

---

### 🛡️ Super Admin

#### How to Log In

1. Go to [http://localhost:3000/admin](http://localhost:3000/admin)
2. Enter admin credentials:

| Email | Password |
|-------|----------|
| `admin@easychess.local` | `ChangeMe123!` |

3. The admin dashboard loads showing pending tournament approvals

#### Admin Dashboard Features

- **Pending Approvals**: List of tournaments awaiting review
- Each card shows: tournament title, organizer name, city, venue, date, categories
- **Approve**: Click "✓ Approve" to make the tournament live (status → ACTIVE)
- **Reject**: Click "✕ Reject" and provide a reason

---

## 📁 Project Structure

```
kingsquare/
├── apps/
│   ├── api/              # NestJS REST API (port 3001)
│   │   ├── src/
│   │   │   ├── auth/     # JWT auth, login, refresh, guards
│   │   │   ├── admin/    # Admin panel endpoints
│   │   │   ├── tournaments/  # Tournament CRUD
│   │   │   ├── registrations/ # Registration + rate limiting
│   │   │   ├── payments/  # Payment integration
│   │   │   └── prisma/   # Database service
│   │   └── test/
│   ├── web/              # Next.js 16 frontend (port 3000)
│   │   ├── app/
│   │   │   ├── tournaments/  # Public tournament pages
│   │   │   ├── organizer/    # Organizer portal
│   │   │   ├── admin/        # Admin dashboard
│   │   │   └── auth/         # Registration page
│   │   └── lib/
│   │       └── api.ts    # API client with auth helpers
│   └── worker/           # BullMQ background job processors
├── prisma/
│   ├── schema.prisma     # Database schema
│   └── seed.ts           # Demo data seeder
├── docker-compose.dev.yml  # Local infrastructure
└── .env                  # Environment variables
```

---

## 🔑 API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/auth/login` | Login (returns access_token) |
| `POST` | `/api/v1/auth/refresh` | Refresh access token |
| `POST` | `/api/v1/auth/logout` | Logout (revoke session) |

### Tournaments (Public)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tournaments` | List active tournaments |
| `GET` | `/api/v1/tournaments/:id` | Get tournament detail |

### Registrations (Public)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/tournaments/:id/registrations` | Register for a tournament |

### Organizer (Authenticated)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/organizer/tournaments` | List organizer's tournaments |
| `POST` | `/api/v1/organizer/tournaments` | Create a new tournament |
| `GET` | `/api/v1/organizer/tournaments/:id/registrations` | View registrations |

### Admin (SUPER_ADMIN only)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/admin/tournaments` | List tournaments (filterable) |
| `PATCH` | `/api/v1/admin/tournaments/:id/status` | Approve/Reject tournament |
| `GET` | `/api/v1/admin/organizers` | List organizer applications |
| `PATCH` | `/api/v1/admin/organizers/:id/verify` | Verify an organizer |

---

## 🧪 Running Tests

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e
```

---

## 📄 License

MIT © Easy Chess Academy — KingSquare is a product of Easy Chess Academy
