// Registers TypeScript for node:test runs, mirroring the labs' tier-2 tooling.
import { register } from "node:module";

register(new URL("./ts-hooks.mjs", import.meta.url));
