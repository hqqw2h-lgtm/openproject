# frozen_string_literal: true

source_bundle = "frontend/src/vendor/ckeditor/ckeditor.js"

if File.file?(source_bundle)
  source = File.binread(source_bundle)
  unpatched = "e.__currentlyDisabled.indexOf(i)<0&&(i.isEnabled=!0)"
  patched = "i&&e.__currentlyDisabled.indexOf(i)<0&&(i.isEnabled=!0)"

  if source.scan(patched).one?
    warn "CKEditor source-mode toolbar guard already present in #{source_bundle}"
    exit
  end

  matches = source.scan(unpatched)
  abort "Expected exactly one CKEditor source-mode toolbar restore expression, found #{matches.length}" unless matches.one?

  source.sub!(unpatched, patched)
  File.binwrite(source_bundle, source)
  warn "Patched CKEditor source-mode toolbar guard in #{source_bundle}"
  exit
end

bundle = Dir.glob("public/assets/frontend/src/vendor/ckeditor/ckeditor-*.js")

abort "Expected exactly one compiled CKEditor bundle, found #{bundle.length}" unless bundle.one?

path = bundle.first
source = File.binread(path)
unpatched = /([A-Za-z_$][\w$]*)\.__currentlyDisabled\.indexOf\(([A-Za-z_$][\w$]*)\) < 0 && \(\2\.isEnabled = true\);/
patched = /([A-Za-z_$][\w$]*) && ([A-Za-z_$][\w$]*)\.__currentlyDisabled\.indexOf\(\1\) < 0 && \(\1\.isEnabled = true\);/

if source.scan(patched).one?
  warn "CKEditor source-mode toolbar guard already present in #{path}"
  exit
end

matches = source.scan(unpatched)
abort "Expected exactly one CKEditor source-mode toolbar restore expression, found #{matches.length}" unless matches.one?

source.sub!(unpatched) do |expression|
  item = Regexp.last_match(2)
  "#{item} && #{expression}"
end

File.binwrite(path, source)
warn "Patched CKEditor source-mode toolbar guard in #{path}"
