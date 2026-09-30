import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

export const MAX_CAPTURE_FILE_BYTES = 10 * 1024 * 1024;
export class CaptureFileError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readCaptureFile(path: string): Promise<Buffer> {
  try {
    const file = await new ObjectStorageService().getObjectEntityFile(path);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isFinite(size) || size <= 0) throw new CaptureFileError(400, "Attachment is empty or unavailable");
    if (size > MAX_CAPTURE_FILE_BYTES) throw new CaptureFileError(413, "Files must be 10 MB or smaller");
    const chunks: Buffer[] = [];
    let total = 0;
    // Bound the read even if an upload is overwritten after its metadata check.
    const stream = file.createReadStream({ start: 0, end: MAX_CAPTURE_FILE_BYTES });
    const timeout = setTimeout(() => stream.destroy(new Error("Attachment read timed out")), 15_000);
    try {
      for await (const part of stream) {
        const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
        total += chunk.length;
        if (total > MAX_CAPTURE_FILE_BYTES) {
          stream.destroy();
          throw new CaptureFileError(413, "Files must be 10 MB or smaller");
        }
        chunks.push(chunk);
      }
    } finally {
      clearTimeout(timeout);
      stream.destroy();
    }
    if (!total) throw new CaptureFileError(400, "Attachment is empty");
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof CaptureFileError) throw error;
    if (error instanceof ObjectNotFoundError) throw new CaptureFileError(400, "Attachment upload is not complete");
    throw new CaptureFileError(503, "Unable to read attachment. Please try again.");
  }
}