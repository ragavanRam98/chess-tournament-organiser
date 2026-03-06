import { Injectable } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

@Injectable()
export class NotificationsService {
    constructor(private readonly queue: QueueService) { }

    async sendRegistrationConfirmed(registrationId: string) {
        return this.queue.add(QUEUE_NAMES.NOTIFICATIONS, JOB_NAMES.SEND_EMAIL, { registrationId, type: 'REGISTRATION_CONFIRMED' });
    }

    async sendTournamentApproved(organizerId: string, tournamentId: string) {
        return this.queue.add(QUEUE_NAMES.NOTIFICATIONS, JOB_NAMES.SEND_EMAIL, { organizerId, tournamentId, type: 'TOURNAMENT_APPROVED' });
    }

    async sendTournamentCancelled(registrationIds: string[]) {
        return Promise.all(registrationIds.map(id =>
            this.queue.add(QUEUE_NAMES.NOTIFICATIONS, JOB_NAMES.SEND_EMAIL, { registrationId: id, type: 'TOURNAMENT_CANCELLED' }),
        ));
    }
}
