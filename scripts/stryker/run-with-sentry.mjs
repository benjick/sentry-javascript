import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as Sentry from '@sentry/node';
import { Stryker } from '@stryker-mutator/core';

const configFile = path.join(process.cwd(), '/stryker.config.mjs');
const pkgJson = path.join(process.cwd(), 'package.json');

const packageName = JSON.parse(fs.readFileSync(pkgJson).toString()).name;

Sentry.init({
  dsn: 'https://cdae3f96df86224530838d318d268f62@o447951.ingest.us.sentry.io/4507814527303680',
  tracesSampleRate: 1.0,
  defaultIntegrations: false,

  environment: process.env.CI ? 'ci' : 'local',
  release: child_process.execSync('git rev-parse HEAD').toString().trim(),

  debug: true,
});

async function main() {
  await Sentry.continueTrace(
    {
      sentryTrace: process.env.SENTRY_MUT_SENTRY_TRACE || undefined,
      baggage: process.env.SENTRY_MUT_BAGGAGE || undefined,
    },
    () =>
      Sentry.startSpan({ name: packageName, op: 'mutation' }, async () => {
        const config = await Sentry.startSpan({ name: 'import stryker config', op: 'import' }, async () => {
          const mod = await import(configFile);
          return mod.default;
        });

        // Runs Stryker, will not assume to be allowed to exit the process.
        const stryker = new Stryker(config);
        const mutantResults = await Sentry.startSpan({ name: 'run mutation test', op: 'stryker' }, async () =>
          stryker.runMutationTest(),
        );

        Sentry.startSpan({ name: 'report results', op: 'sentry' }, () => {
          const aggregatedResult = getMutationTestResultAggregation(mutantResults);
          Sentry.setTag('mutation.score', aggregatedResult.score);
          Sentry.setTag('mutation.package', packageName);
          Sentry.setMeasurement('mutation.score', aggregatedResult.score, 'ratio');
          Sentry.setMeasurement('mutation.score_covered', aggregatedResult.scoreCovered, 'ratio');
        });
      }),
  );
}

main().catch(console.error);

function getMutationTestResultAggregation(mutantResults) {
  const total = mutantResults.length;

  const noCoverage = mutantResults.filter(mutant => mutant.status === 'NoCoverage').length;
  const killed = mutantResults.filter(mutant => mutant.status === 'Killed').length;
  const survived = mutantResults.filter(mutant => mutant.status === 'Survived').length;
  const error = mutantResults.filter(
    mutant => mutant.status === 'RuntimeError' || mutant.status === 'CompileError',
  ).length;
  const ignored = mutantResults.filter(mutant => mutant.status === 'Ignored').length;
  const timeout = mutantResults.filter(mutant => mutant.status === 'Timeout').length;

  const detected = killed + timeout;

  return {
    score: Math.round((detected / (total - ignored) + Number.EPSILON) * 100) / 100,
    scoreCovered: Math.round((detected / (total - ignored - noCoverage) + Number.EPSILON) * 100) / 100,
    detected,
    undetected: survived + noCoverage,
    killed,
    survived,
    noCoverage,
    ignored,
    error,
    timeout,
    total,
  };
}
