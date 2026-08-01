#!/bin/bash

set -e

bundle_full_index=false

if [ -n "${RUBYGEMS_MIRROR:-}" ] && [ "$RUBYGEMS_MIRROR" != "https://rubygems.org" ]; then
  compact_index_url="${RUBYGEMS_MIRROR%/}/versions"
  if ! curl --fail --head --silent --show-error --max-time 15 "$compact_index_url" >/dev/null; then
    echo "RubyGems mirror does not provide a compact index; falling back to the TUNA mirror"
    RUBYGEMS_MIRROR="https://mirrors.tuna.tsinghua.edu.cn/rubygems"
    bundle_full_index=true
  fi
fi

if [ -n "${RUBYGEMS_MIRROR:-}" ] && [ "$RUBYGEMS_MIRROR" != "https://rubygems.org" ]; then
  bundle config set --global mirror.https://rubygems.org "$RUBYGEMS_MIRROR"
fi

bundle config set --local path 'vendor/bundle'
bundle config set --local without 'test development'
bundle_install_args=(install --jobs=8 --retry=3)
if $bundle_full_index; then
  bundle_install_args+=(--full-index)
fi
bundle "${bundle_install_args[@]}"
bundle config set deployment 'true'
cp Gemfile.lock Gemfile.lock.bak
rm -rf vendor/bundle/ruby/*/cache
rm -rf vendor/bundle/ruby/*/gems/*/spec
rm -rf vendor/bundle/ruby/*/gems/*/test
rm -rf vendor/bundle/ruby/*/gems/*/tests
rm -rf vendor/bundle/ruby/*/gems/*/{doc,docs,example,examples,benchmark,benchmarks}
rm -rf vendor/bundle/ruby/*/bundler/gems/*/.git
rm -rf vendor/bundle/ruby/*/bundler/gems/*/{spec,test,tests,doc,docs,example,examples,benchmark,benchmarks}
find vendor/bundle -type f \( -name '*.a' -o -name '*.o' \) -delete
