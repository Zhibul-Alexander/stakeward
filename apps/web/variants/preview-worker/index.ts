// Preview Worker for a UI variant (uiN.stakeward.com): serves that variant's built site and hands /api/* to the
// devnet Worker (stakeward-dev) through a service binding, so the page talks to its own origin (CSP connect-src 'self')
// and the dev Worker sees the visitor's request unchanged.
type Env = { DEV: { fetch: (request: Request) => Promise<Response> } };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.DEV.fetch(request);
  },
};
