import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';

const DELIVERIES_TABLE = 'CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);';

beforeAll(async () => {
  await env.DB.exec(DELIVERIES_TABLE);
});

async function sign(secret: string, body: string): Promise<string> {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function post(
  body: string,
  headers: Record<string, string>,
): Promise<Response> {
  return SELF.fetch('https://test/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

const PING = JSON.stringify({ zen: 'test' });
const PULL_REQUEST = JSON.stringify({
  action: 'opened',
  number: 1,
  pull_request: { number: 1, head: { sha: 'head-sha' }, base: { sha: 'base-sha' } },
});

describe('webhook HMAC verification', () => {
  it('accepts the GitHub docs example (OpenSSL-computed HMAC accepted by WebCrypto)', async () => {
    const digest = createHmac('sha256', "It's a Secret to Everybody").update('Hello, World!').digest('hex');
    const res = await post('Hello, World!', {
      'X-GitHub-Event': 'ping',
      'X-GitHub-Delivery': 'hmac-vector-1',
      'X-Hub-Signature-256': `sha256=${digest}`,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 'pong' });
  });

  it('accepts a signed ping with the configured secret', async () => {
    const signature = await sign('It\'s a Secret to Everybody', PING);
    const res = await post(PING, {
      'X-GitHub-Event': 'ping',
      'X-GitHub-Delivery': 'hmac-ping-1',
      'X-Hub-Signature-256': signature,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 'pong' });
  });

  it('rejects a tampered body', async () => {
    const signature = await sign('It\'s a Secret to Everybody', PING);
    const res = await post('{"zen":"tampered"}', {
      'X-GitHub-Event': 'ping',
      'X-GitHub-Delivery': 'hmac-tampered-1',
      'X-Hub-Signature-256': signature,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a valid signature computed with a different secret', async () => {
    const signature = await sign('other-secret', PING);
    const res = await post(PING, {
      'X-GitHub-Event': 'ping',
      'X-GitHub-Delivery': 'hmac-wrong-secret-1',
      'X-Hub-Signature-256': signature,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a missing signature header', async () => {
    const res = await post(PING, {
      'X-GitHub-Event': 'ping',
      'X-GitHub-Delivery': 'hmac-missing-1',
    });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed signature header', async () => {
    const res = await post(PING, {
      'X-GitHub-Event': 'ping',
      'X-GitHub-Delivery': 'hmac-malformed-1',
      'X-Hub-Signature-256': 'md5=deadbeef',
    });
    expect(res.status).toBe(401);
  });
});

describe('webhook delivery dedupe', () => {
  it('accepts a signed pull_request and dedupes a redelivery', async () => {
    const signature = await sign('It\'s a Secret to Everybody', PULL_REQUEST);
    const headers = {
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'dedupe-1',
      'X-Hub-Signature-256': signature,
    };
    const first = await post(PULL_REQUEST, headers);
    expect(first.status).toBe(202);

    const redelivery = await post(PULL_REQUEST, headers);
    expect(redelivery.status).toBe(200);
    expect(await redelivery.json()).toEqual({ ok: 'duplicate', deliveryId: 'dedupe-1' });

    const rows = await env.DB.prepare('SELECT id FROM deliveries WHERE id = ?').bind('dedupe-1').all();
    expect(rows.results).toHaveLength(1);
  });

  it('ignores events it does not handle', async () => {
    const signature = await sign('It\'s a Secret to Everybody', PING);
    const res = await post(PING, {
      'X-GitHub-Event': 'push',
      'X-GitHub-Delivery': 'ignored-1',
      'X-Hub-Signature-256': signature,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 'ignored', event: 'push' });
  });
});
