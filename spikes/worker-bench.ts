import { Hono } from 'hono';
import { z } from 'zod';
import { PR_FILES } from './fixtures/pr-files';
import { commentableLines } from './lib/diff';
import { chunkPatches } from './lib/chunk';

type Size = 'small' | 'medium' | 'large';

const findingSchema = z.object({
  path: z.string(),
  line: z.number().int(),
  endLine: z.number().int().optional(),
  severity: z.enum(['critical', 'major', 'minor', 'nit']),
  category: z.enum(['bug', 'security', 'perf', 'maintainability', 'test', 'docs']),
  title: z.string(),
  body: z.string(),
  suggestion: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

const chunkResultSchema = z.object({
  summary: z.string(),
  risk: z.enum(['low', 'medium', 'high']),
  findings: z.array(findingSchema).max(15),
});

const benchSeeds = Array.from({ length: 15 }, (_, i) => ({
  path: `src/module-${i}/handler-${i % 7}.ts`,
  line: 10 + i,
  severity: 'major',
  category: 'bug',
  title: `Seeded finding ${i}`,
  body: 'x'.repeat(400),
  confidence: 0.9,
}));

const benchApp = new Hono<{ Bindings: Required<Env> }>();

let benchKey: CryptoKey | null = null;
async function benchPrivateKey(): Promise<CryptoKey> {
  if (!benchKey) {
    const pair = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    benchKey = pair.privateKey;
  }
  return benchKey;
}

const ok = (c: import('hono').Context, body: Record<string, unknown>) => c.json({ ok: true, ...body });

benchApp.get('/hmac', async (c) => {
  const key = await crypto.subtle.importKey(
    'raw',
    crypto.getRandomValues(new Uint8Array(32)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const body = 'x'.repeat(1500);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  for (let i = 0; i < 10; i++) {
    await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(body));
  }
  return ok(c, { step: 'hmac', iterations: 10 });
});

benchApp.get('/jwt', async (c) => {
  const key = await benchPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ iat: now - 30, exp: now + 540, iss: 'bench' }));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  return ok(c, { step: 'jwt', signatureBytes: signature.byteLength });
});

benchApp.get('/parse', (c) => {
  const size = (c.req.query('size') ?? 'medium') as Size;
  const files: unknown = JSON.parse(PR_FILES[size] ?? PR_FILES.medium);
  return ok(c, { step: 'parse', size, files: (files as unknown[]).length });
});

benchApp.get('/hunk', (c) => {
  const size = (c.req.query('size') ?? 'medium') as Size;
  const files: import('./lib/diff').DiffFile[] = JSON.parse(PR_FILES[size] ?? PR_FILES.medium);
  let total = 0;
  for (const file of files) total += commentableLines(file.patch).size;
  return ok(c, { step: 'hunk', size, commentableLines: total });
});

benchApp.get('/chunk', (c) => {
  const size = (c.req.query('size') ?? 'medium') as Size;
  const files: import('./lib/diff').DiffFile[] = JSON.parse(PR_FILES[size] ?? PR_FILES.medium);
  const chunks = chunkPatches(files);
  return ok(c, { step: 'chunk', size, chunks: chunks.length });
});

benchApp.get('/queue', async (c) => {
  await c.env.PLAN_QUEUE.send({ t: 'bench', at: Date.now(), note: 'cpu-benchmark' });
  return ok(c, { step: 'queue' });
});

benchApp.get('/d1', async (c) => {
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT OR IGNORE INTO deliveries (id, received_at) VALUES (?, ?)').bind(id, Date.now()).run();
  return ok(c, { step: 'd1' });
});

benchApp.get('/do', async (c) => {
  const id = c.env.REVIEW_RUN.idFromName('bench');
  const stub = c.env.REVIEW_RUN.get(id);
  await stub.fetch('https://bench/bench');
  return ok(c, { step: 'do' });
});

benchApp.get('/zod', (c) => {
  let findings = 0;
  for (let i = 0; i < 100; i++) {
    findings = chunkResultSchema.parse({ summary: 'bench'.repeat(20), risk: 'medium', findings: benchSeeds }).findings.length;
  }
  return ok(c, { step: 'zod', iterations: 100, findings });
});

benchApp.get('/', (c) =>
  c.json({
    steps: ['hmac', 'jwt', 'parse', 'hunk', 'chunk', 'queue', 'd1', 'do', 'zod'],
    sizes: ['small', 'medium', 'large'],
  }),
);

export default benchApp;
