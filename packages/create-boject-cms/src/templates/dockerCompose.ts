import type { StarterChoice } from './envFile.js';

export interface DockerComposeParams {
  imageTag: string;
  starter: StarterChoice;
}

export function renderDockerCompose({
  imageTag,
  starter,
}: DockerComposeParams): string {
  const starterMount =
    starter === 'none' ? '' : `      - ./starters:/starters:ro\n`;

  return `services:
  cms:
    image: ${imageTag}
    restart: unless-stopped
    ports:
      # Host port comes from BOJECT_HOST_PORT in .env (default 4000). Change it
      # there to run several projects side by side or dodge a port clash.
      - '\${BOJECT_HOST_PORT:-4000}:3000'
    env_file:
      - .env
    depends_on:
      - db
    volumes:
      - storage:/app/storage
      - ./content-types:/app/content-types:ro
${starterMount}  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: boject
      POSTGRES_PASSWORD: boject
      POSTGRES_DB: boject
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
  storage:
`;
}
