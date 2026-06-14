// Node 18 does not reliably expose the Web Crypto API as a global `crypto`.
// Mastra's workflow execution engine calls a bare `crypto.randomUUID()`
// (EventEmitterPubSub.publish), which throws `ReferenceError: crypto is not
// defined` on Node 18. Install the global from node:crypto if it's missing.
// Safe no-op on Node >= 20 where the global already exists.
import { webcrypto } from "node:crypto";

if (!(globalThis as { crypto?: Crypto }).crypto) {
  (globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto;
}
