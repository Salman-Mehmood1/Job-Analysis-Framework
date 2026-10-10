import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { authenticate } from './auth';
import type { DB } from './db';
import { HttpError } from './http';
import { authRoutes } from './routes/auth';
import { evaluationRoutes } from './routes/evaluations';
import { gradeRoutes } from './routes/grades';
import { jdRoutes } from './routes/jd';
import { jobRoutes } from './routes/jobs';
import { orgRoutes } from './routes/org';

export function createApp(db: DB, opts: { staticDir?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(authenticate);

  // A session for a user who was deactivated since sign-in is dropped.
  app.use((req, _res, next) => {
    if (req.user) {
      const row = db.prepare('SELECT active, role FROM users WHERE id = ?').get(req.user.id) as
        | { active: number; role: typeof req.user.role }
        | undefined;
      if (!row || !row.active) req.user = undefined;
      else req.user.role = row.role;
    }
    next();
  });

  app.use('/api/auth', authRoutes(db));
  app.use('/api', orgRoutes(db));
  app.use('/api/evaluations', evaluationRoutes(db));
  app.use('/api/grade-structures', gradeRoutes(db));
  app.use('/api/jd', jdRoutes(db));
  app.use('/api/jobs', jobRoutes(db));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Malformed JSON' });
    if ((err as { type?: string }).type === 'entity.too.large') return res.status(413).json({ error: 'The file is larger than 10 MB.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
