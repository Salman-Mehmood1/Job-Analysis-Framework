import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { openDb } from './db';
import { aiEnabled, MODEL } from './jd';
import { seedDemo, topUpDemo } from './seed';

// `npm run dev` passes --dev: the UI is then served live by Vite on port 5173, not from the last build.
const dev = process.argv.includes('--dev');

const db = openDb();
if (process.env.SEED_DEMO !== 'false') {
  seedDemo(db);
  topUpDemo(db);
}

const staticDir = path.resolve('dist/client');
const app = createApp(db, { staticDir: dev ? undefined : staticDir });
if (dev) {
  app.get('/', (_req, res) => res.redirect('http://localhost:5173/'));
}
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  if (dev) {
    console.log(`API on http://localhost:${port} — open the app at http://localhost:5173`);
  } else if (fs.existsSync(staticDir)) {
    console.log(`Job evaluation app running: open http://localhost:${port}`);
  } else {
    console.log(`API on http://localhost:${port}, but the UI has not been built: run "npm start" (it builds first).`);
  }
  console.log(aiEnabled() ? `JD analyser: Claude (${MODEL})` : 'JD analyser: rule-based (set ANTHROPIC_API_KEY to enable Claude)');
});
