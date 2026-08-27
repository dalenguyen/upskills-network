import { describe, expect, it } from 'vitest';

import { MEDIA_CACHE_CONTROL } from './config';
import {
  CloudStorageMediaStorage,
  type CloudStorageClient,
  type CloudStorageSaveOptions,
} from './cloud-storage';

const BUCKET = 'upskills-network-media';

interface SavedObject {
  path: string;
  data: Buffer;
  options: CloudStorageSaveOptions;
}

interface FakeState {
  buckets: string[];
  saved: SavedObject[];
  deleted: string[];
  listedPrefixes: (string | undefined)[];
}

/**
 * A fake standing in for the Cloud Storage SDK.
 *
 * There is no storage emulator, and no test may touch the real bucket, so the
 * seam the provider is written against is the only place these assertions can
 * live. It records what it was asked to do rather than simulating a bucket —
 * what matters is the arguments the provider hands the SDK.
 */
function fakeClient(options: { deleteError?: unknown; files?: string[] }): {
  client: CloudStorageClient;
  state: FakeState;
} {
  const state: FakeState = {
    buckets: [],
    saved: [],
    deleted: [],
    listedPrefixes: [],
  };

  const client: CloudStorageClient = {
    bucket(name) {
      state.buckets.push(name);
      return {
        file(path) {
          return {
            name: path,
            async save(data, saveOptions) {
              state.saved.push({ path, data, options: saveOptions });
              return undefined;
            },
            async delete() {
              if (options.deleteError !== undefined) {
                throw options.deleteError;
              }
              state.deleted.push(path);
              return undefined;
            },
          };
        },
        async getFiles(listOptions) {
          state.listedPrefixes.push(listOptions.prefix);
          return (options.files ?? []).map((name) => ({ name }));
        },
      };
    },
  };

  return { client, state };
}

describe('CloudStorageMediaStorage.upload', () => {
  it('writes to the configured bucket at the given path', async () => {
    const { client, state } = fakeClient({});
    const storage = new CloudStorageMediaStorage(client, BUCKET);

    await storage.upload({
      path: 'orgs/org-1/event-media/abc.jpg',
      data: Buffer.from('bytes'),
      contentType: 'image/jpeg',
    });

    expect(state.buckets).toEqual([BUCKET]);
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0].path).toBe('orgs/org-1/event-media/abc.jpg');
    expect(state.saved[0].data.toString()).toBe('bytes');
  });

  // The whole reason MEDIA_CACHE_CONTROL exists: Cloud Storage's default for a
  // public object keeps a deleted object readable at its own URL for an hour.
  it('sets Cache-Control explicitly rather than taking the default', async () => {
    const { client, state } = fakeClient({});
    const storage = new CloudStorageMediaStorage(client, BUCKET);

    await storage.upload({
      path: 'orgs/org-1/event-media/abc.jpg',
      data: Buffer.from('bytes'),
      contentType: 'image/jpeg',
    });

    expect(state.saved[0].options.metadata.cacheControl).toBe(
      MEDIA_CACHE_CONTROL,
    );
  });

  it('sets the content type from the caller, not from the file name', async () => {
    const { client, state } = fakeClient({});
    const storage = new CloudStorageMediaStorage(client, BUCKET);

    await storage.upload({
      path: 'orgs/org-1/event-media/abc.jpg',
      data: Buffer.from('bytes'),
      contentType: 'image/webp',
    });

    expect(state.saved[0].options.metadata.contentType).toBe('image/webp');
  });

  it('returns the public URL of the stored object', async () => {
    const { client } = fakeClient({});
    const storage = new CloudStorageMediaStorage(client, BUCKET);

    const url = await storage.upload({
      path: 'orgs/org-1/event-media/abc.jpg',
      data: Buffer.from('bytes'),
      contentType: 'image/jpeg',
    });

    expect(url).toBe(
      `https://storage.googleapis.com/${BUCKET}/orgs/org-1/event-media/abc.jpg`,
    );
  });
});

describe('CloudStorageMediaStorage.delete', () => {
  it('deletes the object at the given path', async () => {
    const { client, state } = fakeClient({});
    const storage = new CloudStorageMediaStorage(client, BUCKET);

    await storage.delete('orgs/org-1/event-media/abc.jpg');

    expect(state.buckets).toEqual([BUCKET]);
    expect(state.deleted).toEqual(['orgs/org-1/event-media/abc.jpg']);
  });

  // Every caller is deleting something it merely believes exists — a hero image
  // recorded on an event that was already removed from the bucket by an earlier
  // partial failure. Treating that as an error would fail the event delete.
  it('treats a missing object as success', async () => {
    const { client } = fakeClient({ deleteError: { code: 404 } });
    const storage = new CloudStorageMediaStorage(client, BUCKET);

    await expect(
      storage.delete('orgs/org-1/event-media/gone.jpg'),
    ).resolves.toBeUndefined();
  });

  it('treats a string 404 code as success too', async () => {
    const { client } = fakeClient({ deleteError: { code: '404' } });
    const storage = new CloudStorageMediaStorage(client, BUCKET);

    await expect(
      storage.delete('orgs/org-1/event-media/gone.jpg'),
    ).resolves.toBeUndefined();
  });

  it('propagates any other failure', async () => {
    const { client } = fakeClient({ deleteError: { code: 403 } });
    const storage = new CloudStorageMediaStorage(client, BUCKET);

    await expect(
      storage.delete('orgs/org-1/event-media/denied.jpg'),
    ).rejects.toMatchObject({ code: 403 });
  });

  it('propagates a failure that carries no code at all', async () => {
    const { client } = fakeClient({ deleteError: new Error('socket hang up') });
    const storage = new CloudStorageMediaStorage(client, BUCKET);

    await expect(
      storage.delete('orgs/org-1/event-media/abc.jpg'),
    ).rejects.toThrow('socket hang up');
  });
});

describe('CloudStorageMediaStorage.list', () => {
  it('lists object paths under the prefix', async () => {
    const { client, state } = fakeClient({
      files: ['orgs/org-1/event-media/a.jpg', 'orgs/org-1/event-media/b.jpg'],
    });
    const storage = new CloudStorageMediaStorage(client, BUCKET);

    const paths = await storage.list('orgs/org-1/event-media/');

    expect(paths).toEqual([
      'orgs/org-1/event-media/a.jpg',
      'orgs/org-1/event-media/b.jpg',
    ]);
    expect(state.listedPrefixes).toEqual(['orgs/org-1/event-media/']);
  });

  it('returns an empty list when nothing matches', async () => {
    const { client } = fakeClient({ files: [] });
    const storage = new CloudStorageMediaStorage(client, BUCKET);

    await expect(storage.list('orgs/org-2/')).resolves.toEqual([]);
  });
});
