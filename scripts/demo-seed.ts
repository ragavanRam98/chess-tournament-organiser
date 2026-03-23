/**
 * KingSquare Demo Seeder
 *
 * Creates realistic demo data by calling REAL API endpoints.
 * Every piece of data goes through the proper state machine flow.
 *
 * Usage:   npx tsx scripts/demo-seed.ts
 * Cleanup: npx tsx scripts/demo-cleanup.ts
 *
 * Prerequisites:
 *   - API server running at localhost:3001
 *   - Database seeded with users (npx prisma db seed)
 *   - For registrations: set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in .env
 *   - For payment confirmation: set RAZORPAY_WEBHOOK_SECRET in .env
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
    apiUrl: 'http://localhost:3001/api/v1',
    adminEmail: 'admin@easychess.local',
    adminPassword: 'ChangeMe123!',
    organizerEmail: 'brilliantminds@easychess.in',
    organizerPassword: 'Organizer@2026',
    webhookSecret: '',       // loaded from .env; empty string is valid (matches server)
    webhookSecretFound: false, // true if RAZORPAY_WEBHOOK_SECRET line exists in .env
};

// ── Load .env values ────────────────────────────────────────────────────────

function loadEnv(): void {
    try {
        const envPath = path.resolve(__dirname, '..', '.env');
        const content = fs.readFileSync(envPath, 'utf-8');
        const lines = content.split('\n');
        const env: Record<string, string> = {};
        for (const line of lines) {
            const match = line.match(/^([A-Z_]+)=(.*)$/);
            if (match) env[match[1]] = match[2].trim();
        }
        if (env['ADMIN_EMAIL']) CONFIG.adminEmail = env['ADMIN_EMAIL'];
        if (env['ADMIN_INITIAL_PASSWORD']) CONFIG.adminPassword = env['ADMIN_INITIAL_PASSWORD'];
        if ('RAZORPAY_WEBHOOK_SECRET' in env) {
            CONFIG.webhookSecret = env['RAZORPAY_WEBHOOK_SECRET'];
            CONFIG.webhookSecretFound = true;
        }
    } catch {
        /* .env not found — use defaults */
    }
}

// ── Logging ─────────────────────────────────────────────────────────────────

function log(emoji: string, message: string): void {
    console.log(`${emoji}  ${message}`);
}
function success(msg: string): void { log('\x1b[32m✓\x1b[0m', msg); }
function info(msg: string): void { log('\x1b[36m→\x1b[0m', msg); }
function warn(msg: string): void { log('\x1b[33m⚠\x1b[0m', msg); }
function fail(msg: string): void { log('\x1b[31m✗\x1b[0m', msg); }
function section(msg: string): void {
    const pad = Math.max(0, 60 - msg.length);
    console.log(`\n\x1b[1m── ${msg} ${'─'.repeat(pad)}\x1b[0m`);
}

// ── API Client ──────────────────────────────────────────────────────────────

class ApiClient {
    private token = '';
    private role = '';
    constructor(private baseUrl: string) {}

    async login(email: string, password: string): Promise<void> {
        const res = await this.post('/auth/login', { email, password });
        this.token = res.data.access_token;
        this.role = email.includes('admin') ? 'admin' : 'organizer';
    }

    async get<T = any>(apiPath: string): Promise<T> {
        const res = await fetch(`${this.baseUrl}${apiPath}`, {
            headers: this.headers(),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`GET ${apiPath} → ${res.status}: ${body}`);
        }
        return res.json();
    }

    async post<T = any>(apiPath: string, body?: object): Promise<T> {
        const res = await fetch(`${this.baseUrl}${apiPath}`, {
            method: 'POST',
            headers: this.headers(),
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`POST ${apiPath} → ${res.status}: ${text}`);
        }
        return res.json();
    }

    async patch<T = any>(apiPath: string, body: object): Promise<T> {
        const res = await fetch(`${this.baseUrl}${apiPath}`, {
            method: 'PATCH',
            headers: this.headers(),
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`PATCH ${apiPath} → ${res.status}: ${text}`);
        }
        return res.json();
    }

    /** Send raw body for webhook — returns response directly */
    async postRaw(apiPath: string, rawBody: string, extraHeaders: Record<string, string>): Promise<Response> {
        return fetch(`${this.baseUrl}${apiPath}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...extraHeaders },
            body: rawBody,
        });
    }

    private headers(): Record<string, string> {
        const h: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.token) h['Authorization'] = `Bearer ${this.token}`;
        return h;
    }
}

// ── Date helpers ────────────────────────────────────────────────────────────

function futureDate(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function dobForAge(ageAtTournament: number, tournamentStartDays: number): string {
    const tournamentStart = new Date();
    tournamentStart.setDate(tournamentStart.getDate() + tournamentStartDays);
    const dob = new Date(tournamentStart);
    dob.setFullYear(dob.getFullYear() - ageAtTournament);
    dob.setMonth(dob.getMonth() - 2); // 2 months buffer to ensure age is correct
    return dob.toISOString().split('T')[0];
}

// ── Demo data ───────────────────────────────────────────────────────────────

const DEMO_TAG = '[DEMO]';

interface PlayerDef {
    name: string;
    phone: string;
    city: string;
    email: string;
    fideId?: string;
    age: number;          // target age at tournament start
    categoryIndex: number; // which category to register in (0-based)
}

const PLAYERS: PlayerDef[] = [
    // ── Open (Above 18) — 5 players ──
    { name: 'Arjun Krishnan', phone: '+919841234567', city: 'Chennai', email: 'arjun.k@gmail.com', fideId: '25059530', age: 28, categoryIndex: 0 },
    { name: 'Priya Venkatesh', phone: '+919842345678', city: 'Coimbatore', email: 'priya.v@gmail.com', age: 30, categoryIndex: 0 },
    { name: 'Karthik Rajan', phone: '+919843456789', city: 'Madurai', email: 'karthik.r@gmail.com', age: 25, categoryIndex: 0 },
    { name: 'Divya Suresh', phone: '+919844567890', city: 'Salem', email: 'divya.s@gmail.com', age: 33, categoryIndex: 0 },
    { name: 'Rahul Nair', phone: '+919845678901', city: 'Chennai', email: 'rahul.n@gmail.com', age: 23, categoryIndex: 0 },
    // ── Under-18 — 4 players ──
    { name: 'Sneha Balachandran', phone: '+919846789012', city: 'Trichy', email: 'sneha.b@gmail.com', age: 16, categoryIndex: 1 },
    { name: 'Vikram Anand', phone: '+919847890123', city: 'Chennai', email: 'vikram.a@gmail.com', age: 14, categoryIndex: 1 },
    { name: 'Meena Iyer', phone: '+919848901234', city: 'Vellore', email: 'meena.i@gmail.com', age: 14, categoryIndex: 1 },
    { name: 'Suresh Kumar', phone: '+919849012345', city: 'Erode', email: 'suresh.k@gmail.com', age: 16, categoryIndex: 1 },
    // ── Under-13 — 3 players ──
    { name: 'Anjali Mohan', phone: '+919840123456', city: 'Chennai', email: 'anjali.m@gmail.com', age: 11, categoryIndex: 2 },
    { name: 'Ravi Shankar', phone: '+919841111111', city: 'Thanjavur', email: 'ravi.s@gmail.com', age: 11, categoryIndex: 2 },
    { name: 'Lakshmi Priya', phone: '+919842222222', city: 'Tirunelveli', email: 'lakshmi.p@gmail.com', age: 9, categoryIndex: 2 },
];

interface TournamentDef {
    title: string;
    description: string;
    city: string;
    venue: string;
    startDays: number;
    endDays: number;
    deadlineDays: number;
    categories: { name: string; minAge: number; maxAge: number; entryFeePaise: number; maxSeats: number }[];
    targetStatus: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE';
    registerPlayers: boolean;
}

const TOURNAMENTS: TournamentDef[] = [
    {
        title: 'Tamil Nadu State Open 2026',
        description: `${DEMO_TAG} Annual state-level open chess tournament open to all rated and unrated players. Organized by Brilliant Minds Chess Academy in association with Tamil Nadu State Chess Association.`,
        city: 'Chennai',
        venue: 'Jawaharlal Nehru Indoor Stadium, Chennai',
        startDays: 45,
        endDays: 46,
        deadlineDays: 35,
        categories: [
            { name: 'Open (Above 18)', minAge: 18, maxAge: 99, entryFeePaise: 80000, maxSeats: 50 },
            { name: 'Under-18', minAge: 5, maxAge: 17, entryFeePaise: 50000, maxSeats: 30 },
            { name: 'Under-13', minAge: 5, maxAge: 12, entryFeePaise: 40000, maxSeats: 20 },
        ],
        targetStatus: 'ACTIVE',
        registerPlayers: true,
    },
    {
        title: 'Chennai District Rapid 2026',
        description: `${DEMO_TAG} Rapid format chess tournament for Chennai district players. 15+10 time control, Swiss system, 7 rounds.`,
        city: 'Chennai',
        venue: 'Corporation Community Hall, T Nagar, Chennai',
        startDays: 60,
        endDays: 60,
        deadlineDays: 50,
        categories: [
            { name: 'Open', minAge: 5, maxAge: 99, entryFeePaise: 60000, maxSeats: 40 },
            { name: 'Under-15', minAge: 5, maxAge: 14, entryFeePaise: 35000, maxSeats: 30 },
        ],
        targetStatus: 'APPROVED',
        registerPlayers: false,
    },
    {
        title: 'Coimbatore Under-13 Championship 2026',
        description: `${DEMO_TAG} FIDE rated tournament for Under-13 players from Coimbatore and surrounding districts. A gateway to national-level selection.`,
        city: 'Coimbatore',
        venue: 'Coimbatore Chess Academy, RS Puram',
        startDays: 75,
        endDays: 76,
        deadlineDays: 65,
        categories: [
            { name: 'Under-13', minAge: 5, maxAge: 12, entryFeePaise: 30000, maxSeats: 50 },
            { name: 'Under-9', minAge: 5, maxAge: 8, entryFeePaise: 25000, maxSeats: 30 },
        ],
        targetStatus: 'PENDING_APPROVAL',
        registerPlayers: false,
    },
    {
        title: 'Madurai Blitz Open 2026',
        description: `${DEMO_TAG} Fast-paced blitz chess for all levels. 3+2 time control, double round-robin format.`,
        city: 'Madurai',
        venue: 'Madurai Chess Academy',
        startDays: 90,
        endDays: 90,
        deadlineDays: 80,
        categories: [
            { name: 'Open', minAge: 5, maxAge: 99, entryFeePaise: 40000, maxSeats: 60 },
        ],
        targetStatus: 'DRAFT',
        registerPlayers: false,
    },
];

// ── Tournament creation flow ────────────────────────────────────────────────

async function createTournament(
    organizer: ApiClient,
    admin: ApiClient,
    def: TournamentDef,
): Promise<{ id: string; categoryIds: string[] }> {
    // Step 1: Create (DRAFT)
    info(`Creating tournament: ${def.title}`);
    const createRes = await organizer.post('/organizer/tournaments', {
        title: def.title,
        description: def.description,
        city: def.city,
        venue: def.venue,
        startDate: futureDate(def.startDays),
        endDate: futureDate(def.endDays),
        registrationDeadline: futureDate(def.deadlineDays),
        categories: def.categories,
    });
    const tournament = createRes.data;
    const tournamentId = tournament.id;
    const categoryIds = tournament.categories.map((c: any) => c.id);
    success(`Created (DRAFT): ${tournamentId}`);

    if (def.targetStatus === 'DRAFT') {
        return { id: tournamentId, categoryIds };
    }

    // Step 2: Submit for approval (DRAFT → PENDING_APPROVAL)
    info('Submitting for approval...');
    await organizer.post(`/organizer/tournaments/${tournamentId}/submit`);
    success('Status: PENDING_APPROVAL');

    if (def.targetStatus === 'PENDING_APPROVAL') {
        return { id: tournamentId, categoryIds };
    }

    // Step 3: Admin approves (PENDING_APPROVAL → APPROVED)
    info('Admin approving...');
    await admin.patch(`/admin/tournaments/${tournamentId}/status`, { status: 'APPROVED' });
    success('Status: APPROVED');

    if (def.targetStatus === 'APPROVED') {
        return { id: tournamentId, categoryIds };
    }

    // Step 4: Admin activates (APPROVED → ACTIVE)
    info('Admin activating...');
    await admin.patch(`/admin/tournaments/${tournamentId}/status`, { status: 'ACTIVE' });
    success('Status: ACTIVE');

    return { id: tournamentId, categoryIds };
}

// ── Registration flow ───────────────────────────────────────────────────────

interface RegistrationResult {
    registrationId: string;
    entryNumber: string;
    razorpayOrderId: string;
    playerName: string;
    amountPaise: number;
}

async function registerPlayer(
    client: ApiClient,
    tournamentId: string,
    categoryId: string,
    player: PlayerDef,
    tournamentStartDays: number,
    entryFeePaise: number,
): Promise<RegistrationResult | null> {
    try {
        const res = await client.post(
            `/tournaments/${tournamentId}/categories/${categoryId}/register`,
            {
                playerName: player.name,
                playerDob: dobForAge(player.age, tournamentStartDays),
                phone: player.phone,
                email: player.email,
                city: player.city,
                fideId: player.fideId,
            },
        );
        const data = res.data;
        success(`Registered: ${player.name} → ${data.entry_number}`);
        return {
            registrationId: data.registration_id,
            entryNumber: data.entry_number,
            razorpayOrderId: data.payment?.razorpay_order_id ?? '',
            playerName: player.name,
            amountPaise: entryFeePaise,
        };
    } catch (err: any) {
        fail(`Registration failed for ${player.name}: ${err.message}`);
        return null;
    }
}

// ── Payment simulation ──────────────────────────────────────────────────────

async function simulatePayment(
    client: ApiClient,
    reg: RegistrationResult,
    webhookSecret: string,
): Promise<boolean> {
    if (!reg.razorpayOrderId) {
        warn(`No order ID for ${reg.playerName} — skipping payment`);
        return false;
    }

    const payload = {
        event: 'payment.captured',
        payload: {
            payment: {
                entity: {
                    id: `pay_demo_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    order_id: reg.razorpayOrderId,
                    amount: reg.amountPaise,
                    currency: 'INR',
                    status: 'captured',
                    method: 'upi',
                },
            },
        },
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

    try {
        const res = await client.postRaw('/payments/webhook', rawBody, {
            'x-razorpay-signature': signature,
        });
        if (res.ok) {
            success(`Payment confirmed: ${reg.playerName} (${reg.entryNumber})`);
            return true;
        }
        const text = await res.text().catch(() => '');
        warn(`Webhook returned ${res.status} for ${reg.playerName}: ${text}`);
        return false;
    } catch (err: any) {
        warn(`Payment simulation failed for ${reg.playerName}: ${err.message}`);
        return false;
    }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    loadEnv();

    section('KingSquare Demo Seeder');
    info('All data goes through real API endpoints');
    info(`API: ${CONFIG.apiUrl}`);
    info(`Webhook secret: ${CONFIG.webhookSecretFound ? 'found in .env' : 'NOT found in .env'}`);

    // ── 1. Authentication ────────────────────────────────────────────────

    section('Authentication');

    const organizer = new ApiClient(CONFIG.apiUrl);
    await organizer.login(CONFIG.organizerEmail, CONFIG.organizerPassword);
    success(`Logged in as organizer: ${CONFIG.organizerEmail}`);

    const admin = new ApiClient(CONFIG.apiUrl);
    await admin.login(CONFIG.adminEmail, CONFIG.adminPassword);
    success(`Logged in as admin: ${CONFIG.adminEmail}`);

    // Unauthenticated client for registrations + webhooks
    const publicClient = new ApiClient(CONFIG.apiUrl);

    // ── 2. Create tournaments ────────────────────────────────────────────

    const createdTournaments: { id: string; categoryIds: string[]; def: TournamentDef }[] = [];

    for (let i = 0; i < TOURNAMENTS.length; i++) {
        const def = TOURNAMENTS[i];
        section(`Tournament ${i + 1} — ${def.title}`);

        try {
            const result = await createTournament(organizer, admin, def);
            createdTournaments.push({ ...result, def });
        } catch (err: any) {
            fail(`Failed to create "${def.title}": ${err.message}`);
        }
    }

    // ── 3. Register players for Tournament 1 ─────────────────────────────

    const t1 = createdTournaments.find(t => t.def.targetStatus === 'ACTIVE');

    if (t1) {
        section('Registrations — Tamil Nadu State Open 2026');

        const registrations: RegistrationResult[] = [];

        for (const player of PLAYERS) {
            const categoryId = t1.categoryIds[player.categoryIndex];
            const feePaise = t1.def.categories[player.categoryIndex].entryFeePaise;

            if (!categoryId) {
                warn(`No category at index ${player.categoryIndex} for ${player.name}`);
                continue;
            }

            const reg = await registerPlayer(
                publicClient, t1.id, categoryId, player, t1.def.startDays, feePaise,
            );
            if (reg) registrations.push(reg);
        }

        // ── 4. Simulate payments (confirm 10, leave 2 pending) ──────────

        if (registrations.length > 0 && CONFIG.webhookSecretFound) {
            section('Payment Confirmation');
            info(`Confirming ${Math.min(10, registrations.length)} of ${registrations.length} registrations...`);

            const toConfirm = registrations.slice(0, 10);
            const toPendingNames = registrations.slice(10).map(r => r.playerName);

            let confirmed = 0;
            for (const reg of toConfirm) {
                const ok = await simulatePayment(publicClient, reg, CONFIG.webhookSecret);
                if (ok) confirmed++;
            }

            success(`${confirmed} payments confirmed`);
            if (toPendingNames.length > 0) {
                info(`Left as PENDING_PAYMENT: ${toPendingNames.join(', ')}`);
            }
        } else if (registrations.length > 0 && !CONFIG.webhookSecretFound) {
            section('Payment Confirmation — Skipped');
            warn('RAZORPAY_WEBHOOK_SECRET not found in .env');
            warn(`${registrations.length} registrations left as PENDING_PAYMENT`);
        }
    }

    // ── 5. Summary ───────────────────────────────────────────────────────

    section('Summary');
    console.log('');
    console.log('  Tournaments created:');
    for (const t of createdTournaments) {
        console.log(`    ${t.def.title} → ${t.def.targetStatus}`);
    }
    console.log('');
    console.log('  Login credentials:');
    console.log(`    Admin:     ${CONFIG.adminEmail} / ${CONFIG.adminPassword}`);
    console.log(`    Organizer: ${CONFIG.organizerEmail} / ${CONFIG.organizerPassword}`);
    console.log('');
    console.log('  To clean up:  npx tsx scripts/demo-cleanup.ts');
    console.log('  Or:           npm run demo:clean');
    console.log('');
}

main().catch((err) => {
    console.error('');
    fail(`Demo seeder failed: ${err.message}`);
    console.error(err);
    process.exit(1);
});
