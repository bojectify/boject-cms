import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  GITIGNORE,
  renderBojectConfig,
  renderContentTypesBundle,
  renderDockerCompose,
  renderEnvFile,
  renderPackageJson,
  renderReadme,
  type StarterChoice,
} from './render.js';
import { sanitiseProjectName } from './projectName.js';
import { generateAdminPassword, generateSessionPassword } from './secrets.js';

export interface WriteProjectParams {
  targetDir: string;
  starter: StarterChoice;
  imageTag: string;
  force: boolean;
  startersSourceDir: string;
  hostPort: number;
}

export interface WriteProjectResult {
  adminEmail: string;
  adminPassword: string;
}

export async function writeProject({
  targetDir,
  starter,
  imageTag,
  force,
  startersSourceDir,
  hostPort,
}: WriteProjectParams): Promise<WriteProjectResult> {
  await mkdir(targetDir, { recursive: true });
  const existing = await readdir(targetDir);
  if (existing.length > 0 && !force) {
    throw new Error(
      `Target directory "${targetDir}" is not empty. Pass --force to scaffold anyway.`
    );
  }

  const sessionPassword = generateSessionPassword();
  const adminPassword = generateAdminPassword();
  const adminEmail = 'admin@local';
  const projectName = sanitiseProjectName(basename(targetDir));

  await writeFile(
    join(targetDir, 'docker-compose.yml'),
    renderDockerCompose({ imageTag, starter })
  );
  await writeFile(
    join(targetDir, '.env'),
    renderEnvFile({ sessionPassword, adminPassword, starter, hostPort })
  );
  await writeFile(
    join(targetDir, 'package.json'),
    renderPackageJson({ name: projectName })
  );
  await writeFile(join(targetDir, '.gitignore'), GITIGNORE);
  await writeFile(
    join(targetDir, 'README.md'),
    renderReadme({ starter, adminEmail, hostPort })
  );

  if (starter !== 'none') {
    const startersTarget = join(targetDir, 'starters');
    await mkdir(startersTarget, { recursive: true });
    const source = join(startersSourceDir, `${starter}.boject.json`);
    const dest = join(startersTarget, `${starter}.boject.json`);
    await copyFile(source, dest);
  }

  // Always create content-types/ for BOJECT_SCHEMA_DIR (Spec 4).
  const contentTypesTarget = join(targetDir, 'content-types');
  await mkdir(contentTypesTarget, { recursive: true });
  const bundleResult = renderContentTypesBundle({ starter });
  if (bundleResult.kind === 'content') {
    await writeFile(
      join(contentTypesTarget, 'schema.boject.json'),
      bundleResult.content
    );
  } else {
    await copyFile(
      join(startersSourceDir, bundleResult.sourceFilename),
      join(contentTypesTarget, 'schema.boject.json')
    );
  }

  // Always write .boject.config.json so the @boject/cli commands work
  // out of the box from the project root.
  await writeFile(join(targetDir, '.boject.config.json'), renderBojectConfig());

  return { adminEmail, adminPassword };
}
