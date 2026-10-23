#-------------------------
# renovate rebuild trigger
# Each update is pushed to main, which runs the pages workflow and publishes
# the new versions without waiting for the nightly run. There is one line per
# major (per minor for golang, kubectl, php, python, ruby and scala). New lines are picked up
# by the nightly run, add them here when they are released.
#-------------------------

# makes lint happy
FROM scratch

# renovate: datasource=github-releases depName=apko packageName=chainguard-dev/apko
ENV APKO_VERSION=1.4.12

# renovate: datasource=github-releases depName=apm packageName=microsoft/apm
ENV APM_VERSION=0.35.0

# renovate: datasource=github-releases depName=bazelisk packageName=bazelbuild/bazelisk
ENV BAZELISK_VERSION=1.30.0

# renovate: datasource=github-releases depName=buf packageName=bufbuild/buf
ENV BUF_VERSION=1.75.0

# renovate: datasource=github-releases depName=buildx packageName=docker/buildx
ENV BUILDX_VERSION=0.38.1

# the github tags have a `bun-v` prefix, the npm versions are the same
# renovate: datasource=npm depName=bun
ENV BUN_VERSION=1.4.3

# renovate: datasource=rubygems depName=bundler versioning=ruby
ENV BUNDLER_VERSION=2.7.2

# renovate: datasource=rubygems depName=bundler versioning=ruby
ENV BUNDLER_VERSION=4.0.23

# renovate: datasource=github-releases depName=cabal packageName=haskell/cabal versioning=docker
ENV CABAL_VERSION=3.18.2.0

# renovate: datasource=pypi depName=checkov
ENV CHECKOV_VERSION=3.3.30

# renovate: datasource=rubygems depName=cocoapods versioning=ruby
ENV COCOAPODS_VERSION=1.17.0

# renovate: datasource=github-releases depName=composer packageName=containerbase/composer-prebuild
ENV COMPOSER_VERSION=2.10.3

# renovate: datasource=pypi depName=conan
ENV CONAN_VERSION=2.33.0

# renovate: datasource=pypi depName=copier
ENV COPIER_VERSION=9.19.1

# renovate: datasource=npm depName=corepack
ENV COREPACK_VERSION=0.36.0

# renovate: datasource=github-releases depName=deno packageName=denoland/deno
ENV DENO_VERSION=2.9.8

# renovate: datasource=dotnet-version depName=dotnet packageName=dotnet-sdk
ENV DOTNET_VERSION=8.0.426

# renovate: datasource=dotnet-version depName=dotnet packageName=dotnet-sdk
ENV DOTNET_VERSION=9.0.319

# renovate: datasource=dotnet-version depName=dotnet packageName=dotnet-sdk
ENV DOTNET_VERSION=10.0.402

# renovate: datasource=github-releases depName=docker packageName=moby/moby
ENV DOCKER_VERSION=28.5.2

# renovate: datasource=github-releases depName=devbox packageName=jetify-com/devbox
ENV DEVBOX_VERSION=0.18.4

# renovate: datasource=github-releases depName=docker-compose packageName=docker/compose
ENV DOCKER_COMPOSE_VERSION=5.6.1

# renovate: datasource=github-releases depName=elixir packageName=elixir-lang/elixir
ENV ELIXIR_VERSION=1.20.4

# renovate: datasource=github-releases depName=erlang packageName=containerbase/erlang-prebuild versioning=docker
ENV ERLANG_VERSION=27.3.4.19

# renovate: datasource=github-releases depName=erlang packageName=containerbase/erlang-prebuild versioning=docker
ENV ERLANG_VERSION=28.5.0.8

# renovate: datasource=github-releases depName=erlang packageName=containerbase/erlang-prebuild versioning=docker
ENV ERLANG_VERSION=29.1.2.0

# renovate: datasource=github-releases depName=flutter packageName=containerbase/flutter-prebuild
ENV FLUTTER_VERSION=3.47.7

# renovate: datasource=github-releases depName=flux packageName=fluxcd/flux2
ENV FLUX_VERSION=2.9.6

# renovate: datasource=github-releases depName=gh packageName=cli/cli
ENV GH_VERSION=2.103.0

# renovate: datasource=github-releases depName=git packageName=containerbase/git-prebuild
ENV GIT_VERSION=2.56.0

# renovate: datasource=github-releases depName=git-lfs packageName=git-lfs/git-lfs
ENV GIT_LFS_VERSION=3.8.1

# renovate: datasource=github-releases depName=gleam packageName=gleam-lang/gleam
ENV GLEAM_VERSION=1.19.2

# renovate: datasource=github-releases depName=golang packageName=containerbase/golang-prebuild
ENV GOLANG_VERSION=1.26.10

# renovate: datasource=github-releases depName=golang packageName=containerbase/golang-prebuild
ENV GOLANG_VERSION=1.27.3

# renovate: datasource=gradle-version depName=gradle versioning=gradle
ENV GRADLE_VERSION=8.14.6

# renovate: datasource=gradle-version depName=gradle versioning=gradle
ENV GRADLE_VERSION=9.8.2

# renovate: datasource=dart-version depName=dart
ENV DART_VERSION=3.13.7

# renovate: datasource=docker depName=ghc packageName=haskell versioning=docker
ENV GHC_VERSION=9.14.1

# renovate: datasource=pypi depName=hashin
ENV HASHIN_VERSION=1.0.5

# renovate: datasource=github-releases depName=helm packageName=helm/helm
ENV HELM_VERSION=3.22.1

# renovate: datasource=github-releases depName=helm packageName=helm/helm
ENV HELM_VERSION=4.3.1

# renovate: datasource=github-releases depName=jb packageName=containerbase/jb-prebuild versioning=loose
ENV JB_VERSION=0.6.0.1

# renovate: datasource=github-releases depName=helmfile packageName=helmfile/helmfile
ENV HELMFILE_VERSION=1.8.2

# renovate: datasource=java-version depName=java packageName=java-jdk?os=linux&architecture=x64
ENV JAVA_VERSION=8.0.504+1

# renovate: datasource=java-version depName=java packageName=java-jdk?os=linux&architecture=x64
ENV JAVA_VERSION=11.0.32+101

# renovate: datasource=java-version depName=java packageName=java-jdk?os=linux&architecture=x64
ENV JAVA_VERSION=17.0.21+9

# renovate: datasource=java-version depName=java packageName=java-jdk?os=linux&architecture=x64
ENV JAVA_VERSION=21.0.13+9.0.LTS

# renovate: datasource=java-version depName=java packageName=java-jdk?os=linux&architecture=x64
ENV JAVA_VERSION=25.0.5+8.0.LTS

# renovate: datasource=pypi depName=kas
ENV KAS_VERSION=5.5

# renovate: datasource=github-releases depName=kubectl packageName=kubernetes/kubernetes
ENV KUBECTL_VERSION=1.35.9

# renovate: datasource=github-releases depName=kubectl packageName=kubernetes/kubernetes
ENV KUBECTL_VERSION=1.36.5

# renovate: datasource=github-releases depName=kubectl packageName=kubernetes/kubernetes
ENV KUBECTL_VERSION=1.37.1

# the `kustomize/v` tag prefix is stripped by the containerbase preset
# renovate: datasource=github-releases depName=kustomize packageName=kubernetes-sigs/kustomize
ENV KUSTOMIZE_VERSION=5.8.3

# renovate: datasource=github-releases depName=maven packageName=containerbase/maven-prebuild versioning=maven
ENV MAVEN_VERSION=3.10.0

# renovate: datasource=github-releases depName=mise packageName=jdx/mise
ENV MISE_VERSION=2026.10.17

# renovate: datasource=github-releases depName=mono packageName=containerbase/mono-prebuild
ENV MONO_VERSION=6.14.1

# renovate: datasource=github-releases depName=nix packageName=containerbase/nix-prebuild
ENV NIX_VERSION=2.35.4

# renovate: datasource=node-version depName=node versioning=node
ENV NODE_VERSION=22.23.4

# renovate: datasource=node-version depName=node versioning=node
ENV NODE_VERSION=24.22.1

# renovate: datasource=node-version depName=node versioning=node
ENV NODE_VERSION=26.12.1

# renovate: datasource=npm depName=npm
ENV NPM_VERSION=10.9.9

# renovate: datasource=npm depName=npm
ENV NPM_VERSION=11.21.1

# renovate: datasource=npm depName=npm
ENV NPM_VERSION=12.2.1

# renovate: datasource=nuget depName=nuget packageName=NuGet.CommandLine
ENV NUGET_VERSION=7.9.0

# renovate: datasource=github-releases depName=nub packageName=nubjs/nub
ENV NUB_VERSION=0.9.7

# renovate: datasource=nuget depName=Paket
ENV PAKET_VERSION=9.0.2

# renovate: datasource=pypi depName=pdm
ENV PDM_VERSION=2.29.3

# renovate: datasource=github-releases depName=php packageName=containerbase/php-prebuild
ENV PHP_VERSION=8.2.35

# renovate: datasource=github-releases depName=php packageName=containerbase/php-prebuild
ENV PHP_VERSION=8.3.36

# renovate: datasource=github-releases depName=php packageName=containerbase/php-prebuild
ENV PHP_VERSION=8.4.27

# renovate: datasource=github-releases depName=php packageName=containerbase/php-prebuild
ENV PHP_VERSION=8.5.12

# renovate: datasource=pypi depName=pip-tools
ENV PIP_TOOLS_VERSION=7.6.2

# renovate: datasource=pypi depName=pipenv
ENV PIPENV_VERSION=2026.10.2

# renovate: datasource=github-releases depName=pixi packageName=prefix-dev/pixi
ENV PIXI_VERSION=0.83.0

# renovate: datasource=npm depName=pnpm
ENV PNPM_VERSION=10.34.7

# renovate: datasource=npm depName=pnpm
ENV PNPM_VERSION=11.28.6

# renovate: datasource=npm depName=pnpm
ENV PNPM_VERSION=12.14.0

# renovate: datasource=pypi depName=poetry
ENV POETRY_VERSION=2.5.1

# renovate: datasource=github-releases depName=protoc packageName=protocolbuffers/protobuf versioning=docker
ENV PROTOC_VERSION=36.2

# renovate: datasource=github-releases depName=powershell packageName=PowerShell/PowerShell
ENV POWERSHELL_VERSION=7.6.8

# renovate: datasource=github-releases depName=python packageName=containerbase/python-prebuild
ENV PYTHON_VERSION=3.10.22

# renovate: datasource=github-releases depName=python packageName=containerbase/python-prebuild
ENV PYTHON_VERSION=3.11.17

# renovate: datasource=github-releases depName=python packageName=containerbase/python-prebuild
ENV PYTHON_VERSION=3.12.15

# renovate: datasource=github-releases depName=python packageName=containerbase/python-prebuild
ENV PYTHON_VERSION=3.13.17

# renovate: datasource=github-releases depName=python packageName=containerbase/python-prebuild
ENV PYTHON_VERSION=3.14.9

# renovate: datasource=npm depName=renovate
ENV RENOVATE_VERSION=43.288.0

# renovate: datasource=github-releases depName=ruby packageName=containerbase/ruby-prebuild versioning=ruby
ENV RUBY_VERSION=3.3.13

# renovate: datasource=github-releases depName=ruby packageName=containerbase/ruby-prebuild versioning=ruby
ENV RUBY_VERSION=3.4.12

# renovate: datasource=github-releases depName=ruby packageName=containerbase/ruby-prebuild versioning=ruby
ENV RUBY_VERSION=4.0.9

# renovate: datasource=github-releases depName=rust packageName=rust-lang/rust
ENV RUST_VERSION=1.99.1

# renovate: datasource=github-releases depName=sbt packageName=sbt/sbt
ENV SBT_VERSION=1.13.0

# renovate: datasource=github-releases depName=sbt packageName=sbt/sbt
ENV SBT_VERSION=2.0.11

# renovate: datasource=github-releases depName=scala packageName=scala/scala
ENV SCALA_VERSION=2.12.21

# renovate: datasource=github-releases depName=scala packageName=scala/scala
ENV SCALA_VERSION=2.13.18

# renovate: datasource=github-releases depName=skopeo packageName=containerbase/skopeo-prebuild
ENV SKOPEO_VERSION=1.24.1

# renovate: datasource=github-releases depName=sops packageName=getsops/sops
ENV SOPS_VERSION=3.13.3

# renovate: datasource=docker depName=swift versioning=docker
ENV SWIFT_VERSION=6.4.1

# renovate: datasource=docker depName=terraform packageName=hashicorp/terraform versioning=docker
ENV TERRAFORM_VERSION=1.17.0

# renovate: datasource=github-releases depName=tofu packageName=opentofu/opentofu
ENV TOFU_VERSION=1.13.2

# renovate: datasource=pypi depName=uv
ENV UV_VERSION=0.13.5

# renovate: datasource=github-releases depName=vendir packageName=vmware-tanzu/carvel-vendir
ENV VENDIR_VERSION=0.46.3

# renovate: datasource=github-releases depName=vp packageName=voidzero-dev/vite-plus
ENV VP_VERSION=1.4.0

# renovate: datasource=github-releases depName=wally packageName=containerbase/wally-prebuild
ENV WALLY_VERSION=0.3.2

# renovate: datasource=npm depName=yarn
ENV YARN_VERSION=1.22.22

# renovate: datasource=npm depName=@yarnpkg/cli-dist
ENV YARN_VERSION=4.18.1
