import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BUNDLED_SKILLS_DIR = fileURLToPath(new URL('./default-skills/', import.meta.url));
const DEFAULTS_MANIFEST = '.defaults.json';

type DefaultsManifest = { seeded: string[] };

function readManifest(path: string): DefaultsManifest {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { seeded?: unknown };
    return {
      seeded: Array.isArray(parsed.seeded)
        ? parsed.seeded.filter((name): name is string => typeof name === 'string')
        : [],
    };
  } catch {
    return { seeded: [] };
  }
}

export function seedDefaultSkills(
  destinationDirectory: string,
  bundledDirectory = DEFAULT_BUNDLED_SKILLS_DIR,
): void {
  mkdirSync(destinationDirectory, { recursive: true });
  const manifestPath = resolve(destinationDirectory, DEFAULTS_MANIFEST);
  const manifest = readManifest(manifestPath);
  const seeded = new Set(manifest.seeded);

  if (existsSync(bundledDirectory)) {
    for (const entry of readdirSync(bundledDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const source = resolve(bundledDirectory, entry.name, 'SKILL.md');
      if (!existsSync(source)) continue;

      const destination = resolve(destinationDirectory, entry.name, 'SKILL.md');
      if (existsSync(destination)) {
        seeded.add(entry.name);
        continue;
      }
      if (seeded.has(entry.name)) continue;

      mkdirSync(resolve(destinationDirectory, entry.name), { recursive: true });
      copyFileSync(source, destination);
      seeded.add(entry.name);
    }
  }

  writeFileSync(manifestPath, `${JSON.stringify({ seeded: [...seeded].sort() }, null, 2)}\n`);
}
