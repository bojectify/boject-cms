SELECT 'CREATE DATABASE boject_perf'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'boject_perf')\gexec
