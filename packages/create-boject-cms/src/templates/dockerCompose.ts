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
      - meilisearch
      - redis
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

  meilisearch:
    image: getmeili/meilisearch:v1.45.2
    restart: unless-stopped
    environment:
      # Production mode: all routes require the master key. The CMS reads the
      # same key from .env (MEILI_MASTER_KEY). Compose interpolates it here.
      MEILI_ENV: production
      MEILI_MASTER_KEY: \${MEILI_MASTER_KEY}
      MEILI_NO_ANALYTICS: 'true'
    volumes:
      # The search index must survive restarts, else search is empty until a
      # manual \`pnpm search:reindex\`.
      - meilidata:/meili_data

  redis:
    image: redis:7.4-alpine
    restart: unless-stopped
    # Cache only — no persistence, no volume. Restarts cold by design
    # (repopulates from Postgres).
    command: redis-server --save "" --appendonly no

volumes:
  pgdata:
  storage:
  meilidata:
`;
}
