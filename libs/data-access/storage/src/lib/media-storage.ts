/**
 * The storage port every media-writing handler depends on.
 *
 * This is deliberately narrower than the Cloud Storage SDK. A handler that
 * receives a {@link MediaStorage} can upload, delete, and list objects, and
 * nothing else. That is what makes the port cheap to fake in handler tests and
 * impossible to accidentally reach for provider-specific features from
 * application code.
 */

/** One object to create in the media bucket. */
export interface UploadMediaInput {
  /** Object path inside the bucket, e.g. `orgs/org-1/event-media/abc.jpg`. */
  path: string;

  /** The bytes to store. */
  data: Buffer;

  /** `Content-Type` written onto the object; never the Cloud Storage default. */
  contentType: string;
}

/** One object already stored in the media bucket. */
export interface MediaObject {
  /** Object path inside the bucket, e.g. `orgs/org-1/event-media/abc.jpg`. */
  path: string;

  /** When Cloud Storage created the object. */
  createdAt: Date;
}

/** Storage operations available to media handlers. */
export interface MediaStorage {
  /**
   * Create or overwrite the object at `path` and return its public URL.
   *
   * The returned URL uses the same public form as {@link publicUrlForPath}.
   */
  upload(input: UploadMediaInput): Promise<string>;

  /**
   * Delete the object at `path`.
   *
   * Deleting an object that is not there is treated as success, because every
   * caller is deleting something it merely believes exists.
   */
  delete(path: string): Promise<void>;

  /** Objects in the bucket whose path starts with `prefix`. */
  list(prefix: string): Promise<MediaObject[]>;
}
