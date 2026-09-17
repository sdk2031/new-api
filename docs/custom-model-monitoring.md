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

Push the merged branch to trigger the GitHub Actions image build:

```powershell
git push origin codex/model-monitoring
```

If Git reports a conflict, resolve it on the customization branch and commit
the merge. The isolated files normally require no manual changes; the sidebar
integration is the most likely place to need a small adjustment after a major
upstream navigation refactor.

## Deploy the custom build

The official `calciumion/new-api:latest` image does not contain this page. The
custom branch publishes `ghcr.io/sdk2031/new-api-custom:latest` through GitHub
Actions. Deploy it through the Compose override without building on the server:

```powershell
docker compose -f docker-compose.yml -f docker-compose.custom.yml pull new-api
docker compose -f docker-compose.yml -f docker-compose.custom.yml up -d new-api
```

This override leaves the upstream `docker-compose.yml` unchanged while forcing
the `new-api` service to use the GHCR image built from the customization branch.
