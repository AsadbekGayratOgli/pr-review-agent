import { Hono } from 'hono';

type Bindings = Required<Env> & {
  GITHUB_WEBHOOK_SECRET?: string;
};

const webhook = new Hono<{ Bindings: Bindings }>();

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function verifySignature(secret: string, header: string | undefined, body: ArrayBuffer): Promise<boolean> {
  const match = /^sha256=([\da-f]+)$/i.exec(header ?? '');
  if (!match) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, hexToBytes(match[1]), body);
}

webhook.post('/', async (c) => {
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: 'webhook secret not configured' }, 500);
  }

  const body = await c.req.arrayBuffer();
  if (!(await verifySignature(secret, c.req.header('X-Hub-Signature-256'), body))) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  const event = c.req.header('X-GitHub-Event') ?? '';
  if (event === 'ping') {
    return c.json({ ok: 'pong' });
  }
  if (event !== 'pull_request') {
    return c.json({ ok: 'ignored', event });
  }

  const deliveryId = c.req.header('X-GitHub-Delivery') ?? '';
  if (!deliveryId) {
    return c.json({ error: 'missing X-GitHub-Delivery' }, 400);
  }

  const insert = await c.env.DB.prepare('INSERT OR IGNORE INTO deliveries (id, received_at) VALUES (?, ?)')
    .bind(deliveryId, Date.now())
    .run();
  if ((insert.meta.changes ?? 0) === 0) {
    return c.json({ ok: 'duplicate', deliveryId });
  }

  let payload: { action?: string; number?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  await c.env.PLAN_QUEUE.send({ t: 'noop', deliveryId, action: payload.action, pr: payload.number });
  return c.json({ ok: 'accepted', deliveryId }, 202);
});

export default webhook;
