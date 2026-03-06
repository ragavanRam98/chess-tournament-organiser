import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
    private readonly s3: S3Client;
    private readonly bucket: string;

    constructor() {
        this.bucket = process.env.R2_BUCKET_NAME!;
        this.s3 = new S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID!,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
            },
        });
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
