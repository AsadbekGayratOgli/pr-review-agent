import { z } from 'zod';

export const queueMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('noop'),
    deliveryId: z.string().optional(),
    action: z.string().optional(),
    pr: z.number().optional(),
  }),
  z.object({ t: z.literal('plan'), deliveryId: z.string() }),
  z.object({ t: z.literal('chunk'), deliveryId: z.string(), chunkId: z.string() }),
  z.object({ t: z.literal('publish'), deliveryId: z.string() }),
]);

export type QueueMessage = z.infer<typeof queueMessageSchema>;
