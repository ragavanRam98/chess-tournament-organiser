/**
 * Seed data — extracted from prisma/seed.ts
 * Real credentials and test constants for the E2E QA suite.
 */

export const USERS = {
  admin: {
    email: 'admin@easychess.local',
    password: 'ChangeMe123!',
  },
  organizer: {
    email: 'brilliantminds@easychess.in',
    password: 'Organizer@2026',
    academyName: 'Brilliant Minds Chess Academy',
    city: 'Chennai',
  },
  pendingOrganizer: {
    email: 'gmden@easychess.in',
    password: 'Organizer@2026',
    academyName: "Grandmaster's Den Chess Club",
    city: 'Bangalore',
  },
};

export const URLS = {
  home: '/',
  organizerLogin: '/organizer/login',
  organizerRegister: '/organizer/register',
  organizerDashboard: '/organizer/dashboard',
  organizerNewTournament: '/organizer/tournaments/new',
  adminDashboard: '/admin',
  adminAuditLogs: '/admin/audit-logs',
};

export const API_BASE = 'http://localhost:3001/api/v1';

export const SEED_TOURNAMENTS = {
  chennaiRapid: {
    title: 'Chennai Rapid Rating Chess Tournament 2026',
    city: 'Chennai',
    venue: 'Jawaharlal Nehru Indoor Stadium, Periyamet',
    status: 'ACTIVE',
  },
  tnJunior: {
    title: 'Tamil Nadu State Junior Chess Championship 2026',
    city: 'Chennai',
    status: 'ACTIVE',
  },
  coimbatoreOpen: {
    title: 'Coimbatore Open Classical Rating Tournament 2026',
    city: 'Coimbatore',
    status: 'PENDING_APPROVAL',
  },
};

export const FIDE = {
  validId: '25059530',
  validName: 'Erigaisi Arjun',
  invalidId: '99999999',
};

export const TEST_TOURNAMENT = {
  title: 'KS QA Test Tournament',
  description: 'Automated QA test tournament',
  city: 'Chennai',
  venue: 'Chennai Chess Club',
  categoryName: 'Open',
  entryFeePaise: '50000',
  maxSeats: '10',
};

export const TEST_PLAYER = {
  name: 'QA TestPlayer',
  dob: '2010-05-15',
  phone: '9876543299',
  phoneE164: '+919876543299',
  email: 'qaplayer@test.com',
  city: 'Chennai',
};
