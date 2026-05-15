# Host shims for containerised pnpm/pnpx

These two scripts route every `pnpm` and `pnpx` invocation into the
project's `dev` docker-compose service. Install them once per machine,
they work for every boject repo that has a `dev` service.

## Install

```sh
mkdir -p ~/.local/bin
cp pnpm pnpx ~/.local/bin/
chmod +x ~/.local/bin/pnpm ~/.local/bin/pnpx
```

Add to `~/.zshenv`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Restart your shell. `which pnpm` should now resolve to
`~/.local/bin/pnpm`, and any `pnpm`/`pnpx` invocation inside a project
that has `dev:` in its `docker-compose.yml` routes through the container.

For projects without a `dev` service, the shim falls through to the
next `pnpm`/`pnpx` on PATH, so installing them doesn't break
non-containerised work.

See `docs/superpowers/specs/2026-05-14-dev-container-design.md` in the
internal repo for the design rationale.
