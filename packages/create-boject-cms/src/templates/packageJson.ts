export interface PackageJsonParams {
  name: string;
}

export function renderPackageJson({ name }: PackageJsonParams): string {
  const pkg = {
    name,
    version: '0.1.0',
    private: true,
    scripts: {
      start: 'docker compose up -d',
      stop: 'docker compose down',
      logs: 'docker compose logs -f cms',
      upgrade: 'npx @boject/cli@latest upgrade',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}
