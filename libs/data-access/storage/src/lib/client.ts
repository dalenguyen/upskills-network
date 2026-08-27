import { Storage } from '@google-cloud/storage';

import { mediaBucketName } from './config';
import {
  CloudStorageMediaStorage,
  type CloudStorageBucket,
  type CloudStorageClient,
  type CloudStorageFile,
  type CloudStorageSaveOptions,
} from './cloud-storage';
import type { MediaStorage } from './media-storage';

/**
 * The memoized media storage. Module scope is the right lifetime: Cloud Run
 * keeps the instance warm between requests, and re-initializing per request
 * would rebuild the client and its auth/socket state every time.
 */
let mediaStorage: MediaStorage | undefined;

/**
 * Lazily initialize and return the Cloud Storage-backed media port.
 *
 * ## Credentials
 *
 * **Application Default Credentials only** — never a service-account key file.
 * On Cloud Run that is the runtime service account, resolved from the metadata
 * server; locally it is whatever `gcloud auth application-default login` left
 * behind. `new Storage()` with no `keyFilename`/`credentials` is exactly the
 * ADC path.
 *
 * ## Project id
 *
 * The project id comes from `GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT` when set,
 * and is otherwise auto-detected from ADC — which is what happens on Cloud Run.
 * There is no storage emulator, so the env-var branch exists for parity with
 * `getDb()` and for local tooling that already exports those variables, not to
 * switch transports.
 */
export function getMediaStorage(): MediaStorage {
  if (mediaStorage) {
    return mediaStorage;
  }

  const projectId =
    process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];

  const gcs = new Storage(projectId ? { projectId } : undefined);

  mediaStorage = new CloudStorageMediaStorage(
    toCloudStorageClient(gcs),
    mediaBucketName(),
  );

  return mediaStorage;
}

/**
 * Adapt the real SDK to the narrow seam {@link CloudStorageMediaStorage} is
 * written against.
 *
 * The adapter exists because the SDK's `Bucket#getFiles()` resolves to a tuple
 * (`[File[], …]`) and because `File#save()` has a large options type. Keeping
 * that shape-shifting here means neither the provider nor its tests have to
 * know about it.
 */
function toCloudStorageClient(gcs: Storage): CloudStorageClient {
  return {
    bucket(name: string): CloudStorageBucket {
      const bucket = gcs.bucket(name);

      return {
        file(path: string): CloudStorageFile {
          const file = bucket.file(path);

          return {
            name: file.name,
            save(data: Buffer, options: CloudStorageSaveOptions) {
              return file.save(data, {
                metadata: {
                  cacheControl: options.metadata.cacheControl,
                  contentType: options.metadata.contentType,
                },
              });
            },
            delete() {
              return file.delete();
            },
          };
        },
        async getFiles(options: { prefix?: string }) {
          const [files] = await bucket.getFiles(options);

          return files.map((file) => ({
            name: file.name,
            timeCreated: file.metadata.timeCreated,
          }));
        },
      };
    },
  };
}
