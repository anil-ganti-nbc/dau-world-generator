import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Extension fallback for TypeScript ESM: lets this repo and the sibling
 * dau-practice-labs contract (which uses extensionless relative imports)
 * load under node:test.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (extname(specifier)) throw err;
    const base = specifier.startsWith("file:")
      ? fileURLToPath(specifier)
      : specifier.startsWith("./") || specifier.startsWith("../")
        ? join(dirname(fileURLToPath(context.parentURL)), specifier)
        : null;
    if (!base) throw err;
    for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
    throw err;
  }
}
