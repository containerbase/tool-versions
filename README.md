# containerbase tool versions

Lists the versions containerbase's `install-tool` can install, one file per tool, published on GitHub Pages.
A scheduled workflow fetches them daily from the same upstream sources the containerbase CLI uses, so the generated files are never committed.

## Files

- `https://containerbase.github.io/tool-versions/<tool>.json`: the versions of one tool, e.g. [`node.json`](https://containerbase.github.io/tool-versions/node.json)
- `https://containerbase.github.io/tool-versions/index.json`: every published tool with its file name and version count
- `https://containerbase.github.io/tool-versions/tool.schema.json` and `index.schema.json`: the JSON schemas of those files
- `<file>.sha512` next to each of these files, e.g. `node.json.sha512`: its SHA-512 digest as `<hex>  <file name>`, the format `sha512sum` prints, so a download can be verified

A tool file looks like this:

```json
{
  "tool": "node",
  "source": { "datasource": "node-version", "packageName": "node" },
  "updatedAt": "2026-10-08T03:00:00.000Z",
  "versions": [
    { "version": "25.0.0" },
    { "version": "25.0.0-rc.1", "prerelease": true },
    { "version": "24.21.0", "lts": true }
  ]
}
```

A version lists the files it can be installed from, with the download url and the checksum.
A `python` version has one file per distro and architecture:

```json
{
  "version": "3.14.8",
  "files": [
    {
      "name": "python-3.14.8-jammy-x86_64.tar.xz",
      "url": "https://github.com/containerbase/python-prebuild/releases/download/3.14.8/python-3.14.8-jammy-x86_64.tar.xz",
      "checksum": "sha512:ab12…",
      "arch": "amd64",
      "distro": "jammy"
    }
  ]
}
```

A `java` version has one file per architecture:

```json
{
  "version": "21.0.5+11.0.LTS",
  "lts": true,
  "files": [
    {
      "name": "OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.5_11.tar.gz",
      "url": "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.5_11.tar.gz",
      "checksum": "sha256:cd34…",
      "arch": "arm64"
    },
    {
      "name": "OpenJDK21U-jdk_x64_linux_hotspot_21.0.5_11.tar.gz",
      "url": "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_x64_linux_hotspot_21.0.5_11.tar.gz",
      "checksum": "sha256:ef56…",
      "arch": "amd64"
    }
  ]
}
```

- `type` is the package manager installing the tool, `gem`, `npm` or `pip`, as in [`@containerbase/base`](https://www.npmjs.com/package/@containerbase/base), e.g. `"type": "npm"` for `pnpm`.
  It is omitted for other tools.
- `versions` is sorted newest first and includes prereleases.
  Only installable versions are listed: a version needs at least one file, except for tools installed by a package manager (they have a `type`).
- `version` is in exactly the format `install-tool` accepts, e.g. `25.0.2+10.0.LTS` for `java`.
- `prerelease` and `lts` are only present when they are `true`.
- `files` lists the download files of the version, sorted by `name`. It is only present when files are known.
  - `url` is the direct https download url.
  - `checksum` is `sha256:<hex>` or `sha512:<hex>` in lowercase.
  - `arch` is `amd64` or `arm64`, as `install-tool` names them. It is left out for files which work on every architecture.
  - `distro` is the distro of a distro specific file, like `jammy`. It is left out otherwise.

## Tools

| Tool     | Datasource        | Package                                | Files                                                                              |
| -------- | ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `helm`   | `github-releases` | `helm/helm`                            | `linux-amd64` and `linux-arm64` archives on get.helm.sh, sha256 from `.sha256sum`  |
| `java`   | `java-version`    | `java-jdk` (Adoptium, x64/aarch64, GA) | the Adoptium linux packages, sha256 from the Adoptium assets api                   |
| `node`   | `node-version`    | `node` (nodejs.org)                    | the `linux-x64` and `linux-arm64` `.tar.xz` archives, sha256 from `SHASUMS256.txt` |
| `pnpm`   | `npm`             | `pnpm`                                 | none                                                                               |
| `poetry` | `pypi`            | `poetry`                               | none                                                                               |
| `python` | `github-releases` | `containerbase/python-prebuild`        | the release assets with a `.sha512` file, sha512 from it                           |

To add a tool, map it in [`src/tools.ts`](./src/tools.ts).
A tool whose release assets aren't the files to install lists them in `toolFiles` there.
The `python` prebuilds of the distros `bionic` and `focal` are skipped, containerbase no longer supports them.
Tools installed through npm, pip or gem have no files, whatever their datasource: the package manager installs and verifies them together with their dependencies.
They are the tools with the `type` `npm`, `pip` or `gem` in `@containerbase/base`.
It must exist in the `tools.json` of [`@containerbase/base`](https://www.npmjs.com/package/@containerbase/base), else the build fails.
A new kind of source needs a fetcher in [`src/datasources`](./src/datasources).
Add its maintained release lines to [`renovate.Dockerfile`](./renovate.Dockerfile) too.

## Updates

Each build starts from the published files:

- **Incremental:** the versions of the previous file are merged with the fresh ones, so a version that disappears upstream stays listed.
  Where a version is in both, the fresh flags win.
  Paged sources (`github-releases`, `java-version`) list the newest versions first and stop paging after the first page with a known version.
  The files of the previous file are reused by `name` and never fetched again; only files which are missing get their checksum fetched, so files uploaded after an earlier build are filled in later.
  The first build after the `files` were introduced fetches them for every version.
  A version counts as known for paging whether or not it has files, so older versions on pages that are no longer fetched are only filled by a full refresh.
  A file whose checksum is missing upstream (404) is left out silently; any other failed fetch skips the file with a warning, and the next build tries again.
  A `java` version without a file for an architecture requests its feature release again on every build, as the file may be published later.
- **Fallback:** when fetching a tool fails, its previous file is published again with its old `updatedAt`, so you can see it is stale, and the build logs a warning.
  The build only fails for a tool that has neither fresh nor previous versions, and then nothing is deployed.
- **Full refresh:** run the `pages` workflow manually with the `full` input to skip the previous files and fetch every version again.
- **Release trigger:** [`renovate.Dockerfile`](./renovate.Dockerfile) lists the maintained release lines of each tool.
  There is one line per major, and Renovate updates it on a minor or patch release; Python has one line per minor, updated on patch releases.
  The automerged update on `main` publishes the new version right away.
  New lines are picked up by the nightly run; add them to the file when they are released.

A missing, unreadable or invalid previous file counts as no previous file, as does a file of another source.

## Development

Node.js, pnpm and jactionlint are pinned in [`mise.toml`](./mise.toml), so [`mise`](https://mise.jdx.dev) installs them and the dependencies with `mise install`.
Without mise, install the dependencies with `pnpm install`.

```bash
mise install
pnpm lint
pnpm test
jactionlint
```

- `pnpm lint-fix` fixes the formatting and the fixable lint findings.
- `jactionlint` checks the GitHub workflows.

`pnpm build` fetches all tools and writes the files to `dist/`, `pnpm build --full` skips the previous files.

- `GITHUB_TOKEN` makes authenticated GitHub API requests, which avoids the rate limit.
- `TOOL_VERSIONS_URL` sets where the previous files are downloaded from, by default `https://containerbase.github.io/tool-versions`.
