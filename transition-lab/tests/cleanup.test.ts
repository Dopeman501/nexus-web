import { expect, it } from 'vitest';
import { settleCleanup } from '../cleanup';

it('turns synchronous and asynchronous cleanup failures into feedback for the current UI generation', async () => {
  expect(await settleCleanup(async () => {})).toBe('');
  expect(await settleCleanup(() => { throw new Error('renderer flush failed'); })).toBe('renderer flush failed');
  expect(await settleCleanup(async () => { throw new Error('late release failed'); })).toBe('late release failed');
  expect(await settleCleanup(async () => { throw null; })).toBe('Sample cleanup failed');
});
