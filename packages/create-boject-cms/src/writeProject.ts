import { chmod, copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  GITIGNORE,
  renderBojectConfig,
  renderContentTypesBundle,
  renderDockerCompose,
  renderEnvFile,
  renderMcpConfig,
  renderPackageJson,
  renderReadme,
  type StarterChoice,
} from './render.js';
import { sanitiseProjectName } from './projectName.js';
import {
  generateAdminPassword,
  generateCliApiKey,
  generateMeiliMasterKey,
  generateSessionPassword,
} from './secrets.js';

export interface WriteProjectParams {
  targetDir: string;
  starter: StarterChoice;
  imageTag: string;
  force: boolean;
  startersSourceDir: string;
  hostPort: number;
  aiAssist: boolean;
  /** Generate a CLI API key into .env.local (#510). Defaults to false. */
  cliApiKey?: boolean;
}

export interface WriteProjectResult {
  adminEmail: string;
  adminPassword: string;
  cliApiKeyCreated: boolean;
}

export async function writeProject({
  targetDir,
  starter,
  imageTag,
  force,
  startersSourceDir,
  hostPort,
  aiAssist,
  cliApiKey = false,
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
  const meiliMasterKey = generateMeiliMasterKey();
  const adminEmail = 'admin@local';
  const projectName = sanitiseProjectName(basename(targetDir));
  const cliKey = cliApiKey ? generateCliApiKey() : null;

  await writeFile(
    join(targetDir, 'docker-compose.yml'),
    renderDockerCompose({ imageTag, starter })
  );
  await writeFile(
    join(targetDir, '.env'),
    renderEnvFile({
      sessionPassword,
      adminPassword,
      meiliMasterKey,
      starter,
      hostPort,
      bootstrapApiKey: cliKey
        ? { prefix: cliKey.prefix, hash: cliKey.hash }
        : null,
    })
  );
  if (cliKey) {
    // The only place the raw key is written (#510). gitignored; the boject CLI
    // loads it. chmod explicitly: writeFile's mode only applies on create, and
    // --force may be overwriting an existing, more permissive file.
    const envLocal = join(targetDir, '.env.local');
    await writeFile(
      envLocal,
      [
        '# boject CLI API key — read automatically by @boject/cli. Keep this',
        '# file out of git; it is not passed to the CMS container.',
        `BOJECT_API_KEY=${cliKey.raw}`,
        '',
      ].join('\n'),
      { mode: 0o600 }
    );
    await chmod(envLocal, 0o600);
  }
  await writeFile(
    join(targetDir, 'package.json'),
    renderPackageJson({ name: projectName })
  );
  await writeFile(join(targetDir, '.gitignore'), GITIGNORE);
  await writeFile(
    join(targetDir, 'README.md'),
    renderReadme({
      starter,
      adminEmail,
      hostPort,
      aiAssist,
      cliApiKey: cliKey !== null,
    })
  );
  if (aiAssist) {
    await writeFile(join(targetDir, '.mcp.json'), renderMcpConfig());
  }

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
  await writeFile(
    join(targetDir, '.boject.config.json'),
    renderBojectConfig({ hostPort })
  );

  return { adminEmail, adminPassword, cliApiKeyCreated: cliKey !== null };
}
