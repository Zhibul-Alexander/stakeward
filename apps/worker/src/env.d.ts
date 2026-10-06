// Bindings that `wrangler types` cannot know: optional secrets are not listed in secrets.required (wrangler.jsonc).
interface Env {
  /** Optional second RPC URL for reads when RPC_URL fails. May contain an API key: never log it. */
  RPC_FALLBACK_URL?: string;
  /**
   * Optional RPC URL for the monitor alone. It protects the alerts' quota only when it comes from another Helius account
   * or project (or another provider): keys of one Helius project share its credits and requests per second. May
   * contain an API key: never log it.
   */
  MONITOR_RPC_URL?: string;
}

declare namespace Cloudflare {
  interface Env {
    RPC_FALLBACK_URL?: string;
    MONITOR_RPC_URL?: string;
  }
}
