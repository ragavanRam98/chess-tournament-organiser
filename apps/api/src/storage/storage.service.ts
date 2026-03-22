import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService implements OnModuleInit {
    private readonly logger = new Logger(StorageService.name);
    private readonly s3: S3Client;
    private readonly bucket: string;
    private readonly isLocal: boolean;

    constructor() {
        this.bucket = process.env.R2_BUCKET_NAME!;
        this.isLocal = process.env.R2_ACCOUNT_ID === 'local';
        const isLocal = this.isLocal;
        this.s3 = new S3Client({
            region: 'auto',
            endpoint: isLocal
                ? (process.env.R2_PUBLIC_URL ?? 'http://localhost:9000')
                : `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID!,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
            },
            forcePathStyle: isLocal,
            ...(isLocal && { tls: false }),
        });
    }

    async onModuleInit() {
        if (!this.isLocal) return;
        try {
            await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
        } catch {
            this.logger.log(`Creating local MinIO bucket: ${this.bucket}`);
            await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        }
    }

    async upload(key: string, body: Buffer, contentType: string): Promise<void> {
        await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    }

    async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
        return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds });
    }

    async delete(key: string): Promise<void> {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }

    buildExportKey(organizerId: string, tournamentId: string, jobId: string, format: string): string {
        return `${organizerId}/${tournamentId}/${jobId}.${format.toLowerCase()}`;
    }
}
