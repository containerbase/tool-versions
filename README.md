# containerbase tool versions

The versions containerbase's `install-tool` can install, one JSON file per tool on GitHub Pages, with the download url and checksum of each file.
A workflow builds them nightly from the upstream sources the containerbase CLI uses.

## Files

- [`<tool>.json`](https://containerbase.github.io/tool-versions/node.json): the versions of one tool
- [`index.json`](https://containerbase.github.io/tool-versions/index.json): all tools with their file and version count
- `tool.schema.json`, `index.schema.json`: the JSON schemas
- `<file>.sha512` next to each file, in `sha512sum` format

```json
{
  "tool": "python",
  "sourceUrl": "https://github.com/python/cpython",
  "homepage": "https://www.python.org",
  "source": {
    "datasource": "github-releases",
    "packageName": "containerbase/python-prebuild",
    "versioning": "python"
  },
  "updatedAt": "2026-10-08T03:00:00.000Z",
  "versions": [
    {
      "version": "3.14.8",
      "releaseTimestamp": "2026-10-02T01:30:20.000Z",
      "files": [
        {
          "name": "python-3.14.8-jammy-x86_64.tar.xz",
          "url": "https://github.com/containerbase/python-prebuild/releases/download/3.14.8/python-3.14.8-jammy-x86_64.tar.xz",
          "checksum": "sha512:6976…",
          "arch": "amd64",
          "distro": "jammy"
        }
      ]
    }
  ]
}
```

- `source`: the datasource, package and [Renovate versioning](https://docs.renovatebot.com/modules/versioning/) of the versions.
- `type`: the package manager installing the tool (`gem`, `npm` or `pip`, from [`@containerbase/base`](https://www.npmjs.com/package/@containerbase/base)). These tools have no files, the package manager installs and verifies them.
- `sourceUrl`, `homepage`: links for Renovate's changelogs.
- `versions`: newest first, including prereleases, only installable ones (with at least one file, unless the tool has a `type`). `version` is the exact `install-tool` version.
- `prerelease`, `lts`: only present when `true`.
- `releaseTimestamp`: the release time in UTC, for Renovate's `minimumReleaseAge`.
- `files`: sorted by name, each with the https `url`, `checksum` (`sha256:` or `sha512:` lowercase hex), and `arch` (`amd64`/`arm64`) and `distro` where they apply.

Optional fields are omitted when unknown.

## Tools

The tools and their sources are mapped in [`src/tools.ts`](./src/tools.ts), each must exist in `@containerbase/base`.

| Tool     | Versions                                        | Files                                                             |
| -------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `helm`   | GitHub releases `helm/helm`                     | get.helm.sh archives, sha256 from `.sha256sum` (older: `.sha256`) |
| `java`   | Adoptium, JDK, GA                               | Adoptium linux packages, sha256 from the assets api               |
| `node`   | nodejs.org                                      | `.tar.xz` archives, sha256 from `SHASUMS256.txt`                  |
| `python` | GitHub releases `containerbase/python-prebuild` | prebuilds with a `.sha512` file, without `bionic` and `focal`     |

The package manager tools (`bundler`, `checkov`, `copier`, `corepack`, `hashin`, `kas`, `npm`, `pdm`, `pip-tools`, `pipenv`, `pnpm`, `poetry`, `uv`) come from npm, pypi or rubygems without files; the deprecated `bower` and `lerna` aren't published.

## Updates

- **Incremental:** each build starts from the published files. Known versions, files and release times are reused, only missing ones are fetched, and versions gone upstream stay listed. Paged sources stop at the first known version, so older gaps are filled by a full refresh.
- **Failures:** a missing checksum (404) skips the file, other errors warn and the next build retries. A tool whose fetch fails republishes its previous file with the old `updatedAt`; the build only fails for a tool without any versions.
- **Full refresh:** run the `pages` workflow with the `full` input.
- **Release trigger:** Renovate updates [`renovate.Dockerfile`](./renovate.Dockerfile), one line per maintained major (per minor for python), and the automerged update publishes a release right away. Add new lines when they are released.

## Development

`mise install` installs Node.js, pnpm, jactionlint and the dependencies (or `pnpm install` without [mise](https://mise.jdx.dev)).

```bash
pnpm lint         # pnpm lint-fix to fix
pnpm test
jactionlint       # the GitHub workflows
pnpm build        # writes dist/, --full skips the previous files
```

`GITHUB_TOKEN` avoids the GitHub rate limit, `TOOL_VERSIONS_URL` overrides where the previous files come from.
