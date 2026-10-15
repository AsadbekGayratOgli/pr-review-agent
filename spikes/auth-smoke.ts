import { readFileSync } from 'node:fs';

const APP_ID = process.env.GITHUB_APP_ID;
const KEY_FILE = process.env.GITHUB_APP_PRIVATE_KEY_FILE;
const KEY_INLINE = process.env.GITHUB_APP_PRIVATE_KEY;
const TEST_REPO = process.env.GITHUB_TEST_REPO;
const TEST_PR = process.env.GITHUB_TEST_PR;

if (!APP_ID || (!KEY_FILE && !KEY_INLINE)) {
  console.error('ERROR: set GITHUB_APP_ID and either GITHUB_APP_PRIVATE_KEY_FILE (path to PKCS#8 PEM) or GITHUB_APP_PRIVATE_KEY (PEM contents)');
  process.exit(1);
}

const GITHUB_API = 'https://api.github.com';
const apiHeaders = (token?: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token ?? ''}`,
  'X-GitHub-Api-Version': '2022-11-28',
});

function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  return Uint8Array.from(Buffer.from(body, 'base64'));
}

async function createAppJwt(): Promise<string> {
  const pem = KEY_FILE ? readFileSync(KEY_FILE, 'utf8') : (KEY_INLINE as string);
  const der = pemToDer(pem);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({ iat: now - 30, exp: now + 540, iss: APP_ID })),
  );
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(signature)}`;
}

async function apiJson(path: string, token: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...apiHeaders(token), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function fail(step: string, status: number, body: unknown): never {
  console.error(`FAIL at ${step}: HTTP ${status}`);
  console.error(JSON.stringify(body).slice(0, 500));
  process.exit(1);
}

const step = (name: string) => console.log(`-> ${name}`);

const jwt = await createAppJwt();
step('JWT signed with PKCS#8 key (RS256)');

const installations = await apiJson('/app/installations', jwt);
if (installations.status !== 200) fail('GET /app/installations', installations.status, installations.body);
const list = installations.body as Array<{ id: number; account?: { login?: string } }>;
if (!list.length) {
  console.error('FAIL: App has no installations. Install it on a repo first.');
  process.exit(1);
}
const installation = list[0];
console.log(`   installation id=${installation.id} account=${installation.account?.login ?? '?'}`);

const tokenRes = await apiJson(`/app/installations/${installation.id}/access_tokens`, jwt, { method: 'POST' });
if (tokenRes.status !== 201) fail('POST access_tokens', tokenRes.status, tokenRes.body);
const installationToken = (tokenRes.body as { token: string }).token;
console.log('   installation token obtained');

if (!TEST_REPO || !TEST_PR) {
  console.log('SMOKE TEST OK (set GITHUB_TEST_REPO and GITHUB_TEST_PR to also fetch PR files)');
  process.exit(0);
}

const [owner, repo] = TEST_REPO.split('/');
const filesRes = await apiJson(`/repos/${owner}/${repo}/pulls/${TEST_PR}/files?per_page=100`, installationToken);
if (filesRes.status !== 200) fail('GET PR files', filesRes.status, filesRes.body);
const files = filesRes.body as Array<{ filename: string; changes: number }>;
console.log(`   PR ${TEST_REPO}#${TEST_PR}: ${files.length} files`);
for (const f of files.slice(0, 10)) console.log(`     ${f.filename} (+${f.changes})`);
if (files.length > 10) console.log(`     ... ${files.length - 10} more`);

console.log('SMOKE TEST OK');
