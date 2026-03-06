/**
 * Prisma seed script — S0-4
 * Creates the Super Admin account from environment variables.
 * Run: npx prisma db seed
 *
 * Required env vars:
 *   ADMIN_EMAIL
 *   ADMIN_INITIAL_PASSWORD
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_INITIAL_PASSWORD;

    if (!email || !password) {
        throw new Error(
            'ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD must be set in .env before running seed.',
        );
    }

    // Upsert — safe to run multiple times
    const admin = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
            email,
            passwordHash: await bcrypt.hash(password, 12),
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
        },
    });

    console.warn(`[seed] Super admin ready: ${admin.email} (id: ${admin.id})`);
    console.warn('[seed] IMPORTANT: Change the admin password immediately after first login.');
}

main()
    .catch((e) => {
        console.error('[seed] Failed:', e);
        process.exit(1);
    })
    .finally(() => {
        void prisma.$disconnect();
    });
