#-------------------------
# renovate rebuild trigger
# Each update is pushed to main, which runs the pages workflow and publishes
# the new versions without waiting for the nightly run. There is one line per
# major (per minor for python). New lines are picked up by the nightly run, add
# them here when they are released.
#-------------------------

# makes lint happy
FROM scratch

# renovate: datasource=rubygems depName=bundler versioning=ruby
ENV BUNDLER_VERSION=2.7.2

# renovate: datasource=rubygems depName=bundler versioning=ruby
ENV BUNDLER_VERSION=4.0.3

# renovate: datasource=pypi depName=checkov
ENV CHECKOV_VERSION=3.2.0

# renovate: datasource=pypi depName=copier
ENV COPIER_VERSION=9.10.0

# renovate: datasource=npm depName=corepack
ENV COREPACK_VERSION=0.34.0

# renovate: datasource=pypi depName=hashin
ENV HASHIN_VERSION=1.0.5

# renovate: datasource=github-releases depName=helm packageName=helm/helm
ENV HELM_VERSION=3.22.0

# renovate: datasource=github-releases depName=helm packageName=helm/helm
ENV HELM_VERSION=4.3.0

# renovate: datasource=java-version depName=java packageName=java-jdk?os=linux&architecture=x64
ENV JAVA_VERSION=8.0.504+1

# renovate: datasource=java-version depName=java packageName=java-jdk?os=linux&architecture=x64
ENV JAVA_VERSION=11.0.32+101

# renovate: datasource=java-version depName=java packageName=java-jdk?os=linux&architecture=x64
ENV JAVA_VERSION=17.0.20+101

# renovate: datasource=java-version depName=java packageName=java-jdk?os=linux&architecture=x64
ENV JAVA_VERSION=21.0.12+101.0.LTS

# renovate: datasource=java-version depName=java packageName=java-jdk?os=linux&architecture=x64
ENV JAVA_VERSION=25.0.4+101.0.LTS

# renovate: datasource=pypi depName=kas
ENV KAS_VERSION=5.5

# renovate: datasource=node-version depName=node versioning=node
ENV NODE_VERSION=22.23.3

# renovate: datasource=node-version depName=node versioning=node
ENV NODE_VERSION=24.21.0

# renovate: datasource=node-version depName=node versioning=node
ENV NODE_VERSION=26.11.1

# renovate: datasource=npm depName=npm
ENV NPM_VERSION=10.9.4

# renovate: datasource=npm depName=npm
ENV NPM_VERSION=11.6.2

# renovate: datasource=pypi depName=pdm
ENV PDM_VERSION=2.26.0

# renovate: datasource=pypi depName=pip-tools
ENV PIP_TOOLS_VERSION=7.5.0

# renovate: datasource=pypi depName=pipenv
ENV PIPENV_VERSION=2026.0.3

# renovate: datasource=npm depName=pnpm
ENV PNPM_VERSION=10.34.6

# renovate: datasource=npm depName=pnpm
ENV PNPM_VERSION=11.28.5

# renovate: datasource=npm depName=pnpm
ENV PNPM_VERSION=12.11.0

# renovate: datasource=pypi depName=poetry
ENV POETRY_VERSION=2.5.1

# renovate: datasource=github-releases depName=python packageName=containerbase/python-prebuild
ENV PYTHON_VERSION=3.10.22

# renovate: datasource=github-releases depName=python packageName=containerbase/python-prebuild
ENV PYTHON_VERSION=3.11.17

# renovate: datasource=github-releases depName=python packageName=containerbase/python-prebuild
ENV PYTHON_VERSION=3.12.15

# renovate: datasource=github-releases depName=python packageName=containerbase/python-prebuild
ENV PYTHON_VERSION=3.13.16

# renovate: datasource=github-releases depName=python packageName=containerbase/python-prebuild
ENV PYTHON_VERSION=3.14.8

# renovate: datasource=pypi depName=uv
ENV UV_VERSION=0.9.0
