/* eslint-disable no-console */
/*
  This script prepares the central `build` directory for NPM package creation.
  It first copies all non-code files into the `build` directory, including `package.json`, which
  is edited to adjust entry point paths. These corrections are performed so that the paths align with
  the directory structure inside `build`.
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { sync as glob } from 'glob';

const ASSETS = ['README.md', 'LICENSE', 'package.json', '.npmignore'];

const ENTRY_POINTS = ['main', 'module', 'types', 'browser'] as const;
const CONDITIONAL_EXPORT_ENTRY_POINTS = ['import', 'require', ...ENTRY_POINTS] as const;
const EXPORT_MAP_ENTRY_POINT = 'exports';
const TYPES_VERSIONS_ENTRY_POINT = 'typesVersions';

type PackageJsonEntryPoints = Record<(typeof ENTRY_POINTS)[number], string>;
type ConditionalExportEntryPoints = Record<(typeof CONDITIONAL_EXPORT_ENTRY_POINTS)[number], string>;

interface TypeVersions {
  [key: string]: {
    [key: string]: string[];
  };
}

type PackageJsonExports = Partial<ConditionalExportEntryPoints> & {
  [key: string]: Partial<ConditionalExportEntryPoints>;
};

interface PackageJson extends Record<string, unknown>, PackageJsonEntryPoints {
  [EXPORT_MAP_ENTRY_POINT]: PackageJsonExports;
  [TYPES_VERSIONS_ENTRY_POINT]: TypeVersions;
}

export async function prepack(buildDir: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkgJson: PackageJson = require(path.resolve('package.json'));

  // check if build dir exists
  if (!fs.existsSync(path.resolve(buildDir))) {
    console.error(`\nERROR: Directory '${buildDir}' does not exist in ${pkgJson.name}.`);
    console.error("This script should only be executed after you've run `yarn build`.");
    process.exit(1);
  }

  // copy non-code assets to build dir
  ASSETS.forEach(asset => {
    const assetPath = path.resolve(asset);
    if (fs.existsSync(assetPath)) {
      const destinationPath = path.resolve(buildDir, path.basename(asset));
      console.log(`Copying ${path.basename(asset)} to ${path.relative('../..', destinationPath)}.`);
      fs.copyFileSync(assetPath, destinationPath);
    }
  });

  // package.json modifications
  const newPackageJsonPath = path.resolve(buildDir, 'package.json');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const newPkgJson: PackageJson = require(newPackageJsonPath);

  // modify entry points to point to correct paths (i.e. strip out the build directory)
  ENTRY_POINTS.filter(entryPoint => newPkgJson[entryPoint]).forEach(entryPoint => {
    newPkgJson[entryPoint] = newPkgJson[entryPoint].replace(`${buildDir}/`, '');
  });

  rewriteSourceMapSourcesPath(buildDir);

  if (newPkgJson[EXPORT_MAP_ENTRY_POINT]) {
    Object.keys(newPkgJson[EXPORT_MAP_ENTRY_POINT]).forEach(key => {
      rewriteConditionalExportEntryPoint(buildDir, newPkgJson[EXPORT_MAP_ENTRY_POINT], key);
    });
  }

  if (newPkgJson[TYPES_VERSIONS_ENTRY_POINT]) {
    Object.entries(newPkgJson[TYPES_VERSIONS_ENTRY_POINT]).forEach(([key, val]) => {
      newPkgJson[TYPES_VERSIONS_ENTRY_POINT][key] = Object.entries(val).reduce(
        (acc, [key, val]) => {
          const newKey = key.replace(`${buildDir}/`, '');
          acc[newKey] = val.map(v => v.replace(`${buildDir}/`, ''));
          return acc;
        },
        {} as Record<string, string[]>,
      );
    });
  }

  delete newPkgJson.scripts;
  delete newPkgJson.volta;
  delete newPkgJson.jest;

  // write modified package.json to file (pretty-printed with 2 spaces)
  try {
    fs.writeFileSync(newPackageJsonPath, JSON.stringify(newPkgJson, null, 2));
  } catch (error) {
    console.error(`\nERROR: Error while writing modified 'package.json' to disk in ${pkgJson.name}:\n`, error);
    process.exit(1);
  }

  await runPackageSpecificScripts(buildDir, pkgJson);
}

async function runPackagePrepack(buildDir: string, pkgJson: PackageJson, packagePrepackPath: string): Promise<void> {
  const { prepack } = await import(packagePrepackPath);
  if (prepack && typeof prepack === 'function') {
    const isSuccess = prepack(buildDir);
    if (!isSuccess) {
      process.exit(1);
    }
  } else {
    console.error(`\nERROR: Could not find a \`prepack\` function in './scripts/prepack.ts' in ${pkgJson.name}.`);
    console.error(
      'Make sure your package-specific prepack script exports `function prepack(buildDir: string): boolean`.',
    );
    process.exit(1);
  }
}

// execute package specific settings
// 1. check if a script called `<package-root>/scripts/prepack.ts` exists
// if yes, 2.) execute that script for things that are package-specific
async function runPackageSpecificScripts(buildDir: string, pkgJson: PackageJson): Promise<void> {
  const packagePrepackPath = path.resolve('scripts', 'prepack.ts');
  try {
    if (fs.existsSync(packagePrepackPath)) {
      await runPackagePrepack(buildDir, pkgJson, packagePrepackPath);
    }
  } catch (error) {
    console.error(`\nERROR: Error while trying to load and run ./scripts/prepack.ts in ${pkgJson.name}:\n`, error);
    process.exit(1);
  }
  console.log(`\nSuccessfully finished prepack commands for ${pkgJson.name}\n`);
}

/**
 * Recursively traverses the exports object and rewrites all string values to remove the build directory.
 */
function rewriteConditionalExportEntryPoint(
  buildDir: string,
  exportsObject: Record<string, string | Record<string, string>>,
  key: string,
): void {
  const exportsField = exportsObject[key];
  if (!exportsField) {
    return;
  }

  if (typeof exportsField === 'string') {
    exportsObject[key] = exportsField.replace(`${buildDir}/`, '');
    return;
  }
  Object.keys(exportsField).forEach(subfieldKey => {
    rewriteConditionalExportEntryPoint(buildDir, exportsField, subfieldKey);
  });
}

function rewriteSourceMapSourcesPath(buildDir: string): void {
  const mapFiles = glob('**/*.map', { cwd: buildDir });

  mapFiles.forEach(mapFile => {
    const mapFilePath = path.resolve(buildDir, mapFile);
    const mapFileContent = fs.readFileSync(mapFilePath, 'utf8');
    const mapFileContentObj = JSON.parse(mapFileContent) as { sources?: string[]; _processed?: boolean };

    // Ensure we don't double-process
    if (mapFileContentObj._processed) {
      return;
    }

    // Sources point to the original source files, but the relativity of the path breaks when we publish
    // Once we publish, the original sources are one level less deep than at build time
    if (Array.isArray(mapFileContentObj.sources)) {
      // Replace first occurence of ../../ with just ../
      mapFileContentObj.sources = mapFileContentObj.sources.map((source: string) => source.replace('../../', '../'));
    }

    mapFileContentObj._processed = true;

    fs.writeFileSync(mapFilePath, JSON.stringify(mapFileContentObj));
  });
}
