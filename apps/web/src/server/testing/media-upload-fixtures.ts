/**
 * Multipart bodies and image byte signatures for the hero-image upload specs.
 *
 * The handler under test only sniffs magic bytes, so these are deliberately
 * tiny signatures rather than full decodable images. They exist here so the
 * handler spec and the route-wiring spec build the same valid multipart body
 * instead of each inventing one.
 */

export const TEST_MULTIPART_BOUNDARY = '----UpskillsMediaUploadBoundary';

export interface MultipartFileBodyOptions {
  data: Buffer;
  field?: string;
  filename?: string;
  contentType?: string;
  boundary?: string;
}

/** One `file` part, with the headers a browser would send. */
export function multipartFileBody(options: MultipartFileBodyOptions): Buffer {
  const boundary = options.boundary ?? TEST_MULTIPART_BOUNDARY;
  const field = options.field ?? 'file';
  const filename = options.filename ?? 'image.bin';
  const contentType = options.contentType ?? 'application/octet-stream';

  return Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n`,
    ),
    Buffer.from(`Content-Type: ${contentType}\r\n\r\n`),
    options.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

/** A JPEG starts with `FF D8 FF`. */
export function jpegBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
}

/** A PNG starts with the eight-byte signature. */
export function pngBytes(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
}

/** A WebP is `RIFF....WEBP`. */
export function webpBytes(): Buffer {
  return Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
  ]);
}

/** An SVG script payload, exactly the kind of file the route must refuse. */
export function svgBytes(): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
}
