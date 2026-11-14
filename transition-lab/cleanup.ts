/** Cleanup rejection must remain visible without escaping a discarded UI promise. */
export async function settleCleanup(cleanup: () => Promise<void>): Promise<string> {
  try { await cleanup(); return ''; }
  catch (error) { return error instanceof Error ? error.message : 'Sample cleanup failed'; }
}
