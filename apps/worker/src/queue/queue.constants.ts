// Queue + job name constants (mirrors apps/api/src/queue/queue.constants.ts)
// Kept in sync — single source of truth is the API; worker imports from here.

export const QUEUE_NAMES = {
  PAYMENTS: 'payments',
  NOTIFICATIONS: 'notifications',
  EXPORTS: 'exports',
  CLEANUP: 'cleanup',
} as const;

export const JOB_NAMES = {
  PAYMENT_RECONCILE: 'PAYMENT_RECONCILE',
  SEND_EMAIL: 'SEND_EMAIL',
  SEND_SMS: 'SEND_SMS',
  GENERATE_EXPORT: 'GENERATE_EXPORT',
  CLEANUP_EXPORT_FILES: 'CLEANUP_EXPORT_FILES',
  PURGE_EXPIRED_REGISTRATIONS: 'PURGE_EXPIRED_REGISTRATIONS',
  SYNC_FIDE_RATINGS: 'SYNC_FIDE_RATINGS',
  PROCESS_REFUND: 'PROCESS_REFUND',
} as const;
