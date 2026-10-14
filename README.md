# containerbase tool versions

The versions containerbase's `install-tool` can install, one JSON file per tool on GitHub Pages, with the download url and checksum of each file.
A workflow builds them nightly from the upstream sources the containerbase CLI uses.

## Files

The site has a root [`index.json`](https://containerbase.github.io/tool-versions/index.json) which lists the published formats, `{ "formats": [{ "version": 1, "path": "v1/", "status": "current" }] }`, and its JSON schema `formats.schema.json`. The `status` is `current`, `preview` or `deprecated`, a deprecated format may have a `removalDate`. Everything else is published in the folder of a format, `v1/` for now. A consumer pins a major version of the format and only reads the root index to warn when its major is deprecated.

Every JSON file has the url of its JSON schema as the first property, `$schema`, so editors and tools can validate it, and the format of a file is known without a version field. The `$schema` is part of the bytes the integrity digests cover.

The files of a tool are split, as the full ones are too big to fetch for each use. The paths are relative to `https://containerbase.github.io/tool-versions/v1/`:

- [`<tool>.json`](https://containerbase.github.io/tool-versions/v1/node.json): the versions of one tool, without their `files`. Renovate's datasource and the containerbase CLI's version resolution read it.
- `<tool>/<version>.json`: the `files` of one version, `{ tool, version, files }`, for every version which has files, so not for the package manager tools. The containerbase CLI reads it to install. The file name is the raw version, so `java/25.0.4+101.0.LTS.json` has a literal `+`: request it url encoded (`%2B`), GitHub Pages decodes the path. Versions which contain other characters than `[0-9A-Za-z.+_-]` are left out with a warning.
- `<tool>.integrity.json`: the integrity of each `<tool>/<version>.json`, `{ tool, versions: { "<version>": "sha256-…" } }`, only for tools with files. The containerbase CLI reads it to verify a per-version file.
- [`index.json`](https://containerbase.github.io/tool-versions/v1/index.json): all tools with their `versionCount`, `slim` (`<tool>.json`) and, for tools with files, `versionFiles` (`<tool>.integrity.json`), each as `{ file, integrity }`, so clients don't hard-code the names.
- `<tool>.full.json`: internal, the same as `<tool>.json` with the `files` of all versions. Only the next build reads it, as the previous state to start from, so it isn't in the index; clients read the files above instead.
- `tool.schema.json` (for `<tool>.json` and `<tool>.full.json`), `version.schema.json` (for `<tool>/<version>.json`), `integrity.schema.json` (for `<tool>.integrity.json`), `index.schema.json`: the JSON schemas, referenced by the `$schema` of the files

### Versioning policy

A change which breaks consumers, like renaming or removing a field or changing its meaning, is published in a new folder, `/v2/`, and listed in the root index. `/v1/` keeps being published for a while, as `deprecated` with a `removalDate`, so consumers can migrate. Adding optional fields is not breaking.

### Examples

`<tool>.json` (the `files` are in `python/3.14.8.json` and `python.full.json`):

```json
{
  "$schema": "https://containerbase.github.io/tool-versions/v1/tool.schema.json",
  "tool": "python",
  "sourceUrl": "https://github.com/python/cpython",
  "homepage": "https://www.python.org",
  "source": {
    "datasource": "github-releases",
    "packageName": "containerbase/python-prebuild",
    "versioning": "python"
  },
  "updatedAt": "2026-10-08T03:00:00.000Z",
  "versions": [{ "version": "3.14.8", "releaseTimestamp": "2026-10-02T01:30:20.000Z" }]
}
```

`python/3.14.8.json`, and the `files` of the version in `python.full.json`:

```json
{
  "$schema": "https://containerbase.github.io/tool-versions/v1/version.schema.json",
  "tool": "python",
  "version": "3.14.8",
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
```

- `source`: the datasource, package and [Renovate versioning](https://docs.renovatebot.com/modules/versioning/) of the versions.
- `type`: the package manager installing the tool (`dotnet`, `gem`, `npm` or `pip`, from [`@containerbase/base`](https://www.npmjs.com/package/@containerbase/base)). These tools have no files, the package manager installs and verifies them.
- `sourceUrl`, `homepage`: links for Renovate's changelogs.
- `versions`: newest first, including prereleases, only installable ones (with an `amd64` file or a file for any architecture, unless the tool has a `type`; `arm64` files are added when they exist). `version` is the exact `install-tool` version.
- `prerelease`, `lts`: only present when `true`.
- `releaseTimestamp`: the release time in UTC, for Renovate's `minimumReleaseAge`.
- `files` (in the full and the per-version files only): sorted by name, each with the https `url`, `checksum` (`sha256:` or `sha512:`, `sha1:` for the android tools, lowercase hex), and `arch` (`amd64`/`arm64`) and `distro` where they apply.

Optional fields are omitted when unknown.

### Integrity

The client files form a hash chain: `index.json` has the `integrity` of each `<tool>.json` and `<tool>.integrity.json`, and `<tool>.integrity.json` the integrity of each `<tool>/<version>.json`. The digests are kept out of `<tool>.json`, so the version list stays small for Renovate and the version resolution, and only the install fetches them. An integrity is the SRI-style sha256 digest of the file's exact published bytes, like npm's `integrity` (`sha256-<base64>`). Verifying a file against its parent catches corruption, truncation, and files of different deploys mixed by a running deploy or a stale cache: on a mismatch, fetch `index.json` again and retry once.

The chain doesn't prove who published the files, `index.json` changes with every build, so it can't be pinned. Trust comes from HTTPS and GitHub Pages, like for the upstream checksums. A signature of `index.json` would add authenticity later.

## Tools

The tools and their sources are mapped in [`src/tools.ts`](./src/tools.ts), each must exist in `@containerbase/base`.

| Tool     | Versions                                        | Files                                                                                                                                       |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `helm`   | GitHub releases `helm/helm`                     | get.helm.sh archives, sha256 from `.sha256sum` (older: `.sha256`)                                                                           |
| `java`   | Adoptium, JDK, GA                               | Adoptium linux packages, sha256 from the assets api                                                                                         |
| `node`   | nodejs.org                                      | `.tar.xz` archives (sha256 from `SHASUMS256.txt`) and the `containerbase/node-prebuild` assets with a `.sha512` file, which the CLI prefers |
| `python` | GitHub releases `containerbase/python-prebuild` | prebuilds with a `.sha512` file, without `bionic` and `focal`                                                                               |

`node` lists both: the versions and the nodejs.org archives come from nodejs.org, and the prebuild files (with their `arch` and `distro`, without `bionic` and `focal`) from the releases of `containerbase/node-prebuild`, the same list the CLI looks at before it falls back to nodejs.org. The prebuild releases are read as one paged GitHub list, which stops after the first page with a version that has a prebuild file, and only versions without them fetch their `.sha512` files. When the list can't be read, the build warns and keeps the known prebuild files.

The containerbase prebuilds (`composer`, `erlang`, `flutter`, `golang`, `maven`, `mono`, `nix`, `php`, `ruby`, `skopeo`, `wally`, besides `python`) come from the releases of `containerbase/<tool>-prebuild` like `python`. Their versions are sorted with the Renovate versioning of the tool (`docker` for the four-part `erlang` versions, `maven`, `ruby`, else `semver`). Some prebuilds have no `arch` (`composer`, `maven`) and the `jammy` ones have a `distro`.

The GitHub release tools (`apko`, `apm`, `buf`, `buildx`, `bun`, `deno`, `devbox`, `docker-compose`, `elixir`, `flux`, `gh`, `git-lfs`, `gleam`, `helmfile`, `kustomize`, `mise`, `nub`, `pixi`, `powershell`, `sbt`, `sops`, `tofu`, `vendir`, `vp`) take their versions from the releases of the upstream repository, and their linux `amd64` and `arm64` files from the release assets. The checksum comes from a checksum asset of the release, either a file per asset or a list for all of them, which is downloaded once per release (see `toolFiles` in [`src/tools.ts`](./src/tools.ts)). The tags of `bun` (`bun-v`) and `kustomize` (`kustomize/v`) have a prefix, and the other tags of the `kustomize` repository are skipped. A version without any file with a checksum isn't published.

`kubectl`, `terraform` and `gradle` are downloaded from other hosts. `kubectl` takes its versions from the releases of `kubernetes/kubernetes` and the binaries and `.sha256` files from dl.k8s.io. `terraform` reads releases.hashicorp.com: the `index.json` lists the versions and the linux zips, the `SHA256SUMS` of a release the checksums. `gradle` reads `services.gradle.org/versions/all` (without snapshots, nightlies and broken releases) and the `.sha256` of each `gradle-<version>-bin.zip`.

`rust`, `dart`, `ghc` and `cabal` are downloaded from other hosts too: `rust` takes its versions from the releases of `rust-lang/rust` and the `.tar.xz` archives (`.tar.gz` before 1.19.0) and `.sha256` files from static.rust-lang.org. `dart` lists the stable release folders of the `dart-archive` bucket and reads the `.sha256sum` of each sdk zip (versions below 2 are skipped, the installer doesn't support them). `ghc` and `cabal` list the folders of downloads.haskell.org and read the `SHA256SUMS` of each release for the static `deb10` build (`linux-unknown` for cabal 3.18 and later). `java-jdk` and `java-jre` use the Adoptium source of `java`, with the jdk or jre image type. `android-sdk-cmdline-tools` reads Google's `repository2-3.xml` (a large XML, parsed with `@nodable/flexible-xml-parser` like the CLI does): the `cmdline-tools;<x>` packages are the versions, with the CLI's version format (the revision without its zero parts, so `13.0` is `13`; beta, dev and canary packages are prereleases), and the linux zip with its `sha1` is the file. The zip is the same for all architectures, so it has no `arch`. It has no Renovate trigger line, as there is no Renovate datasource with this version format.

The package manager tools (`bundler`, `checkov`, `cocoapods`, `conan`, `copier`, `corepack`, `hashin`, `kas`, `npm`, `paket`, `pdm`, `pip-tools`, `pipenv`, `pnpm`, `poetry`, `renovate`, `uv`, `yarn`, `yarn-slim`) come from npm, pypi, rubygems or nuget without files; the deprecated `bower` and `lerna` aren't published. `yarn` is published as the union of the `yarn` package (1.x) and `@yarnpkg/cli-dist` (2 and later), its `source.packageName` is `@yarnpkg/cli-dist`; `yarn-slim` only has the 1.x versions of `yarn`. `paket` has no release times, nuget.org only lists them page by page.

`dotnet` lists the sdks of Microsoft's release metadata: the `releases-index.json` names the channels and the `releases.json` of each channel the sdks of its releases with the sha512 of every archive, so nothing is computed. The files are the linux `x64` and `arm64` archives with the url the CLI downloads from builds.dotnet.microsoft.com. A channel which can't be read is skipped with a warning.

### Computed checksums

Some upstreams publish no checksums: `bazelisk`, `jb`, `protoc`, `docker` (the static builds of download.docker.com, versions from the releases of `moby/moby`), `nuget` (`nuget.exe` of every release listed in dist.nuget.org's `tools.json`) and `scala` (the `scala-<version>.tgz` of the releases of `scala/scala`, which GitHub has since 2.10.5), and the old releases of `buildx` (before 0.7.0), `docker-compose` (before 2.5.0), `elixir` (before 1.14), `powershell` (before 7.2.0), `sbt` (before 1.3.5) and `vendir` (before 0.25.0). A published checksum always wins, and so does the `sha256` digest GitHub has for assets uploaded since 2025. Only when there is none, the build downloads the file once, streams it through sha256 and publishes the `sha256:` checksum. These checksums are trust-on-first-download: they prove that the file didn't change since, not that it is the one upstream built. A known file is never downloaded again, as the build reuses files by name.

The downloads of a build have a budget, 3 GiB by default, `TOOL_VERSIONS_DOWNLOAD_BUDGET` sets it in bytes. It is split fairly between the tools which may compute files: when its turn comes, a tool gets the budget which is left divided by the number of tools which still wait for their turn. A tool which needs less than its share leaves the rest to the tools after it, and a big tool can't use the budget of the others, so the total never exceeds the budget. The newest versions of a tool are computed first, a file which doesn't fit its share by its `content-length` is skipped, and when the share is used up the build prints one `::notice::` line for the tool. The older versions follow in the next nightly builds, so a tool is complete after a few builds. A failed download skips the file with a warning and is tried again by the next build. A version without an `amd64` file isn't published until its file is computed. As old releases may still lack a checksum, the release lists of these tools are always read completely instead of stopping at the first known version.

## Updates

- **Incremental:** each build starts from the published `v1/<tool>.full.json` files (as the Pages deploy replaces the whole site, the per-version files can't be fetched again). Known versions, files and release times are reused, only missing ones are fetched, and versions gone upstream stay listed. Paged sources stop at the first known version, so older gaps are filled by a full refresh.
- **Failures:** a missing checksum (404) skips the file, other errors warn and the next build retries. A tool whose fetch fails republishes its previous file with the old `updatedAt`; the build only fails for a tool without any versions.
- **Job summary:** when `GITHUB_STEP_SUMMARY` is set, as in GitHub Actions, each build appends a summary to it: the build kind and duration, the tools which were updated, kept their previous file or failed, the download budget, a table with a row per tool (versions, new versions, files added, computed checksums and bytes, warnings) and the warnings and errors of each tool. The log lines (`::warning::`, `::error::`, `::notice::`) stay as they are.
- **Full refresh:** run the `pages` workflow with the `full` input.
- **Release trigger:** Renovate updates [`renovate.Dockerfile`](./renovate.Dockerfile), one line per maintained major (per minor for golang, kubectl, php, python, ruby and scala), and the automerged update publishes a release right away; GitHub releases wait until they are 2 hours old, when all their assets are uploaded (other datasources, like docker, have no release times to wait for). Add new lines when they are released.

## Development

`mise install` installs Node.js, pnpm, jactionlint and the dependencies (or `pnpm install` without [mise](https://mise.jdx.dev)).

```bash
pnpm lint         # pnpm lint-fix to fix
pnpm test
jactionlint       # the GitHub workflows
pnpm build        # writes dist/, --full skips the previous files
```

`GITHUB_TOKEN` avoids the GitHub rate limit, `TOOL_VERSIONS_URL` overrides where the previous files come from.
