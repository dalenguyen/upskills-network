import { randomBytes } from 'node:crypto';
import type { OrgContext } from '@upskills/auth';
import type { OrgRole } from '@upskills/models';
import type { MediaStorage } from '@upskills/storage';
import {
  createError,
  defineEventHandler,
  getRequestHeader,
  readRawBody,
  type EventHandler,
  type H3Event,
} from 'h3';
import { badRequest, toHttpError, type ApiErrorData } from '../http-error';
import { readOrgId } from './dashboard-access';

/**
 * `POST /api/v1/dashboard/events/image?orgId=` — upload an event hero image.
 *
 * The create form uploads before an event exists, so the object path is keyed
 * by org and a server-generated media id only — never an event id. The org and
 * the caller's authority come from the same places as every other dashboard
 * write: `?orgId=` plus the session.
 */

/** 5 MB, checked from the declared length and again from the real byte count. */
export const MAX_EVENT_IMAGE_BYTES = 5 * 1024 * 1024;

type AcceptedImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

const ACCEPTED_IMAGE_EXTENSIONS: Record<AcceptedImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface DashboardEventImageUploadResponse {
  /** Public Cloud Storage URL that serves the stored bytes. */
  url: string;
  /** Object path inside the media bucket. */
  path: string;
  /** Sniffed content type written onto the object. */
  contentType: AcceptedImageContentType;
  /** Number of bytes stored. */
  size: number;
}

export interface DashboardEventImageUploadDeps {
  /** `requireOrgRole` from `@upskills/auth`. */
  requireOrgRole(
    event: H3Event,
    orgId: string,
    ...roles: OrgRole[]
  ): Promise<OrgContext>;
  /** The media storage port from `@upskills/storage`. */
  storage: MediaStorage;
}

interface MultipartFilePart {
  name: string;
  filename: string;
  data: Buffer;
}

export function createDashboardEventImageUploadHandler(
  deps: DashboardEventImageUploadDeps,
): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const orgId = readOrgId(event);
      assertSafeObjectPathSegment(orgId);

      await deps.requireOrgRole(event, orgId, 'admin', 'manager');

      // Reject an oversized request from the declared length before reading the
      // body at all, so a huge upload never has to be buffered.
      const declaredLength = parseContentLength(
        getRequestHeader(event, 'content-length'),
      );
      if (
        declaredLength !== undefined &&
        declaredLength > MAX_EVENT_IMAGE_BYTES
      ) {
        throw imageTooLargeError();
      }

      const boundary = readMultipartBoundary(
        getRequestHeader(event, 'content-type'),
      );
      if (boundary === null) {
        throw badRequest(
          'invalid-multipart',
          'Expected a multipart/form-data body with a boundary.',
        );
      }

      const rawBody = await readRawBody(event);
      if (rawBody.byteLength > MAX_EVENT_IMAGE_BYTES) {
        throw imageTooLargeError();
      }

      const part = parseMultipartFile(rawBody, boundary);
      if (part === null || part.name !== 'file' || part.filename === '') {
        throw badRequest(
          'invalid-image',
          'Expected a multipart file field named "file".',
        );
      }

      const detected = detectImageContentType(part.data);
      if (detected === 'image/svg+xml') {
        throw badRequest(
          'invalid-image-type',
          'SVG images are not accepted because they can contain scripts.',
        );
      }
      if (detected === null) {
        throw badRequest(
          'invalid-image-type',
          'Expected a JPEG, PNG, or WebP image.',
        );
      }

      const extension = ACCEPTED_IMAGE_EXTENSIONS[detected];
      const path = `orgs/${orgId}/event-media/${newMediaId()}.${extension}`;

      const url = await deps.storage.upload({
        path,
        data: part.data,
        contentType: detected,
      });

      return {
        url,
        path,
        contentType: detected,
        size: part.data.byteLength,
      } satisfies DashboardEventImageUploadResponse;
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

function imageTooLargeError() {
  return createError({
    statusCode: 413,
    statusMessage: 'Payload Too Large',
    message: 'Event images must be 5 MB or smaller.',
    data: { error: 'image-too-large' } satisfies ApiErrorData,
  });
}

function parseContentLength(header: string | undefined): number | undefined {
  if (header === undefined) {
    return undefined;
  }

  const value = Number(header.trim());
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readMultipartBoundary(contentType: string | undefined): string | null {
  if (contentType === undefined) {
    return null;
  }

  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return null;
  }

  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary === undefined || boundary === '' ? null : boundary;
}

/**
 * The `?orgId=` value is an object path segment, not a query string. Keep a
 * slash, backslash, or dot segment out of the stored object path.
 */
function assertSafeObjectPathSegment(orgId: string): void {
  if (
    orgId === '.' ||
    orgId === '..' ||
    orgId.includes('/') ||
    orgId.includes('\\')
  ) {
    throw badRequest(
      'invalid-org-id',
      'Expected an org id without path separators.',
    );
  }
}

/** A server-generated media id. 24 random bytes make the path unguessable. */
function newMediaId(): string {
  return randomBytes(24).toString('base64url');
}

function parseMultipartFile(
  body: Buffer,
  boundary: string,
): MultipartFilePart | null {
  const delimiter = Buffer.from(`--${boundary}`);
  const firstBoundary = body.indexOf(delimiter);

  if (firstBoundary === -1) {
    return null;
  }

  let cursor = firstBoundary + delimiter.length;

  while (cursor < body.length) {
    // `--boundary--` closes the body; no file part follows it.
    if (body.subarray(cursor, cursor + 2).toString() === '--') {
      return null;
    }

    cursor = skipLineEnding(body, cursor);
    const headerEnd = body.indexOf('\r\n\r\n', cursor);

    if (headerEnd === -1) {
      return null;
    }

    const headerBlock = body.subarray(cursor, headerEnd).toString('utf8');
    const disposition = parseContentDisposition(headerBlock);

    const nextBoundary = body.indexOf(delimiter, headerEnd + 4);
    if (nextBoundary === -1) {
      return null;
    }

    let dataEnd = nextBoundary;
    if (
      dataEnd >= 2 &&
      body.subarray(dataEnd - 2, dataEnd).toString() === '\r\n'
    ) {
      dataEnd -= 2;
    }

    if (disposition.name === 'file' && disposition.filename !== undefined) {
      return {
        name: disposition.name,
        filename: disposition.filename,
        data: body.subarray(headerEnd + 4, dataEnd),
      };
    }

    cursor = nextBoundary + delimiter.length;
  }

  return null;
}

function skipLineEnding(body: Buffer, index: number): number {
  if (body[index] === 0x0d && body[index + 1] === 0x0a) {
    return index + 2;
  }
  if (body[index] === 0x0a) {
    return index + 1;
  }
  return index;
}

function parseContentDisposition(headerBlock: string): {
  name?: string;
  filename?: string;
} {
  let name: string | undefined;
  let filename: string | undefined;

  for (const line of headerBlock.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) {
      continue;
    }

    const headerName = line.slice(0, colon).trim().toLowerCase();
    if (headerName !== 'content-disposition') {
      continue;
    }

    const value = line.slice(colon + 1).trim();
    name = /name="?([^";]+)"?/i.exec(value)?.[1];
    filename = /filename="?([^";]+)"?/i.exec(value)?.[1];
    break;
  }

  return { name, filename };
}

function detectImageContentType(
  data: Buffer,
): AcceptedImageContentType | 'image/svg+xml' | null {
  if (startsWith(data, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }

  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }

  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (looksLikeSvg(data)) {
    return 'image/svg+xml';
  }

  return null;
}

function startsWith(data: Buffer, signature: number[]): boolean {
  if (data.length < signature.length) {
    return false;
  }

  return signature.every((byte, index) => data[index] === byte);
}

/**
 * SVG has no magic bytes, but it is the one type the magic-byte layer must
 * single out. Sniff the text forms an SVG document can legally start with so
 * an `image/svg+xml` payload wearing an `image/png` content type is refused
 * with a reason rather than merely "unrecognized".
 */
function looksLikeSvg(data: Buffer): boolean {
  let index = 0;

  // Skip a UTF-8 BOM.
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    index = 3;
  }

  while (index < data.length) {
    const byte = data[index];
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      index += 1;
    } else {
      break;
    }
  }

  const start = data
    .subarray(index, Math.min(index + 256, data.length))
    .toString('utf8')
    .trimStart()
    .toLowerCase();

  return (
    start.startsWith('<svg') ||
    start.startsWith('<?xml') ||
    start.startsWith('<!doctype svg')
  );
}
