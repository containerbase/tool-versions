import { vi } from 'vitest';

// retries in the specs don't wait
vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve() }));
