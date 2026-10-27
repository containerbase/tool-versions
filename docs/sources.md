# Sources

Where the versions and files come from.
[`src/tools.ts`](../src/tools.ts) is the source of truth: it maps each tool to its source and lists the files of a version.
Each tool must exist in `@containerbase/base`.

## Containerbase prebuilds

Example: `python`.

- The versions are the releases of `containerbase/<tool>-prebuild`.
- The files are the release assets which have a `.sha512` file.
- `arch` and `distro` are read from the file name.
- Files of `bionic` and `focal` are skipped.
- Some prebuilds have no `arch`.
- The versions are sorted with the Renovate versioning of the tool.

## GitHub releases

Example: `helm`.

- The versions are the releases of the upstream repository.
- The files are the linux `amd64` and `arm64` assets, or urls built by a template in `src/tools.ts`.
- The checksum is read from a checksum asset: one file per asset, or one list for all of them (downloaded once per release).
- A tag prefix, like the one of `kustomize`, is set in `src/tools.ts`. A tool can have several, like `docker` with `v` and `docker-v`; tags with none of them are skipped.
- A version without any file with a checksum isn't published.

## Other hosts

Each has its own datasource in [`src/datasources`](../src/datasources). Example: `terraform` reads releases.hashicorp.com.
The `index.json` there lists the versions and the zips, and the `SHA256SUMS` of a release has the checksums.

Exceptions:

- `node`: versions and archives from nodejs.org, plus the files of `containerbase/node-prebuild`, which the CLI prefers. The prebuild releases are one paged list. Only versions without prebuild files read their `.sha512`. When the list can't be read, the build warns and keeps the known files.
- `rust`: the GitHub releases of `rust-lang/rust`, plus the nightlies of the last 90 days from the rust release channel, like Renovate's `rust-version` datasource.
  - The days with a nightly are read from one request to `static.rust-lang.org/manifests.txt`. Days without a nightly are skipped.
  - A nightly is the prerelease `nightly-YYYY-MM-DD`, released on its date. The files are `dist/<date>/rust-nightly-<arch>-unknown-linux-gnu.tar.xz` with the checksum from the `.sha256` next to them, the urls of the CLI.
  - Known files are reused, so a build only requests the two checksum files of each new nightly. Nightlies older than 90 days are removed.
  - The versions are sorted with the `rust-release-channel` versioning of Renovate: the nightlies by date, above all releases.
- `java-jdk`, `java-jre`: the Adoptium source of `java`, with the jdk or jre image type.
- `dotnet`: Microsoft's release metadata has the sha512 of every archive, so nothing is computed. A channel which can't be read is skipped with a warning.
- `swift`: releases from `swift.org/api/v1/install/releases.json`. The files are the Ubuntu 22.04 (`jammy`), 24.04 (`noble`, from 5.10.1) and 26.04 (`resolute`) archives of the platforms a release lists, with the urls of the CLI. Swift only publishes PGP signatures, so the sha256 is computed.
- `android-sdk-cmdline-tools`: Google's `repository2-3.xml`, a large XML parsed like the CLI does. The linux zip with its `sha1` is the file, the same for all architectures. It has no Renovate trigger line, as no Renovate datasource has its version format.

## Package managers

Example: `pnpm`.

- The versions come from npm, pypi, rubygems or nuget.
- There are no files, the package manager installs and verifies them.
- Deprecated tools aren't published.
- `yarn` is the union of the `yarn` package (1.x) and `@yarnpkg/cli-dist` (2 and later).
- `yarn-slim` is only the 1.x versions of `yarn`.
- Some sources have no release times.
- The runtime constraints of npm, pypi and rubygems versions come from the documents the build fetches anyway, see the [format](./format.md#fields). Published constraints are reused, only versions without one read them.

## Computed checksums

Some upstreams publish no checksum, at least for old releases. The tools are marked in `src/tools.ts` and in their datasource.

- A published checksum always wins, and so does the `sha256` digest GitHub has for assets uploaded since 2025.
- Otherwise the build downloads the file once, streams it through sha256 and publishes `sha256:<hex>`.
- These checksums are trust-on-first-download: they prove the file didn't change since, not that it is the one upstream built.
- A known file is never downloaded again, files are reused by name.
- A version without an `amd64` file isn't published until its file is computed.
- The release lists of these tools are always read completely, as old releases may still lack a checksum.

## Download budget

- The downloads of a build have a budget, 3 GiB by default. `TOOL_VERSIONS_DOWNLOAD_BUDGET` sets it in bytes.
- It is split between the tools which may compute files. When its turn comes, a tool gets the budget left divided by the number of tools still waiting.
- A tool which needs less leaves the rest to the next ones. The total never exceeds the budget.
- The newest versions are computed first. Older ones follow in the next nightly builds.
- To compute a big backlog in one build, and so in one release, run the `pages` workflow manually with the `budget` input in GiB. It also raises the job timeout to 2 hours.
- A file which doesn't fit the share, by its `content-length`, is skipped. The build prints one `::notice::` line per tool when its share is used up.
- A failed download skips the file with a warning, the next build tries again.
