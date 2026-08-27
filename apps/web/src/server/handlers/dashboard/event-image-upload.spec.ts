import type { OrgContext } from '@upskills/auth';
import type { MediaStorage, UploadMediaInput } from '@upskills/storage';
import { describe, expect, it, vi } from 'vitest';
import { fakeForbiddenError } from '../../testing/fakes';
import { createTestEvent } from '../../testing/h3-event';
import {
  jpegBytes,
  multipartFileBody,
  pngBytes,
  svgBytes,
  TEST_MULTIPART_BOUNDARY,
  webpBytes,
} from '../../testing/media-upload-fixtures';
import { fakeOrg } from '../../testing/public-fixtures';
import {
  createDashboardEventImageUploadHandler,
  MAX_EVENT_IMAGE_BYTES,
  type DashboardEventImageUploadDeps,
} from './event-image-upload';

/** `POST /api/v1/dashboard/events/image?orgId=` — the hero image upload route. */

const ORG: OrgContext = {
  uid: 'uid-manager',
  role: 'user',
  session: {} as OrgContext['session'],
  orgId: 'org-1',
  orgRole: 'manager',
  viaPlatformAdmin: false,
  org: fakeOrg(),
};

function mediaStorage(overrides: Partial<MediaStorage> = {}): MediaStorage {
  return {
    upload: vi.fn(
      async (input: UploadMediaInput) =>
        `https://storage.googleapis.com/test-bucket/${input.path}`,
    ),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    ...overrides,
  };
}

function deps(
  overrides: Partial<DashboardEventImageUploadDeps> = {},
): DashboardEventImageUploadDeps {
  return {
    requireOrgRole: vi.fn(async () => ORG),
    storage: mediaStorage(),
    ...overrides,
  };
}

interface ImageRequestOptions {
  orgId?: string;
  /** The part's declared `Content-Type`; never trusted by the handler. */
  contentType?: string;
  contentLength?: number;
  field?: string;
}

function imageRequest(
  data: Buffer,
  options: ImageRequestOptions = {},
): ReturnType<typeof createTestEvent>['event'] {
  const boundary = TEST_MULTIPART_BOUNDARY;

  return createTestEvent({
    method: 'POST',
    url: `/api/v1/dashboard/events/image?orgId=${options.orgId ?? 'org-1'}`,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      ...(options.contentLength === undefined
        ? {}
        : { 'content-length': String(options.contentLength) }),
    },
    body: multipartFileBody({
      data,
      field: options.field ?? 'file',
      contentType: options.contentType ?? 'application/octet-stream',
      boundary,
    }),
  }).event;
}

describe('POST /api/v1/dashboard/events/image', () => {
  it.each([
    ['jpeg', jpegBytes(), 'image/jpeg', 'jpg'],
    ['png', pngBytes(), 'image/png', 'png'],
    ['webp', webpBytes(), 'image/webp', 'webp'],
  ] as const)(
    'uploads a %s and returns the public URL and bookkeeping details',
    async (_label, bytes, contentType, extension) => {
      const upload = vi.fn(
        async (input: UploadMediaInput) =>
          `https://storage.googleapis.com/test-bucket/${input.path}`,
      );
      const d = deps({ storage: mediaStorage({ upload }) });

      const result = await createDashboardEventImageUploadHandler(d)(
        imageRequest(bytes),
      );

      expect(d.requireOrgRole).toHaveBeenCalledWith(
        expect.anything(),
        'org-1',
        'admin',
        'manager',
      );
      expect(upload).toHaveBeenCalledOnce();

      const input = upload.mock.calls[0][0];
      expect(input.path).toMatch(
        new RegExp(`^orgs/org-1/event-media/[A-Za-z0-9_-]{32}\\.${extension}$`),
      );
      expect(input.contentType).toBe(contentType);
      expect(input.data).toEqual(bytes);
      expect(result).toEqual({
        url: `https://storage.googleapis.com/test-bucket/${input.path}`,
        path: input.path,
        contentType,
        size: bytes.length,
      });
    },
  );

  it('lets a platform admin upload for any org through the shared guard', async () => {
    const upload = vi.fn(
      async (input: UploadMediaInput) =>
        `https://storage.googleapis.com/test-bucket/${input.path}`,
    );
    const d = deps({
      requireOrgRole: vi.fn(async () => ({
        ...ORG,
        orgId: 'org-other',
        viaPlatformAdmin: true,
      })),
      storage: mediaStorage({ upload }),
    });

    await createDashboardEventImageUploadHandler(d)(
      imageRequest(pngBytes(), { orgId: 'org-other' }),
    );

    expect(d.requireOrgRole).toHaveBeenCalledWith(
      expect.anything(),
      'org-other',
      'admin',
      'manager',
    );
    expect(upload.mock.calls[0][0].path).toMatch(
      /^orgs\/org-other\/event-media\/[A-Za-z0-9_-]{32}\.png$/,
    );
  });

  it('answers 403 for a member below manager', async () => {
    const d = deps({
      requireOrgRole: vi.fn(async () => {
        throw fakeForbiddenError(
          'One of [admin, manager] in org "org-1" is required.',
        );
      }),
    });

    await expect(
      createDashboardEventImageUploadHandler(d)(imageRequest(pngBytes())),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'forbidden' },
    });
    expect(d.storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a declared content length above 5 MB before reading the body', async () => {
    const d = deps();
    const event = imageRequest(pngBytes(), {
      contentLength: MAX_EVENT_IMAGE_BYTES + 1,
    });
    let bodyRead = false;

    Object.defineProperty(event.node.req, 'body', {
      configurable: true,
      get() {
        bodyRead = true;
        return pngBytes();
      },
    });

    await expect(
      createDashboardEventImageUploadHandler(d)(event),
    ).rejects.toMatchObject({
      statusCode: 413,
      data: { error: 'image-too-large' },
    });
    expect(bodyRead).toBe(false);
    expect(d.storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a body whose real byte count exceeds 5 MB after reading', async () => {
    const d = deps();
    const oversized = Buffer.concat([
      pngBytes(),
      Buffer.alloc(MAX_EVENT_IMAGE_BYTES + 1 - pngBytes().length),
    ]);

    await expect(
      createDashboardEventImageUploadHandler(d)(imageRequest(oversized)),
    ).rejects.toMatchObject({
      statusCode: 413,
      data: { error: 'image-too-large' },
    });
    expect(d.storage.upload).not.toHaveBeenCalled();
  });

  it('refuses SVG bytes even when the client declares image/png', async () => {
    const d = deps();

    await expect(
      createDashboardEventImageUploadHandler(d)(
        imageRequest(svgBytes(), { contentType: 'image/png' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-image-type' },
      message: expect.stringContaining('SVG'),
    });
    expect(d.storage.upload).not.toHaveBeenCalled();
  });

  it('refuses a non-image on its magic bytes', async () => {
    const d = deps();

    await expect(
      createDashboardEventImageUploadHandler(d)(
        imageRequest(Buffer.from('plain text, not an image'), {
          contentType: 'image/png',
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'invalid-image-type' },
    });
    expect(d.storage.upload).not.toHaveBeenCalled();
  });

  it('keys the stored object by an unguessable media id with no event id', async () => {
    const upload = vi.fn(
      async (input: UploadMediaInput) =>
        `https://storage.googleapis.com/test-bucket/${input.path}`,
    );
    const d = deps({ storage: mediaStorage({ upload }) });

    await createDashboardEventImageUploadHandler(d)(imageRequest(pngBytes()));

    const path = upload.mock.calls[0][0].path;
    expect(path).toMatch(/^orgs\/org-1\/event-media\/[A-Za-z0-9_-]{32}\.png$/);
    expect(path).not.toContain('/events/');
    expect(path).not.toContain('evt-');
  });
});
