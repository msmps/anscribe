# Changesets

This repo uses [changesets](https://github.com/changesets/changesets) to manage versioning and changelogs for the published `@anscribe/*` packages.

Development still uses Bun (`bun install`, `bun run --filter ...`). The publish pipeline uses pnpm because pnpm rewrites `workspace:*` ranges to concrete versions at publish time, which Bun's publish flow does not yet do in a changesets-friendly way.

## Workflow

1. Make changes on a branch. When you do something a consumer would care about, add a changeset:

   ```bash
   pnpm changeset
   ```

   Pick the packages that changed, the bump type (patch/minor/major), and write a short summary. This creates a markdown file under `.changeset/`. Commit it with your change.

2. When you want to cut a release, run:

   ```bash
   pnpm changeset version
   ```

   This consumes pending changeset files, bumps `package.json` versions, rewrites internal `workspace:*` dependents, and updates each package's `CHANGELOG.md`. Commit the result.

3. To publish, build everything first then run:

   ```bash
   pnpm -r build
   pnpm changeset publish
   ```

   `changeset publish` publishes only packages whose version in `package.json` is newer than the registry. Scoped packages publish as public because `access: "public"` is set in `config.json`.

Internal dependencies (e.g. `@anscribe/opentui` depending on `@anscribe/core`) are bumped automatically via `updateInternalDependencies: "patch"`.

The `example-*` workspaces are listed under `ignore` so changesets never tries to version or publish them.
