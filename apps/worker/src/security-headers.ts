import { secureHeaders } from 'hono/secure-headers';

/**
 * Security headers for every /api response (CLAUDE.md section 11). Static assets get the same values from
 * apps/web/public/_headers; test/security-headers.test.ts fails if the two drift apart.
 * Hono's other defaults (X-Frame-Options, Cross-Origin-*-Policy, ...) stay on; X-Frame-Options matches frame-ancestors.
 */
export const securityHeaders = () =>
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      objectSrc: ["'none'"],
    },
    referrerPolicy: 'no-referrer',
    xContentTypeOptions: 'nosniff',
    strictTransportSecurity: 'max-age=63072000; includeSubDomains',
    // Hono's default too; named because _headers sets it for the pages (reverse tabnabbing) and the test compares.
    crossOriginOpenerPolicy: 'same-origin',
    xFrameOptions: 'DENY',
  });
