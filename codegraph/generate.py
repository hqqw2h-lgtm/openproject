#!/usr/bin/env python3
"""Generate deterministic OpenProject file and architecture graphs."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "codegraph"
FILE_GRAPH_PATH = OUTPUT_DIR / "openproject-code-graph.json"
ARCH_GRAPH_PATH = OUTPUT_DIR / "openproject-architecture-graph.json"

SOURCE_PREFIXES = (
    "app/",
    "bin/",
    "config/",
    "db/",
    "extensions/",
    "frontend/src/",
    "lib/",
    "lib_static/",
    "modules/",
    "script/",
)

EXCLUDED_PARTS = {
    ".git",
    "dist",
    "fixtures",
    "locales",
    "node_modules",
    "spec",
    "test",
    "tests",
    "tmp",
    "vendor",
}

LANGUAGES = {
    ".css": "CSS",
    ".erb": "ERB",
    ".gemspec": "Ruby",
    ".html": "HTML",
    ".js": "JavaScript",
    ".json": "JSON",
    ".mjs": "JavaScript",
    ".rake": "Ruby",
    ".rb": "Ruby",
    ".sass": "Sass",
    ".scss": "SCSS",
    ".sh": "Shell",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".yaml": "YAML",
    ".yml": "YAML",
}

CODE_LANGUAGES = {"ERB", "JavaScript", "Ruby", "TypeScript"}
JS_EXTENSIONS = (".ts", ".tsx", ".js", ".mjs")
RUBY_EXTENSIONS = (".rb", ".rake", ".gemspec")

JS_IMPORT_RE = re.compile(
    r"(?:\b(?:import|export)\b[^;\n]*?\bfrom\s*|\bimport\s*|\brequire\s*\(|\bimport\s*\()"
    r"[\"']([^\"']+)[\"']"
)
RUBY_REQUIRE_RE = re.compile(
    r"^\s*require(?P<relative>_relative)?\s*(?:\(?\s*)[\"'](?P<target>[^\"']+)[\"']",
    re.MULTILINE,
)
GEM_MODULE_RE = re.compile(
    r"gem\s+[\"'](?P<gem>[^\"']+)[\"'][^\n]*path:\s*[\"']modules/(?P<path>[^\"']+)[\"']"
)
GEM_DEPENDENCY_RE = re.compile(
    r"\.add_(?:runtime_)?dependency\s*(?:\(?\s*)[\"'](?P<gem>[^\"']+)[\"']"
)


def run_git(*args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(ROOT), *args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def repository_name() -> str:
    remote = run_git("remote", "get-url", "origin")
    parsed = urlparse(remote)
    if parsed.scheme:
        path = parsed.path
    elif ":" in remote:
        path = remote.split(":", 1)[1]
    else:
        path = remote
    return path.strip("/").removesuffix(".git")


def tracked_paths() -> tuple[list[PurePosixPath], int]:
    output = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "-z"],
        check=True,
        capture_output=True,
    ).stdout
    listed = [PurePosixPath(item.decode()) for item in output.split(b"\0") if item]
    paths: list[PurePosixPath] = []
    missing = 0
    for path in listed:
        value = path.as_posix()
        if not value.startswith(SOURCE_PREFIXES):
            continue
        if any(part in EXCLUDED_PARTS for part in path.parts):
            continue
        suffix = Path(path.name).suffix.lower()
        if suffix not in LANGUAGES:
            continue
        if suffix == ".map":
            continue
        if not (ROOT / path).is_file():
            missing += 1
            continue
        paths.append(path)
    return sorted(paths, key=lambda item: item.as_posix()), missing


def layer_for(path: PurePosixPath) -> str:
    parts = path.parts
    if parts[0] == "app" and len(parts) > 1:
        return f"backend/{parts[1]}"
    if parts[:3] == ("frontend", "src", "app") and len(parts) > 3:
        return f"frontend/app/{parts[3]}"
    if parts[:3] == ("frontend", "src", "stimulus"):
        return "frontend/stimulus"
    if parts[:3] == ("frontend", "src", "react"):
        return "frontend/react"
    if parts[:3] == ("frontend", "src", "turbo"):
        return "frontend/turbo"
    if parts[:3] == ("lib", "api", "v3"):
        return "backend/api-v3"
    if parts[0] == "modules" and len(parts) > 1:
        return f"module/{parts[1]}"
    if parts[0] == "extensions" and len(parts) > 1:
        return f"extension/{parts[1]}"
    return parts[0]


def read_source(path: PurePosixPath) -> tuple[bytes, str]:
    raw = (ROOT / path).read_bytes()
    return raw, raw.decode("utf-8", errors="replace")


def normalize_posix(path: PurePosixPath) -> PurePosixPath:
    parts: list[str] = []
    for part in path.parts:
        if part == ".." and parts:
            parts.pop()
        elif part != ".":
            parts.append(part)
    return PurePosixPath(*parts)


def build_file_nodes(paths: list[PurePosixPath]) -> tuple[list[dict], dict[str, str]]:
    nodes = []
    source_text: dict[str, str] = {}
    for path in paths:
        raw, text = read_source(path)
        value = path.as_posix()
        language = LANGUAGES[Path(path.name).suffix.lower()]
        source_text[value] = text
        nodes.append(
            {
                "id": f"file:{value}",
                "type": "file",
                "path": value,
                "language": language,
                "layer": layer_for(path),
                "lines": text.count("\n") + (1 if text and not text.endswith("\n") else 0),
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
    return nodes, source_text


def resolve_js_import(source: str, target: str, known: set[str]) -> str | None:
    if target.startswith("core-app/"):
        base = PurePosixPath("frontend/src/app") / target.removeprefix("core-app/")
    elif target.startswith("./") or target.startswith("../"):
        base = PurePosixPath(source).parent / target
    else:
        return None
    normalized = normalize_posix(base)
    candidates = [normalized.as_posix()]
    if normalized.suffix:
        candidates.append(normalized.as_posix())
    else:
        candidates.extend(f"{normalized}{suffix}" for suffix in JS_EXTENSIONS)
        candidates.extend((normalized / f"index{suffix}").as_posix() for suffix in JS_EXTENSIONS)
    for candidate in candidates:
        if candidate in known:
            return candidate
    return None


def ruby_load_paths(paths: list[PurePosixPath]) -> dict[str, str]:
    result: dict[str, str] = {}
    for path in paths:
        value = path.as_posix()
        if Path(path.name).suffix.lower() not in RUBY_EXTENSIONS:
            continue
        candidates = [value]
        if value.startswith("lib/"):
            candidates.append(value.removeprefix("lib/"))
        if value.startswith("modules/") and "/lib/" in value:
            candidates.append(value.split("/lib/", 1)[1])
        for candidate in candidates:
            key = re.sub(r"\.(?:rb|rake|gemspec)$", "", candidate)
            result.setdefault(key, value)
    return result


def resolve_ruby_require(
    source: str,
    target: str,
    relative: bool,
    known: set[str],
    load_paths: dict[str, str],
) -> str | None:
    target = re.sub(r"\.rb$", "", target)
    if relative:
        candidate = normalize_posix(PurePosixPath(source).parent / target).as_posix()
        for value in (candidate, f"{candidate}.rb"):
            if value in known:
                return value
        return None
    return load_paths.get(target)


def build_import_edges(paths: list[PurePosixPath], source_text: dict[str, str]) -> list[dict]:
    known = {path.as_posix() for path in paths}
    load_paths = ruby_load_paths(paths)
    edges: set[tuple[str, str, str]] = set()
    for path in paths:
        source = path.as_posix()
        suffix = Path(path.name).suffix.lower()
        text = source_text[source]
        if suffix in JS_EXTENSIONS:
            for match in JS_IMPORT_RE.finditer(text):
                resolved = resolve_js_import(source, match.group(1), known)
                if resolved and resolved != source:
                    edges.add((source, resolved, "imports"))
        elif suffix in RUBY_EXTENSIONS:
            for match in RUBY_REQUIRE_RE.finditer(text):
                resolved = resolve_ruby_require(
                    source,
                    match.group("target"),
                    bool(match.group("relative")),
                    known,
                    load_paths,
                )
                if resolved and resolved != source:
                    edges.add((source, resolved, "requires"))
    return [
        {"source": f"file:{source}", "target": f"file:{target}", "type": edge_type}
        for source, target, edge_type in sorted(edges)
    ]


def module_metadata(file_nodes: list[dict]) -> tuple[list[dict], list[dict], dict[str, str]]:
    module_file = ROOT / "Gemfile.modules"
    modules: dict[str, str] = {}
    if module_file.is_file():
        for match in GEM_MODULE_RE.finditer(module_file.read_text(encoding="utf-8")):
            modules[match.group("path")] = match.group("gem")

    counts = Counter()
    for node in file_nodes:
        path = PurePosixPath(node["path"])
        if len(path.parts) > 1 and path.parts[0] == "modules":
            counts[path.parts[1]] += 1

    nodes = [
        {
            "id": f"module:{path}",
            "type": "module",
            "path": f"modules/{path}",
            "gem": gem,
            "files": counts[path],
        }
        for path, gem in sorted(modules.items())
    ]

    gem_to_path = {gem: path for path, gem in modules.items()}
    edges: set[tuple[str, str]] = set()
    for path in sorted(modules):
        for gemspec in sorted((ROOT / "modules" / path).glob("*.gemspec")):
            text = gemspec.read_text(encoding="utf-8", errors="replace")
            for match in GEM_DEPENDENCY_RE.finditer(text):
                target = gem_to_path.get(match.group("gem"))
                if target and target != path:
                    edges.add((path, target))
    return (
        nodes,
        [
            {"source": f"module:{source}", "target": f"module:{target}", "type": "depends_on"}
            for source, target in sorted(edges)
        ],
        modules,
    )


def count_prefix(file_nodes: list[dict], prefix: str) -> int:
    return sum(node["path"].startswith(prefix) for node in file_nodes)


def architecture_graph(file_nodes: list[dict], modules: dict[str, str], module_edges: list[dict]) -> dict:
    blue = "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;"
    green = "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;"
    orange = "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;"
    purple = "rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;"
    cylinder = "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;fillColor=#fff2cc;strokeColor=#d6b656;"

    def node(
        node_id: str,
        label: str,
        group: str,
        style: str = blue,
        width: int = 170,
        height: int = 60,
    ) -> dict:
        return {"id": node_id, "label": label, "group": group, "style": style, "width": width, "height": height}

    nodes = [
        node("browser", "Browser clients", "Clients", green),
        node("api_clients", "API / integration clients", "Clients", green),
        node("hotwire", f"Turbo + server-rendered UI\n{count_prefix(file_nodes, 'app/views/')} views", "Frontend", purple, 190),
        node("angular", f"Angular feature UI\n{count_prefix(file_nodes, 'frontend/src/app/')} files", "Frontend", purple, 190),
        node("stimulus", f"Stimulus controllers\n{count_prefix(file_nodes, 'frontend/src/stimulus/')} files", "Frontend", purple, 190),
        node("react", f"React islands\n{count_prefix(file_nodes, 'frontend/src/react/')} files", "Frontend", purple, 180),
        node("routes", "Rails routes + middleware", "Rails core", blue, 190),
        node("controllers", f"Controllers\n{count_prefix(file_nodes, 'app/controllers/')} files", "Rails core", blue),
        node("api_v3", f"Grape API v3\n{count_prefix(file_nodes, 'lib/api/v3/')} files", "Rails core", blue),
        node("components", f"ViewComponents\n{count_prefix(file_nodes, 'app/components/')} files", "Rails core", blue),
        node("services", f"Services\n{count_prefix(file_nodes, 'app/services/')} files", "Domain", orange),
        node("contracts", f"Contracts + forms\n{count_prefix(file_nodes, 'app/contracts/') + count_prefix(file_nodes, 'app/forms/')} files", "Domain", orange, 190),
        node("models", f"ActiveRecord models\n{count_prefix(file_nodes, 'app/models/')} files", "Domain", orange, 190),
        node("queries", f"Queries\n{count_prefix(file_nodes, 'app/models/queries/')} files", "Domain", orange),
        node("workers", f"GoodJob workers\n{count_prefix(file_nodes, 'app/workers/')} files", "Async", green, 180),
        node("plugin_runtime", "Rails engine plugin runtime", "Plugin modules", green, 190),
        node("hocuspocus_ext", f"BlockNote Hocuspocus\n{count_prefix(file_nodes, 'extensions/op-blocknote-hocuspocus/')} files", "Collaborative editing", green, 210),
        node("postgres", "PostgreSQL 17\napplication + GoodJob data", "Data services", cylinder, 210),
        node("memcached", "Memcached\nRails cache", "Data services", cylinder, 170),
        node("file_storage", "Attachment storage\nlocal or object storage", "Data services", cylinder, 210),
    ]

    module_counts = Counter()
    for item in file_nodes:
        path = PurePosixPath(item["path"])
        if len(path.parts) > 1 and path.parts[0] == "modules":
            module_counts[path.parts[1]] += 1
    module_groups = {
        "identity_access": (
            ("auth_plugins", "auth_saml", "openid_connect", "ldap_groups", "ldap_departments", "two_factor_authentication", "recaptcha"),
            "Identity & access\nauth, SAML, OIDC, LDAP, 2FA, reCAPTCHA",
        ),
        "planning": (
            ("backlogs", "boards", "calendar", "gantt", "resource_management", "team_planner"),
            "Planning\nbacklogs, boards, calendar, gantt, resources, team planner",
        ),
        "collaboration": (
            ("documents", "meeting", "storages", "wikis"),
            "Collaboration\ndocuments, meetings, storage, wikis",
        ),
        "finance_reporting": (
            ("budgets", "costs", "reporting", "xls_export"),
            "Finance & reporting\nbudgets, costs, reporting, XLS",
        ),
        "integrations": (
            ("github_integration", "gitlab_integration", "webhooks"),
            "Integrations\nGitHub, GitLab, webhooks",
        ),
        "workspace": (
            ("grids", "my_page", "overviews"),
            "Workspace UI\ngrids, my page, overviews",
        ),
        "platform": (
            ("avatars", "job_status"),
            "Platform UI\navatars, job status",
        ),
        "bim": (("bim",), "BIM / BCF"),
    }
    grouped_modules = {path for members, _ in module_groups.values() for path in members}
    leftovers = tuple(sorted(set(modules) - grouped_modules))
    if leftovers:
        module_groups["other"] = (leftovers, "Other modules\n" + ", ".join(leftovers))

    module_to_group: dict[str, str] = {}
    for group_id, (members, label) in module_groups.items():
        present = tuple(path for path in members if path in modules)
        if not present:
            continue
        module_to_group.update({path: group_id for path in present})
        file_count = sum(module_counts[path] for path in present)
        nodes.append(
            node(
                f"module_group_{group_id}",
                f"{label}\n{len(present)} modules / {file_count} files",
                "Plugin modules",
                green,
                260,
                100,
            )
        )

    edges = [
        {"source": "browser", "target": "routes", "label": "HTTPS"},
        {"source": "api_clients", "target": "api_v3", "label": "REST / HAL+JSON"},
        {"source": "routes", "target": "controllers", "label": "dispatch"},
        {"source": "routes", "target": "api_v3", "label": "/api/v3"},
        {"source": "controllers", "target": "hotwire", "label": "HTML / Turbo"},
        {"source": "controllers", "target": "components", "label": "render"},
        {"source": "hotwire", "target": "stimulus", "label": "enhance"},
        {"source": "hotwire", "target": "angular", "label": "custom elements"},
        {"source": "hotwire", "target": "react", "label": "React islands"},
        {"source": "angular", "target": "api_v3", "label": "API v3"},
        {"source": "stimulus", "target": "controllers", "label": "Turbo requests"},
        {"source": "controllers", "target": "services", "label": "commands"},
        {"source": "api_v3", "target": "services", "label": "endpoints"},
        {"source": "services", "target": "contracts", "label": "validate"},
        {"source": "services", "target": "models", "label": "write"},
        {"source": "queries", "target": "models", "label": "read"},
        {"source": "controllers", "target": "queries", "label": "read"},
        {"source": "services", "target": "workers", "label": "enqueue"},
        {"source": "workers", "target": "services", "label": "execute"},
        {"source": "models", "target": "postgres", "label": "ActiveRecord"},
        {"source": "workers", "target": "postgres", "label": "GoodJob"},
        {"source": "controllers", "target": "memcached", "label": "cache"},
        {"source": "services", "target": "file_storage", "label": "attachments"},
        {"source": "angular", "target": "hocuspocus_ext", "label": "collaborative editing"},
        {"source": "plugin_runtime", "target": "routes", "label": "registers routes"},
        {"source": "plugin_runtime", "target": "services", "label": "extends core"},
    ]
    for group_id in sorted(set(module_to_group.values())):
        edges.append({"source": f"module_group_{group_id}", "target": "plugin_runtime"})
    grouped_dependencies: set[tuple[str, str]] = set()
    for edge in module_edges:
        source = edge["source"].removeprefix("module:")
        target = edge["target"].removeprefix("module:")
        source_group = module_to_group.get(source)
        target_group = module_to_group.get(target)
        if source_group and target_group and source_group != target_group:
            grouped_dependencies.add((source_group, target_group))
    for source_group, target_group in sorted(grouped_dependencies):
        edges.append(
            {
                "source": f"module_group_{source_group}",
                "target": f"module_group_{target_group}",
                "label": "gem dependency",
            }
        )
    return {"direction": "LR", "nodes": nodes, "edges": edges}


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def source_tree_digest(file_nodes: list[dict]) -> str:
    digest = hashlib.sha256()
    for node in file_nodes:
        digest.update(node["path"].encode())
        digest.update(b"\0")
        digest.update(node["sha256"].encode())
        digest.update(b"\n")
    return digest.hexdigest()


def main() -> None:
    paths, missing = tracked_paths()
    file_nodes, source_text = build_file_nodes(paths)
    import_edges = build_import_edges(paths, source_text)
    module_nodes, module_edges, modules = module_metadata(file_nodes)
    commit = run_git("rev-parse", "HEAD")
    version_file = (ROOT / "lib/open_project/version.rb").read_text(encoding="utf-8")
    version_parts = {
        key.lower(): value
        for key, value in re.findall(r"^\s*(MAJOR|MINOR|PATCH)\s*=\s*(\d+)", version_file, re.MULTILINE)
    }
    version = ".".join(version_parts[key] for key in ("major", "minor", "patch"))
    graph = {
        "schema_version": 1,
        "repository": repository_name(),
        "base_commit": commit,
        "source_tree_sha256": source_tree_digest(file_nodes),
        "openproject_version": version,
        "scope": {
            "tracked_materialized_source_files": len(file_nodes),
            "tracked_source_files_missing_from_sparse_checkout": missing,
            "excluded": sorted(EXCLUDED_PARTS),
        },
        "nodes": file_nodes + module_nodes,
        "edges": import_edges + module_edges,
        "statistics": {
            "files_by_language": dict(sorted(Counter(node["language"] for node in file_nodes).items())),
            "files_by_layer": dict(sorted(Counter(node["layer"] for node in file_nodes).items())),
            "edge_types": dict(sorted(Counter(edge["type"] for edge in import_edges + module_edges).items())),
        },
        "limitations": [
            "Rails autoloaded constant references are not resolved.",
            "Dynamic imports, metaprogramming, and runtime dispatch are not resolved.",
            "Only source files present in the sparse working tree are indexed.",
        ],
    }
    write_json(FILE_GRAPH_PATH, graph)
    write_json(ARCH_GRAPH_PATH, architecture_graph(file_nodes, modules, module_edges))
    code_files = sum(node["language"] in CODE_LANGUAGES for node in file_nodes)
    print(
        f"wrote {FILE_GRAPH_PATH.relative_to(ROOT)} "
        f"({len(file_nodes)} files, {code_files} code files, {len(graph['edges'])} edges)"
    )
    print(f"wrote {ARCH_GRAPH_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
