import path from 'node:path';
import { createApp } from './app';
import { openDb } from './db';
import { aiEnabled, MODEL } from './jd';
import { seedDemo } from './seed';

const db = openDb();
if (process.env.SEED_DEMO !== 'false') seedDemo(db);

const app = createApp(db, { staticDir: path.resolve('dist/client') });
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Job evaluation API listening on http://localhost:${port}`);
  console.log(aiEnabled() ? `JD analyser: Claude (${MODEL})` : 'JD analyser: rule-based (set ANTHROPIC_API_KEY to enable Claude)');
});
