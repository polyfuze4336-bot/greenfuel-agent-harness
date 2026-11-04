// Runs once when the server starts. The first request after a start rebuilds the whole read model from the repository, which took 14 s on
// a Windows laptop, so it is done here, in the background, before anyone asks. A failure is ignored: the first request then does the work
// exactly as before. STUDIO_WARM=0 turns it off.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.STUDIO_WARM === '0') return;
  setTimeout(() => {
    void (async () => {
      try {
        const { getNextView } = await import('./lib/next/server.ts');
        await getNextView(null);
      } catch {
        /* the repository may be unreadable, or sign-in may be required to read it */
      }
    })();
  }, 300).unref();
}
