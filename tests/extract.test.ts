import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openDb } from '../server/db';
import { extractJobDescription } from '../server/extract';
import { seedDemo } from '../server/seed';

const fx = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n));

describe('job description extraction', () => {
  for (const file of ['jd.docx', 'jd.doc', 'jd.pdf']) {
    it(`reads ${file}, including table cells and later pages`, async () => {
      const r = await extractJobDescription(fx(file), file);
      expect(r.text).toContain('Logistics Manager');
      expect(r.text).toMatch(/\$18 million/);
      expect(r.text).toContain('Degree in supply chain'); // table cell in Word, page 2 in PDF
      expect(r.text).toContain('Operations Director');
      expect(r.title).toBe('Logistics Manager');
      expect(r.text.match(/Confidential/g)?.length ?? 0).toBeLessThanOrEqual(1); // repeated page header kept once
    });
  }

  it('reports the page count for PDFs', async () => {
    expect((await extractJobDescription(fx('jd.pdf'), 'jd.pdf')).pages).toBe(2);
  });

  it('explains scanned PDFs with no text layer', async () => {
    await expect(extractJobDescription(fx('scanned.pdf'), 'scanned.pdf')).rejects.toThrow(/scanned image/);
  });

  it('rejects unsupported binary files', async () => {
    await expect(extractJobDescription(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), 'logo.png')).rejects.toThrow(/Unsupported file/);
  });

  it('reads plain text', async () => {
    const r = await extractJobDescription(Buffer.from('Leads the finance team of 8 and owns budgeting.'), 'jd.txt');
    expect(r.kind).toBe('text');
  });
});

describe('POST /api/jd/extract', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    const db = openDb(':memory:');
    seedDemo(db);
    app = createApp(db);
  });

  it('needs a signed-in user', async () => {
    await request(app).post('/api/jd/extract?filename=jd.pdf').set('Content-Type', 'application/octet-stream').send(fx('jd.pdf')).expect(401);
  });

  it('returns the text of an uploaded Word file to an evaluator', async () => {
    const a = request.agent(app);
    await a.post('/api/auth/login').send({ email: 'evaluator@demo.com', password: 'demo1234' }).expect(200);
    const r = await a
      .post('/api/jd/extract?filename=jd.docx')
      .set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .send(fx('jd.docx'))
      .expect(200);
    expect(r.body.kind).toBe('docx');
    expect(r.body.text).toContain('Manages a team of 25');
  });

  it('returns a clear error for a scanned PDF', async () => {
    const a = request.agent(app);
    await a.post('/api/auth/login').send({ email: 'admin@demo.com', password: 'demo1234' }).expect(200);
    const r = await a.post('/api/jd/extract?filename=scan.pdf').set('Content-Type', 'application/pdf').send(fx('scanned.pdf')).expect(422);
    expect(r.body.error).toMatch(/scanned/);
  });
});
