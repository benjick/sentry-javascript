#!/bin/bash
### Example of a version-bumping script for an NPM project.
### Located at: ./scripts/bump-version.sh
set -eux

NEW_VERSION="${2}"

# Do not tag and commit changes made by "npm version"
export npm_config_git_tag_version=false
npm version "${NEW_VERSION}"

echo "// This is an auto generated file. Do not edit this file directly.
// The version is bumped by scripts/bump_version.sh
export const SDK_VERSION = '${NEW_VERSION}';" > src/sdk_version.ts