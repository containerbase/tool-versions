# Agent instructions

Guidance for coding agents working in this repository.

## Git workflow

Pull requests land through a GitHub merge queue, which tests them against the
current `main` before merging.
A pull request therefore doesn't need to be up to date with `main`, so only
merge `main` in when something actually needs it, like resolving a conflict or
picking up a change the branch depends on:

```bash
git fetch origin
git merge origin/main
```

The merge queue also sets the merge strategy, so don't pass one when merging:
enable auto merge with `gh pr merge <number> --auto`, without `--squash`,
`--merge` or `--rebase`.

Do not rebase a pushed branch onto `main` and force-push it.
A force push rewrites history that reviewers and CI have already seen.

Stacked pull requests managed with `gh stack` are the exception: keep one
commit per layer, update the stack with `gh stack rebase` once a layer below
is merged or `main` is needed, and force-push it with `gh stack push`.

## Commands

All tooling runs through `pnpm`:

- `mise install`: install Node.js, pnpm and jactionlint
- `pnpm install --frozen-lockfile`: install dependencies
- `pnpm lint`: check formatting (oxfmt), lint (oxlint) and types (tsc)
- `pnpm lint-fix`: fix formatting and lint findings
- `pnpm test`: run the unit tests
- `pnpm build`: build the files into `dist/`, starting empty. `--previous-archive <folder>` starts from the extracted archive of a release (see the README for downloading one into the ignored `tmp/`), `--full` ignores the previous state
- `pnpm pack:release`: pack the release archive from `dist/` into `dist-release/`
- `pnpm release-notes`: write the notes of a release from two extracted archives

`jactionlint` lints the GitHub workflows and local actions.

The specs mock all requests with nock, so they need no network. Don't run
`pnpm build` in a check, it fetches the upstream sources.

## Docs

The docs describe what the code does, so update the matching file in the same
pull request:

- the published files, fields or schemas: [`docs/format.md`](./docs/format.md).
  A breaking change needs a new format folder, see its versioning policy.
- a new datasource, source kind or computed checksum behaviour:
  [`docs/sources.md`](./docs/sources.md)
- build, update or release trigger behaviour: [`docs/build.md`](./docs/build.md)
- commands: [`README.md`](./README.md) and this file

Never list tool names in the docs, [`src/tools.ts`](./src/tools.ts) is the list.
Give one example tool per kind of source instead.

## Commits and releases

Use conventional commit subjects, they decide the release version after each
change of the data or the code:

- `feat` is a minor release, anything else a patch release.
- A breaking change (`type!:`) blocks the release job, the site is still
  deployed. The major version is the data format major and only changes with a
  new format folder, see the versioning policy in
  [`docs/format.md`](./docs/format.md). Release it with the new format major,
  which starts at `<major>.0.0`.

## Code

- Add a doc comment to every function you add or change.
- Keep small test fixtures inline in the specs.
