/**
 * KingSquare Demo Cleanup
 *
 * Removes all demo data created by demo-seed.ts.
 * Identifies demo tournaments by the [DEMO] tag in their description.
 *
 * Usage: npx tsx scripts/demo-cleanup.ts
 *
 * This script uses Prisma directly because the API has no delete endpoints.
 * It only removes data tagged as demo — real user data is never touched.
 */

import { PrismaClient } from '@prisma/client';

const DEMO_TAG = '[DEMO]';

const prisma = new PrismaClient();

// ── Logging ─────────────────────────────────────────────────────────────────

function success(msg: string): void { console.log(`\x1b[32m✓\x1b[0m  ${msg}`); }
function info(msg: string): void { console.log(`\x1b[36m→\x1b[0m  ${msg}`); }
function warn(msg: string): void { console.log(`\x1b[33m⚠\x1b[0m  ${msg}`); }
function section(msg: string): void {
    const pad = Math.max(0, 60 - msg.length);
    console.log(`\n\x1b[1m── ${msg} ${'─'.repeat(pad)}\x1b[0m`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function cleanup(): Promise<void> {
    section('KingSquare Demo Cleanup');

    // 1. Find all demo tournaments
    info('Finding demo tournaments...');
    const demoTournaments = await prisma.tournament.findMany({
        where: { description: { contains: DEMO_TAG } },
        select: { id: true, title: true, status: true },
    });

    if (demoTournaments.length === 0) {
        info('No demo tournaments found. Nothing to clean up.');
        return;
    }

    console.log(`  Found ${demoTournaments.length} demo tournament(s):`);
    for (const t of demoTournaments) {
        console.log(`    - ${t.title} (${t.status})`);
    }

    const tournamentIds = demoTournaments.map(t => t.id);

    // 2. Delete in dependency order (child → parent)
    // Each step logs what was deleted

    // 2a. Payments (linked via registrations)
    info('Deleting payments...');
    const paymentResult = await prisma.payment.deleteMany({
        where: { registration: { tournamentId: { in: tournamentIds } } },
    });
    success(`Deleted ${paymentResult.count} payment(s)`);

    // 2b. Registrations
    info('Deleting registrations...');
    const regResult = await prisma.registration.deleteMany({
        where: { tournamentId: { in: tournamentIds } },
    });
    success(`Deleted ${regResult.count} registration(s)`);

    // 2c. Export jobs
    info('Deleting export jobs...');
    const exportResult = await prisma.exportJob.deleteMany({
        where: { tournamentId: { in: tournamentIds } },
    });
    success(`Deleted ${exportResult.count} export job(s)`);

    // 2d. Categories
    info('Deleting categories...');
    const catResult = await prisma.category.deleteMany({
        where: { tournamentId: { in: tournamentIds } },
    });
    success(`Deleted ${catResult.count} category/ies`);

    // 2e. Audit logs for these tournaments
    info('Deleting audit log entries...');
    const auditResult = await prisma.auditLog.deleteMany({
        where: { entityId: { in: tournamentIds }, entityType: 'tournament' },
    });
    success(`Deleted ${auditResult.count} audit log(s)`);

    // 2f. Tournaments
    info('Deleting tournaments...');
    const tournamentResult = await prisma.tournament.deleteMany({
        where: { id: { in: tournamentIds } },
    });
    success(`Deleted ${tournamentResult.count} tournament(s)`);

    // 3. Reset entry number sequence
    info('Resetting entry number sequence...');
    try {
        const maxEntry = await prisma.registration.aggregate({ _max: { entryNumber: true } });
        if (!maxEntry._max.entryNumber) {
            // No registrations left — reset to 1
            await prisma.$executeRaw`ALTER SEQUENCE entry_number_seq RESTART WITH 1`;
            success('Entry number sequence reset to 1');
        } else {
            info('Other registrations exist — sequence left as-is');
        }
    } catch {
        warn('Could not reset entry_number_seq (sequence may not exist)');
    }

    // 4. Summary
    section('Cleanup Complete');
    console.log('');
    console.log('  Removed:');
    console.log(`    ${tournamentResult.count} tournament(s)`);
    console.log(`    ${catResult.count} category/ies`);
    console.log(`    ${regResult.count} registration(s)`);
    console.log(`    ${paymentResult.count} payment(s)`);
    console.log(`    ${auditResult.count} audit log(s)`);
    console.log('');
    console.log('  Users are untouched.');
    console.log('  To re-seed demo data: npx tsx scripts/demo-seed.ts');
    console.log('');
}

cleanup()
    .catch((err) => {
        console.error(`\x1b[31m✗\x1b[0m  Cleanup failed: ${err.message}`);
        console.error(err);
        process.exit(1);
    })
    .finally(() => {
        void prisma.$disconnect();
    });
