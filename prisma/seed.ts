/**
 * Prisma seed script — Professional demo data
 *
 * Creates:
 *  1. Super Admin account (from env vars)
 *  2. Verified organizer: "Brilliant Minds Chess Academy" (Chennai)
 *  3. Two active tournaments with realistic categories
 *  4. Sample confirmed registrations with real Indian names
 *  5. One pending-approval tournament (for admin demo)
 *
 * Run: npx prisma db seed
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@easychess.local';
    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!';
    const organizerPassword = 'Organizer@2026';

    console.log('[seed] Creating professional demo data...\n');

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
    console.log(`✅ Super Admin: ${admin.email} (password: ${adminPassword})`);

    // ═══════════════════════════════════════════════════════════════════════
    // 2. ORGANIZER 1 — Verified, Active
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

    const org1 = await prisma.organizer.upsert({
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
                'we have produced 12 national-level champions. Our state-of-the-art facility in T. Nagar ' +
                'features 40 tournament-grade boards and digital clocks.',
            verifiedAt: new Date(),
            verifiedById: admin.id,
        },
    });
    console.log(`✅ Organizer 1: ${org1User.email} — "Brilliant Minds Chess Academy" (Verified)`);
    console.log(`   Password: ${organizerPassword}`);

    // ═══════════════════════════════════════════════════════════════════════
    // 3. ORGANIZER 2 — Pending Verification (for admin demo)
    //    "Grandmaster's Den Chess Club" — a newer club seeking verification
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
                'and intermediate players aged 6–18. Founded by FM Rajesh Kumar, we offer personalized ' +
                'training and weekly rapid tournaments.',
        },
    });
    console.log(`✅ Organizer 2: ${org2User.email} — "Grandmaster's Den Chess Club" (Pending Verification)`);

    // ═══════════════════════════════════════════════════════════════════════
    // 4. TOURNAMENT 1 — Active, Open for Registration
    //    "Chennai Rapid Rating Chess Tournament 2026"
    // ═══════════════════════════════════════════════════════════════════════
    const existingT1 = await prisma.tournament.findFirst({ where: { title: 'Chennai Rapid Rating Chess Tournament 2026' } });
    let t1Id: string;

    if (existingT1) {
        t1Id = existingT1.id;
    } else {
        const t1 = await prisma.tournament.create({
            data: {
                organizerId: org1.id,
                title: 'Chennai Rapid Rating Chess Tournament 2026',
                description:
                    'Join us for the 8th edition of Chennai\'s premier FIDE-rated Rapid chess tournament! ' +
                    'This prestigious event features 7 Swiss-system rounds with a time control of 15+10. ' +
                    'Total prize fund of ₹3,00,000 with trophies for all category winners.\n\n' +
                    '• FIDE Rated (Rapid)\n' +
                    '• Swiss System — 7 Rounds\n' +
                    '• Time Control: 15 min + 10 sec increment\n' +
                    '• Digital clocks provided\n' +
                    '• Refreshments included for all participants\n' +
                    '• Free parking available',
                city: 'Chennai',
                venue: 'Jawaharlal Nehru Indoor Stadium, Periyamet',
                startDate: new Date('2026-05-17'),
                endDate: new Date('2026-05-18'),
                registrationDeadline: new Date('2026-05-10'),
                status: 'ACTIVE',
                approvedAt: new Date(),
                approvedById: admin.id,
            },
        });
        t1Id = t1.id;

        // Categories for Tournament 1
        const t1Categories = await Promise.all([
            prisma.category.create({
                data: {
                    tournamentId: t1Id,
                    name: 'Under 8 (U-8)',
                    minAge: 0, maxAge: 8,
                    entryFeePaise: 30000, // ₹300
                    maxSeats: 60,
                    registeredCount: 12,
                },
            }),
            prisma.category.create({
                data: {
                    tournamentId: t1Id,
                    name: 'Under 12 (U-12)',
                    minAge: 0, maxAge: 12,
                    entryFeePaise: 40000, // ₹400
                    maxSeats: 80,
                    registeredCount: 28,
                },
            }),
            prisma.category.create({
                data: {
                    tournamentId: t1Id,
                    name: 'Under 16 (U-16)',
                    minAge: 0, maxAge: 16,
                    entryFeePaise: 50000, // ₹500
                    maxSeats: 60,
                    registeredCount: 18,
                },
            }),
            prisma.category.create({
                data: {
                    tournamentId: t1Id,
                    name: 'Open (All Ages)',
                    minAge: 0, maxAge: 999,
                    entryFeePaise: 75000, // ₹750
                    maxSeats: 100,
                    registeredCount: 42,
                },
            }),
        ]);

        // Sample registrations for Tournament 1
        const samplePlayers = [
            { name: 'Arjun Venkatesh', dob: '2019-03-15', phone: '+919876543201', email: 'arjun.v@gmail.com', city: 'Chennai', catIdx: 0, fideId: null, fideRating: null },
            { name: 'Priya Ramachandran', dob: '2018-07-22', phone: '+919876543202', email: 'priya.r@gmail.com', city: 'Chennai', catIdx: 0, fideId: null, fideRating: null },
            { name: 'Karthik Subramanian', dob: '2015-11-08', phone: '+919876543203', email: 'karthik.s@gmail.com', city: 'Coimbatore', catIdx: 1, fideId: '25012345', fideRating: 1250 },
            { name: 'Ananya Krishnan', dob: '2016-02-14', phone: '+919876543204', email: 'ananya.k@gmail.com', city: 'Madurai', catIdx: 1, fideId: null, fideRating: null },
            { name: 'Rohan Iyer', dob: '2014-06-30', phone: '+919876543205', email: 'rohan.i@outlook.com', city: 'Chennai', catIdx: 1, fideId: '25056789', fideRating: 1480 },
            { name: 'Divya Thiagarajan', dob: '2012-09-05', phone: '+919876543206', email: 'divya.t@gmail.com', city: 'Trichy', catIdx: 2, fideId: '25098765', fideRating: 1620 },
            { name: 'Vishwanathan Rajesh', dob: '1995-01-20', phone: '+919876543207', email: 'vishwa.r@gmail.com', city: 'Chennai', catIdx: 3, fideId: '25011111', fideRating: 2150 },
            { name: 'Srinivasan Murthy', dob: '1988-04-12', phone: '+919876543208', email: 'srini.m@gmail.com', city: 'Bangalore', catIdx: 3, fideId: '25022222', fideRating: 1890 },
            { name: 'Lakshmi Narayanan', dob: '2001-12-25', phone: '+919876543209', email: 'lakshmi.n@gmail.com', city: 'Pondicherry', catIdx: 3, fideId: null, fideRating: null },
            { name: 'Deepak Chandrasekhar', dob: '1992-08-18', phone: '+919876543210', email: 'deepak.c@gmail.com', city: 'Salem', catIdx: 3, fideId: '25033333', fideRating: 1750 },
        ];

        let entryCounter = 1;
        for (const player of samplePlayers) {
            const entryNumber = `ECA-2026-${String(entryCounter++).padStart(6, '0')}`;
            await prisma.registration.create({
                data: {
                    tournamentId: t1Id,
                    categoryId: t1Categories[player.catIdx].id,
                    playerName: player.name,
                    playerDob: new Date(player.dob),
                    phone: player.phone,
                    email: player.email,
                    city: player.city,
                    fideId: player.fideId,
                    fideRating: player.fideRating,
                    status: 'CONFIRMED',
                    entryNumber,
                    confirmedAt: new Date(),
                },
            });
        }
    }
    console.log(`✅ Tournament 1: "Chennai Rapid Rating Chess Tournament 2026" (ACTIVE, 10 registrations)`);

    // ═══════════════════════════════════════════════════════════════════════
    // 5. TOURNAMENT 2 — Active
    //    "Tamil Nadu State Junior Championship 2026"
    // ═══════════════════════════════════════════════════════════════════════
    const existingT2 = await prisma.tournament.findFirst({ where: { title: 'Tamil Nadu State Junior Chess Championship 2026' } });

    if (!existingT2) {
        const t2 = await prisma.tournament.create({
            data: {
                organizerId: org1.id,
                title: 'Tamil Nadu State Junior Chess Championship 2026',
                description:
                    'The official Tamil Nadu State Junior Chess Championship sanctioned by the Tamil Nadu State Chess Association (TNSCA). ' +
                    'Top 3 players from each category qualify for the National Junior Championship.\n\n' +
                    '• FIDE Rated (Classical)\n' +
                    '• Swiss System — 9 Rounds\n' +
                    '• Time Control: 90 min + 30 sec increment\n' +
                    '• Qualification to Nationals for top 3 finishers\n' +
                    '• Certificates for all participants\n' +
                    '• Lunch and snacks provided',
                city: 'Chennai',
                venue: 'SDAT Stadium, Egmore',
                startDate: new Date('2026-06-14'),
                endDate: new Date('2026-06-17'),
                registrationDeadline: new Date('2026-06-07'),
                status: 'ACTIVE',
                approvedAt: new Date(),
                approvedById: admin.id,
            },
        });

        await Promise.all([
            prisma.category.create({
                data: { tournamentId: t2.id, name: 'Under 9 Boys', minAge: 0, maxAge: 9, entryFeePaise: 50000, maxSeats: 80, registeredCount: 35 },
            }),
            prisma.category.create({
                data: { tournamentId: t2.id, name: 'Under 9 Girls', minAge: 0, maxAge: 9, entryFeePaise: 50000, maxSeats: 60, registeredCount: 22 },
            }),
            prisma.category.create({
                data: { tournamentId: t2.id, name: 'Under 13 Boys', minAge: 0, maxAge: 13, entryFeePaise: 60000, maxSeats: 100, registeredCount: 67 },
            }),
            prisma.category.create({
                data: { tournamentId: t2.id, name: 'Under 13 Girls', minAge: 0, maxAge: 13, entryFeePaise: 60000, maxSeats: 80, registeredCount: 41 },
            }),
            prisma.category.create({
                data: { tournamentId: t2.id, name: 'Under 17 Boys', minAge: 0, maxAge: 17, entryFeePaise: 70000, maxSeats: 80, registeredCount: 52 },
            }),
            prisma.category.create({
                data: { tournamentId: t2.id, name: 'Under 17 Girls', minAge: 0, maxAge: 17, entryFeePaise: 70000, maxSeats: 60, registeredCount: 28 },
            }),
        ]);
    }
    console.log(`✅ Tournament 2: "Tamil Nadu State Junior Chess Championship 2026" (ACTIVE)`);

    // ═══════════════════════════════════════════════════════════════════════
    // 6. TOURNAMENT 3 — Pending Approval (for admin demo)
    //    "Coimbatore Open Classical Rating Tournament 2026"
    // ═══════════════════════════════════════════════════════════════════════
    const existingT3 = await prisma.tournament.findFirst({ where: { title: 'Coimbatore Open Classical Rating Tournament 2026' } });

    if (!existingT3) {
        const t3 = await prisma.tournament.create({
            data: {
                organizerId: org1.id,
                title: 'Coimbatore Open Classical Rating Tournament 2026',
                description:
                    'A 5-day FIDE Rated Classical chess tournament in the heart of Coimbatore. Open to all players ' +
                    'above 1000 FIDE rating. Featuring a total prize fund of ₹5,00,000 with guaranteed prizes for ' +
                    'the top 20 finishers.\n\n' +
                    '• FIDE Rated (Classical)\n' +
                    '• Swiss System — 10 Rounds\n' +
                    '• Time Control: 90 min + 30 sec increment from move 1',
                city: 'Coimbatore',
                venue: 'Codissia Trade Fair Complex, Avanashi Road',
                startDate: new Date('2026-08-02'),
                endDate: new Date('2026-08-06'),
                registrationDeadline: new Date('2026-07-25'),
                status: 'PENDING_APPROVAL',
            },
        });

        await Promise.all([
            prisma.category.create({
                data: { tournamentId: t3.id, name: 'Open (Rating 1000+)', minAge: 0, maxAge: 999, entryFeePaise: 100000, maxSeats: 200 },
            }),
            prisma.category.create({
                data: { tournamentId: t3.id, name: 'Below 1600 Rating', minAge: 0, maxAge: 999, entryFeePaise: 80000, maxSeats: 150 },
            }),
            prisma.category.create({
                data: { tournamentId: t3.id, name: 'Below 1200 Rating', minAge: 0, maxAge: 999, entryFeePaise: 60000, maxSeats: 120 },
            }),
        ]);
    }
    console.log(`✅ Tournament 3: "Coimbatore Open Classical Rating Tournament 2026" (PENDING_APPROVAL)`);

    // ═══════════════════════════════════════════════════════════════════════
    // 7. AUDIT LOG — Sample entries for admin dashboard
    // ═══════════════════════════════════════════════════════════════════════
    const auditCount = await prisma.auditLog.count();
    if (auditCount === 0) {
        await prisma.auditLog.createMany({
            data: [
                {
                    entityType: 'Organizer',
                    entityId: org1.id,
                    action: 'VERIFIED',
                    newValue: { academyName: 'Brilliant Minds Chess Academy', city: 'Chennai' },
                    performedById: admin.id,
                },
                {
                    entityType: 'Tournament',
                    entityId: t1Id,
                    action: 'APPROVED',
                    newValue: { title: 'Chennai Rapid Rating Chess Tournament 2026' },
                    performedById: admin.id,
                },
            ],
        });
    }
    console.log(`✅ Audit log entries created`);

    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n══════════════════════════════════════════');
    console.log('  🎉 Demo data seeded successfully!');
    console.log('══════════════════════════════════════════');
    console.log('\n📋 Login Credentials:\n');
    console.log('  SUPER ADMIN');
    console.log(`    Email:    ${adminEmail}`);
    console.log(`    Password: ${adminPassword}\n`);
    console.log('  ORGANIZER (Brilliant Minds Chess Academy)');
    console.log('    Email:    brilliantminds@easychess.in');
    console.log(`    Password: ${organizerPassword}\n`);
    console.log('  ORGANIZER (Pending — Grandmaster\'s Den)');
    console.log('    Email:    gmden@easychess.in');
    console.log(`    Password: ${organizerPassword}\n`);
}

main()
    .catch((e) => {
        console.error('[seed] Failed:', e);
        process.exit(1);
    })
    .finally(() => {
        void prisma.$disconnect();
    });
