import { Hono } from 'hono';
import { QuotaLedger } from './durable-objects/quota-ledger';
import { ReviewRun } from './durable-objects/review-run';
import webhook from './webhook';

export { QuotaLedger, ReviewRun };

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.text('ok', 200));
app.route('/webhook', webhook);

app.post('/webhook', (c) => c.body(null, 202));

export default {
  fetch: app.fetch,
  async queue(): Promise<void> {},
};
