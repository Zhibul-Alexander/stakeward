// Bindings that `wrangler types` cannot know: optional secrets are not listed in secrets.required (wrangler.jsonc).
interface Env {
  /** Optional second RPC URL for reads when RPC_URL fails. May contain an API key: never log it. */
  RPC_FALLBACK_URL?: string;
  /** Optional RPC URL for the monitor alone (its own API key and quota). May contain an API key: never log it. */
  MONITOR_RPC_URL?: string;
}

declare namespace Cloudflare {
  interface Env {
    RPC_FALLBACK_URL?: string;
    MONITOR_RPC_URL?: string;
  }
}
