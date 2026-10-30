// Runs the Entra stand-in as a process for the browser tests. Test use only: it is not Microsoft and it is steerable over HTTP.
import { FakeEntra } from './fake-entra.ts';

const port = Number(process.env.FAKE_ENTRA_PORT ?? 3107);
const fake = new FakeEntra(`http://127.0.0.1:${port}`);
await fake.listen(port);
console.log(`fake Entra listening on http://127.0.0.1:${port}`);
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    fake.close();
    process.exit(0);
  });
}
