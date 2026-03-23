// apps/api/src/queue/queue.constants.ts

export const QUEUE_NAMES = {
    PAYMENTS: 'payments',
    NOTIFICATIONS: 'notifications',
    EXPORTS: 'exports',
    CLEANUP: 'cleanup',
    CHESS_RESULTS: 'chess-results',
} as const;

export const JOB_NAMES = {
    PAYMENT_RECONCILE: 'PAYMENT_RECONCILE',
    SEND_EMAIL: 'SEND_EMAIL',
    SEND_SMS: 'SEND_SMS',
    GENERATE_EXPORT: 'GENERATE_EXPORT',
    CLEANUP_EXPORT_FILES: 'CLEANUP_EXPORT_FILES',
    PURGE_EXPIRED_REGISTRATIONS: 'PURGE_EXPIRED_REGISTRATIONS',
    // GAP 4: Monthly FIDE rating list sync — runs on the CLEANUP queue (low priority)
    SYNC_FIDE_RATINGS: 'SYNC_FIDE_RATINGS',
    PROCESS_REFUND: 'PROCESS_REFUND',
    SYNC_CHESS_RESULTS: 'SYNC_CHESS_RESULTS',
} as const;
