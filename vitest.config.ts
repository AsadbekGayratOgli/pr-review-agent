import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
          environment: 'dev',
        },
        miniflare: {
          bindings: {
            GITHUB_WEBHOOK_SECRET: "It's a Secret to Everybody",
          },
        },
      },
    },
  },
});
