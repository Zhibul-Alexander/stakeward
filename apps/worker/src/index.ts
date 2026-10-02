import { createApp } from './app.ts';

export const app = createApp();

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
