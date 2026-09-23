import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const result = dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

if (result.error && result.error.code !== "ENOENT") {
  throw result.error;
}
