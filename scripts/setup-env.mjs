import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const source = join(projectRoot, "env");
const destination = join(projectRoot, "public", "env");

mkdirSync(destination, { recursive: true });

for (const entry of readdirSync(source)) {
  const sourcePath = join(source, entry);
  const destinationPath = join(destination, entry);

  if (!existsSync(destinationPath)) {
    cpSync(sourcePath, destinationPath, { recursive: true });
  }
}
