import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library auto-cleanup only hooks in when vitest `globals: true`; globals stay off.
afterEach(() => {
  cleanup();
});
