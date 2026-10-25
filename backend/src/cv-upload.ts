import { extractCvText } from "./application.ts";

export const MAX_CV_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_CV_BASE64_LENGTH = Math.ceil(MAX_CV_FILE_BYTES / 3) * 4;
export const MAX_CV_FILENAME_LENGTH = 255;
export const MAX_CV_TEXT_LENGTH = 60_000;

/** Validate and extract an uploaded DOCX without persisting anything. */
export async function extractUploadedDocx(fileName: string, base64: string): Promise<string> {
  if (fileName.trim().length === 0 || fileName.length > MAX_CV_FILENAME_LENGTH || /[\\/]/.test(fileName)) {
    throw new Error("Use a filename up to 255 characters long.");
  }
  if (!/\.docx$/i.test(fileName)) throw new Error("Upload a DOCX file.");
  if (base64.length === 0) throw new Error("The uploaded file is empty.");
  if (base64.length > MAX_CV_BASE64_LENGTH) throw new Error("The DOCX must be 5 MiB or smaller.");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error("The uploaded file data is invalid.");
  }

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_CV_FILE_BYTES || buffer.toString("base64") !== base64) {
    throw new Error(buffer.length > MAX_CV_FILE_BYTES ? "The DOCX must be 5 MiB or smaller." : "The uploaded file data is invalid.");
  }

  let text: string;
  try {
    text = await extractCvText(fileName, base64);
  } catch {
    throw new Error("Couldn't read this DOCX. Check that it is a valid Word document with at least 80 characters of text.");
  }
  if (text.length > MAX_CV_TEXT_LENGTH) throw new Error("The extracted CV text must be 60,000 characters or fewer.");
  return text;
}
