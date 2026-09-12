import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { createWorker } from 'tesseract.js';

const execFileAsync = promisify(execFile);
export const ALLOWED = new Set(['txt','docx','pdf','png','jpg','jpeg','webp']);
const IMAGE_EXTS = new Set(['png','jpg','jpeg','webp']);
const MAX_TEXT = 20000;

async function ocrImage(filePath) {
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(filePath);
    return (data.text || '').trim();
  } finally {
    await worker.terminate();
  }
}

async function ocrPdf(filePath) {
  // pdftoppm is used only when a PDF has no extractable text.
  // Install Poppler in production (Windows: pdftoppm.exe on PATH; Linux: poppler-utils).
  const tmp = `${filePath}.ocr`;
  await fs.mkdir(tmp, { recursive: true });
  try {
    await execFileAsync('pdftoppm', ['-jpeg', '-r', '160', '-f', '1', '-l', '5', filePath, path.join(tmp, 'page')], { timeout: 60000 });
    const files = (await fs.readdir(tmp)).filter(x => x.endsWith('.jpg')).sort();
    let out = '';
    for (const f of files) {
      if (out.length >= MAX_TEXT) break;
      out += `\n${await ocrImage(path.join(tmp, f))}`;
    }
    return out.slice(0, MAX_TEXT);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export async function extract(file) {
  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ALLOWED.has(ext)) throw new Error('Unsupported file type');
  if (ext === 'txt') return (await fs.readFile(file.path, 'utf8')).slice(0, MAX_TEXT);
  if (ext === 'docx') return (await mammoth.extractRawText({ path: file.path })).value.slice(0, MAX_TEXT);
  if (ext === 'pdf') {
    const b = await fs.readFile(file.path);
    const r = await pdfParse(b);
    if (r.text.trim()) return r.text.slice(0, MAX_TEXT);
    return await ocrPdf(file.path);
  }
  if (IMAGE_EXTS.has(ext)) return (await ocrImage(file.path)).slice(0, MAX_TEXT);
  return '';
}
