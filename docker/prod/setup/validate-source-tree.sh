#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="${SOURCE_ROOT:-$(cd -- "${SCRIPT_DIR}/../../.." && pwd)}"
DEFAULT_MANIFEST="${SCRIPT_DIR}/required-module-locales.txt"
missing_tmp="$(mktemp)"

cleanup() {
  rm -f "${missing_tmp}"
}
trap cleanup EXIT

locale_manifest="${LOCALE_MANIFEST:-${DEFAULT_MANIFEST}}"

if [[ ! -s "${locale_manifest}" ]]; then
  echo "Locale preflight has no tracked files to validate: ${locale_manifest}" >&2
  exit 1
fi

checked=0
while IFS= read -r relative_path || [[ -n "${relative_path}" ]]; do
  [[ -z "${relative_path}" ]] && continue
  checked=$((checked + 1))
  if [[ ! -f "${SOURCE_ROOT}/${relative_path}" ]]; then
    printf '%s\n' "${relative_path}" >> "${missing_tmp}"
  fi
done < "${locale_manifest}"

if [[ -s "${missing_tmp}" ]]; then
  missing_count="$(wc -l < "${missing_tmp}" | tr -d ' ')"
  echo "Source tree is missing ${missing_count} tracked locale files:" >&2
  head -20 "${missing_tmp}" >&2
  if [[ "${missing_count}" -gt 20 ]]; then
    echo "... and $((missing_count - 20)) more" >&2
  fi
  echo >&2
  echo "For a sparse checkout, materialize locales before building:" >&2
  echo "  git sparse-checkout add '/config/locales/' \\" >&2
  echo "    '/modules/*/config/locales/en.yml' \\" >&2
  echo "    '/modules/*/config/locales/js-en.yml' \\" >&2
  echo "    '/modules/*/config/locales/crowdin/zh-CN.yml' \\" >&2
  echo "    '/modules/*/config/locales/crowdin/js-zh-CN.yml' \\" >&2
  echo "    '/modules/*/config/locales/crowdin/zh-CN.seeders.yml'" >&2
  exit 1
fi

echo "Source locale preflight passed (${checked} files)"
