import { MEDIA_CACHE_CONTROL, publicUrlForPath } from './config';
import type { MediaStorage, UploadMediaInput } from './media-storage';

/**
 * The slice of the Cloud Storage SDK the provider actually uses.
 *
 * Keeping this as a structural interface rather than the SDK's `Storage` class
 * is what lets the provider be tested against an object literal fake instead
 * of a mock of a large class. The real SDK is adapted to it in
 * `getMediaStorage()`; application code never sees these types.
 */
export interface CloudStorageClient {
  bucket(name: string): CloudStorageBucket;
}

export interface CloudStorageBucket {
  file(path: string): CloudStorageFile;
  getFiles(options: { prefix?: string }): Promise<CloudStorageObject[]>;
}

export interface CloudStorageFile {
  readonly name: string;
  save(data: Buffer, options: CloudStorageSaveOptions): Promise<unknown>;
  delete(): Promise<unknown>;
}

export interface CloudStorageObject {
  readonly name: string;
}

/** The metadata the provider writes on every uploaded object. */
export interface CloudStorageSaveOptions {
  metadata: {
    cacheControl: string;
    contentType: string;
  };
}

/**
 * The Cloud Storage-backed {@link MediaStorage}.
 *
 * The bucket name is supplied by the caller (`getMediaStorage()` passes
 * `mediaBucketName()`); the provider itself contains no bucket literal, so a
 * misconfigured deployment fails at the accessor rather than writing to a
 * guessed bucket.
 */
export class CloudStorageMediaStorage implements MediaStorage {
  constructor(
    private readonly client: CloudStorageClient,
    private readonly bucketName: string,
  ) {}

  async upload(input: UploadMediaInput): Promise<string> {
    // Build the URL first, because doing so validates the path. Called after
    // `save`, a rejected path would leave a real object in the bucket while the
    // caller saw only a thrown error — an orphan nothing knows to clean up.
    const url = publicUrlForPath(this.bucketName, input.path);

    const file = this.client.bucket(this.bucketName).file(input.path);

    await file.save(input.data, {
      metadata: {
        cacheControl: MEDIA_CACHE_CONTROL,
        contentType: input.contentType,
      },
    });

    return url;
  }

  async delete(path: string): Promise<void> {
    const file = this.client.bucket(this.bucketName).file(path);

    try {
      await file.delete();
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const objects = await this.client
      .bucket(this.bucketName)
      .getFiles({ prefix });

    return objects.map((object) => object.name);
  }
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === 404 || code === '404';
}
