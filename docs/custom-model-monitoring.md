# Custom model monitoring

The model monitoring page is a local customization available at `/monitoring`.
It reuses the standard pricing and performance-summary APIs, so it does not add
database tables or backend endpoints.

## Isolation

Most customization code is isolated in these paths:

- `web/src/features/model-monitoring/`
- `web/src/routes/_authenticated/monitoring/`
- `web/src/custom/navigation.ts`
- `docker-compose.custom.yml`

The only handwritten upstream integration point is the small import and spread
in `web/src/hooks/use-sidebar-data.ts`. `web/src/routeTree.gen.ts` is generated
by TanStack Router from the standalone route file.

## Update from upstream

Keep this work on the `codex/model-monitoring` branch and merge upstream into
it. Do not use `git reset --hard origin/main`, because that intentionally drops
all local commits.

From a clean worktree:

```powershell
git switch codex/model-monitoring
.\scripts\update-with-customizations.ps1
```

To merge upstream and immediately rebuild the custom image:

```powershell
.\scripts\update-with-customizations.ps1 -Build
```

If Git reports a conflict, resolve it on the customization branch and commit
the merge. The isolated files normally require no manual changes; the sidebar
integration is the most likely place to need a small adjustment after a major
upstream navigation refactor.

## Deploy the custom build

The official `calciumion/new-api:latest` image does not contain this page. Build
and deploy the local image through the Compose override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.custom.yml up -d --build
```

This override leaves the upstream `docker-compose.yml` unchanged while forcing
the `new-api` service to use `my-new-api:latest` built from this checkout.
