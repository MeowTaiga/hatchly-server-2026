import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('StorageService');

/** R2 bucket used for all Hatchly image assets */
const IMAGE_BUCKET = 'hatchly-images';

/** Custom domain pointing to the R2 bucket (configured in Cloudflare dashboard) */
const PUBLIC_IMAGE_HOST = 'images.hatchly.me';

const SIGNED_URL_EXPIRY = 3600; // 1 hour

/**
 * Cloudflare R2 object storage client (S3-compatible).
 * Handles file uploads, signed URL generation, and deletion.
 * Exported as a singleton (`storageService`).
 */
class StorageService {
  private client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.CLOUDFLARE_ACCESS_KEY,
        secretAccessKey: env.CLOUDFLARE_SECRET_KEY,
      },
    });
    log.info('StorageService initialised (Cloudflare R2)');
  }

  /**
   * Uploads a file buffer to R2 and returns the public URL.
   *
   * @param key         — Object key / path (e.g. "pets/user123/avatar.png")
   * @param buffer      — File contents
   * @param contentType — MIME type (e.g. "image/png")
   * @returns Public URL via the custom domain (e.g. https://images.hatchly.me/pets/abc.png)
   */
  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: IMAGE_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      const publicUrl = `https://${PUBLIC_IMAGE_HOST}/${key}`;
      log.info({ key, publicUrl }, 'File uploaded to R2');
      return publicUrl;
    } catch (err: any) {
      log.error({ err, key }, 'R2 upload failed');
      throw new AppError('File upload failed', 502, 'STORAGE_UPLOAD_FAILED');
    }
  }

  /**
   * Decodes a base64 data URI, uploads the resulting buffer to R2,
   * and returns the public URL.
   *
   * @param dataUri — e.g. "data:image/png;base64,iVBOR..."
   * @param folder  — Folder prefix for the key (e.g. "pets")
   * @returns Public URL for the uploaded image
   */
  async uploadBase64(dataUri: string, folder: string): Promise<string> {
    const match = dataUri.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
    if (!match) {
      throw new AppError('Invalid base64 image data URI', 400, 'INVALID_DATA_URI');
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const key = `${folder}/${randomUUID()}.${ext}`;
    const contentType = `image/${match[1]}`;

    return this.upload(key, buffer, contentType);
  }

  /**
   * Generates a time-limited signed URL for reading a private object.
   *
   * @param key — Object key / path
   * @returns Signed URL valid for 1 hour
   */
  async getSignedUrl(key: string): Promise<string> {
    try {
      const command = new GetObjectCommand({ Bucket: IMAGE_BUCKET, Key: key });
      const url = await getSignedUrl(this.client, command, { expiresIn: SIGNED_URL_EXPIRY });
      return url;
    } catch (err: any) {
      log.error({ err, key }, 'Failed to generate signed URL');
      throw new AppError('Could not generate download URL', 502, 'STORAGE_SIGNED_URL_FAILED');
    }
  }

  /**
   * Deletes an object from R2.
   *
   * @param key — Object key / path
   */
  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: IMAGE_BUCKET, Key: key }),
      );
      log.info({ key }, 'File deleted from R2');
    } catch (err: any) {
      log.error({ err, key }, 'R2 delete failed');
      throw new AppError('File deletion failed', 502, 'STORAGE_DELETE_FAILED');
    }
  }

  /** Returns the public URL for a given key (no network call needed) */
  publicUrl(key: string): string {
    return `https://${PUBLIC_IMAGE_HOST}/${key}`;
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const storageService = new StorageService();
