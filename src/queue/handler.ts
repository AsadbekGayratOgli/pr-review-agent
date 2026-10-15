import type { ExportedHandler, ExecutionContext, MessageBatch } from '@cloudflare/workers-types';
import { queueMessageSchema } from './messages';

async function dispatch(body: unknown): Promise<void> {
  const parsed = queueMessageSchema.safeParse(body);
  if (!parsed.success) {
    console.warn('queue: unparseable message', JSON.stringify(parsed.error.issues).slice(0, 300));
    return;
  }
  const message = parsed.data;
  switch (message.t) {
    case 'noop':
      console.log('queue: noop message accepted', message.deliveryId ?? 'unknown');
      break;
    case 'plan':
      console.log('queue: plan step placeholder', message.deliveryId);
      break;
    case 'chunk':
      console.log('queue: chunk step placeholder', message.deliveryId, message.chunkId);
      break;
    case 'publish':
      console.log('queue: publish step placeholder', message.deliveryId);
      break;
  }
}

const handler = {
  async queue(batch: MessageBatch<unknown>, _env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        await dispatch(message.body);
        message.ack();
      } catch (error) {
        console.error('queue: handler failed, letting the queue retry', error);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;

export default handler;
