/*
 * KingSquare Seed Data
 *
 * This seed creates ONLY user accounts.
 * NO tournament data is seeded.
 *
 * Reason: Tournaments must go through the proper flow:
 * Organizer creates → submits → Admin approves → Active
 * Seeding tournaments directly bypasses this flow and
 * creates data inconsistency across the application.
 *
 * To create demo data for testing:
 * Use the actual application UI or the API through
 * the proper state machine flow.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@kingsquare.in';
    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!';
    const organizerPassword = 'Organizer@2026';

    console.log('[seed] Creating user accounts...\n');

    // ═══════════════════════════════════════════════════════════════════════
    // 1. SUPER ADMIN
    // ═══════════════════════════════════════════════════════════════════════
    const admin = await prisma.user.upsert({
        where: { email: adminEmail },
        update: {},
        create: {
            email: adminEmail,
            passwordHash: await bcrypt.hash(adminPassword, 12),
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
        },
    });
    console.log(`  Super Admin: ${admin.email}`);

    // ═══════════════════════════════════════════════════════════════════════
    // 2. ORGANIZER — Verified, Active
    //    "Brilliant Minds Chess Academy" — a premier academy in Chennai
    // ═══════════════════════════════════════════════════════════════════════
    const org1User = await prisma.user.upsert({
        where: { email: 'brilliantminds@easychess.in' },
        update: {},
        create: {
            email: 'brilliantminds@easychess.in',
            passwordHash: await bcrypt.hash(organizerPassword, 12),
            role: 'ORGANIZER',
            status: 'ACTIVE',
        },
    });

    await prisma.organizer.upsert({
        where: { userId: org1User.id },
        update: {},
        create: {
            userId: org1User.id,
            academyName: 'Brilliant Minds Chess Academy',
            contactPhone: '+91 98765 43210',
            city: 'Chennai',
            state: 'Tamil Nadu',
            description:
                'Established in 2015, Brilliant Minds Chess Academy is one of South India\'s leading chess training centres. ' +
                'With 3 Grandmaster coaches, FIDE-accredited training programs, and over 500 active students, ' +
                'we have produced 12 national-level champions.',
            verifiedAt: new Date(),
            verifiedById: admin.id,
        },
    });
    console.log(`  Organizer:   ${org1User.email} — "Brilliant Minds Chess Academy" (Verified)`);

    // ═══════════════════════════════════════════════════════════════════════
    // 3. ORGANIZER — Pending Verification (for admin demo)
    //    "Grandmaster's Den Chess Club"
    // ═══════════════════════════════════════════════════════════════════════
    const org2User = await prisma.user.upsert({
        where: { email: 'gmden@easychess.in' },
        update: {},
        create: {
            email: 'gmden@easychess.in',
            passwordHash: await bcrypt.hash(organizerPassword, 12),
            role: 'ORGANIZER',
            status: 'PENDING_VERIFICATION',
        },
    });

    await prisma.organizer.upsert({
        where: { userId: org2User.id },
        update: {},
        create: {
            userId: org2User.id,
            academyName: "Grandmaster's Den Chess Club",
            contactPhone: '+91 87654 32109',
            city: 'Bangalore',
            state: 'Karnataka',
            description:
                'A vibrant chess community in Koramangala, Bangalore. We specialize in coaching beginners ' +
                'and intermediate players aged 6–18.',
        },
    });
    console.log(`  Organizer:   ${org2User.email} — "Grandmaster's Den Chess Club" (Pending)`);

    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n  Seed complete. No tournament data created.');
    console.log('  Use the application UI to create tournaments.\n');
    console.log('  Login Credentials:');
    console.log(`    Admin:     ${adminEmail} / ${adminPassword}`);
    console.log(`    Organizer: brilliantminds@easychess.in / ${organizerPassword}`);
    console.log(`    Organizer: gmden@easychess.in / ${organizerPassword}\n`);
}

main()
    .catch((e) => {
        console.error('[seed] Failed:', e);
        process.exit(1);
    })
    .finally(() => {
        void prisma.$disconnect();
    });
