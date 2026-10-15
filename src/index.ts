import { Hono } from 'hono';
import { QuotaLedger } from './durable-objects/quota-ledger';
import { ReviewRun } from './durable-objects/review-run';
import webhook from './webhook';
import queueHandler from './queue/handler';

export { QuotaLedger, ReviewRun };

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.text('ok', 200));
app.route('/webhook', webhook);

export default {
  fetch: app.fetch,
  ...queueHandler,
};
