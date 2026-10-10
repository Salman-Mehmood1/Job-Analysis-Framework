/**
 * Plain-text extraction from uploaded job descriptions:
 * Word (.docx and legacy .doc), PDF, and plain text / Markdown.
 */
import WordExtractor from 'word-extractor';
import { extractText, getDocumentProxy } from 'unpdf';
import { HttpError } from './http';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type Kind = 'docx' | 'doc' | 'pdf' | 'text';

/** Identify the file by its first bytes, falling back to the extension for text. */
function detect(buf: Buffer, filename: string): Kind {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  // ZIP container (docx). Other Office ZIPs (xlsx, pptx) fail later with a clear message.
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'docx';
  // OLE2 compound file (legacy .doc)
  if (buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'doc';
  if (/\.(txt|md|markdown|text)$/i.test(filename) || !buf.includes(0)) return 'text';
  throw new HttpError(415, 'Unsupported file. Upload a Word (.docx or .doc), PDF or plain-text file.');
}

/** Collapse whitespace noise left by document layouts while keeping paragraph breaks. */
function tidy(text: string): string {
  const collapsed = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();
  // Page headers and footers often come through once per section; keep the first copy.
  const seen = new Set<string>();
  return collapsed
    .split(/\n\n/)
    .filter((para) => {
      const key = para.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n\n');
}

/** "Job title: X" / "Position: X" line near the top of a description, if present. */
export function titleFromText(text: string): string | null {
  const m = text.slice(0, 2000).match(/^\s*(?:job\s*title|position\s*title|position|role\s*title|role)\s*[:\-–]\s*(.{2,120})$/im);
  return m ? m[1].trim() : null;
}

export async function extractJobDescription(
  buf: Buffer,
  filename: string,
): Promise<{ text: string; kind: Kind; pages?: number; title: string | null }> {
  if (!buf.length) throw new HttpError(400, 'The file is empty.');
  if (buf.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'The file is larger than 10 MB.');
  const kind = detect(buf, filename);

  let text: string;
  let pages: number | undefined;
  try {
    if (kind === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const r = await extractText(pdf, { mergePages: true });
      text = r.text;
      pages = r.totalPages;
    } else if (kind === 'docx' || kind === 'doc') {
      const doc = await new WordExtractor().extract(buf);
      text = [doc.getBody(), doc.getHeaders({ includeFooters: false }), doc.getTextboxes({ includeHeadersAndFooters: false })]
        .filter((s) => s && s.trim())
        .join('\n\n');
    } else {
      text = buf.toString('utf8');
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const msg = (err as Error).message ?? '';
    if (/password/i.test(msg)) throw new HttpError(422, 'This PDF is password-protected. Remove the password and upload it again.');
    throw new HttpError(422, `Could not read this ${kind === 'pdf' ? 'PDF' : kind === 'text' ? 'file' : 'Word document'}. It may be damaged or in an unsupported format.`);
  }

  text = tidy(text);
  if (text.length < 20) {
    throw new HttpError(
      422,
      kind === 'pdf'
        ? 'No text found in this PDF. It is probably a scanned image; use a PDF with selectable text or paste the description.'
        : 'No text found in this file.',
    );
  }
  return { text, kind, pages, title: titleFromText(text) };
}
