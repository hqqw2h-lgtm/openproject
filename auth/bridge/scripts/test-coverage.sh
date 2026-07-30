#!/bin/sh

set -eu

tests="test/accounts.test.js test/html.test.js test/interaction.test.js test/runtime-config.test.js test/server.test.js test/wecom.test.js"
thresholds="--test-coverage-lines=95 --test-coverage-functions=95 --test-coverage-branches=95"

for file in src/*.js; do
  echo "Checking per-file coverage: $file"
  # shellcheck disable=SC2086
  node --test --test-reporter=dot --experimental-test-coverage \
    "--test-coverage-include=$file" $thresholds $tests
done

echo "Checking aggregate src coverage"
# shellcheck disable=SC2086
node --test --experimental-test-coverage \
  '--test-coverage-include=src/*.js' $thresholds $tests
