import ast
import difflib
import json
import sys
from typing import Any, Dict, List, Optional, Tuple


def _is_param_call(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call):
        return False

    fn = node.func
    name = None
    if isinstance(fn, ast.Name):
        name = fn.id
    elif isinstance(fn, ast.Attribute):
        name = fn.attr

    if not name:
        return False

    return "Parameter" in name


def _safe_literal(node: ast.AST) -> Any:
    try:
        return ast.literal_eval(node)
    except Exception:
        return None


def _get_param_target_name(node: ast.AST) -> Optional[str]:
    if isinstance(node, ast.Name):
        return node.id
    return None


def _get_param_assignment(node: ast.AST) -> Optional[Tuple[str, ast.Call, int, int]]:
    if isinstance(node, ast.Assign):
        if not isinstance(node.value, ast.Call):
            return None
        if not _is_param_call(node.value):
            return None
        targets = [_get_param_target_name(t) for t in node.targets]
        targets = [t for t in targets if t]
        if len(targets) != 1:
            return None
        lineno = getattr(node, "lineno", None)
        end_lineno = getattr(node, "end_lineno", lineno)
        if lineno is None or end_lineno is None:
            return None
        return targets[0], node.value, int(lineno), int(end_lineno)

    if isinstance(node, ast.AnnAssign):
        if not isinstance(node.value, ast.Call):
            return None
        if not _is_param_call(node.value):
            return None
        target = _get_param_target_name(node.target)
        if not target:
            return None
        lineno = getattr(node, "lineno", None)
        end_lineno = getattr(node, "end_lineno", lineno)
        if lineno is None or end_lineno is None:
            return None
        return target, node.value, int(lineno), int(end_lineno)

    return None


def _extract_assignments(tree: ast.AST, source: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    for n in ast.walk(tree):
        parsed = _get_param_assignment(n)
        if not parsed:
            continue

        name, call, lineno, end_lineno = parsed
        fn = call.func
        fn_name = fn.id if isinstance(fn, ast.Name) else fn.attr if isinstance(fn, ast.Attribute) else ""

        kw = {k.arg: k.value for k in call.keywords if isinstance(k, ast.keyword) and k.arg}

        default_val = _safe_literal(kw.get("default")) if "default" in kw else None
        space_val = _safe_literal(kw.get("space")) if "space" in kw else None
        optimize_val = _safe_literal(kw.get("optimize")) if "optimize" in kw else None

        args = call.args
        a0 = _safe_literal(args[0]) if len(args) > 0 else None
        a1 = _safe_literal(args[1]) if len(args) > 1 else None

        lines = source.splitlines(keepends=True)
        seg = "".join(lines[lineno - 1 : end_lineno])

        out.append(
            {
                "name": name,
                "type": fn_name,
                "line": lineno,
                "endLine": end_lineno,
                "args": [a0, a1],
                "default": default_val,
                "space": space_val,
                "optimize": optimize_val,
                "before": seg,
            }
        )

    out.sort(key=lambda x: (int(x.get("line") or 0), x.get("name") or ""))
    return out


def _base_name(node: ast.expr) -> Optional[str]:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _index_classes(tree: ast.AST) -> List[Dict[str, Any]]:
    classes: List[Dict[str, Any]] = []
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        lineno = getattr(node, "lineno", None)
        end_lineno = getattr(node, "end_lineno", lineno)
        if lineno is None or end_lineno is None:
            continue
        bases = [_base_name(b) for b in node.bases]
        bases = [b for b in bases if b]
        methods: List[Dict[str, Any]] = []
        for child in node.body:
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                m_line = getattr(child, "lineno", None)
                m_end = getattr(child, "end_lineno", m_line)
                if m_line is None or m_end is None:
                    continue
                methods.append({"name": child.name, "line": int(m_line), "endLine": int(m_end)})
        classes.append(
            {
                "name": node.name,
                "line": int(lineno),
                "endLine": int(end_lineno),
                "bases": bases,
                "methods": methods,
            }
        )
    return classes


def _index_functions(tree: ast.AST) -> List[Dict[str, Any]]:
    fns: List[Dict[str, Any]] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            lineno = getattr(node, "lineno", None)
            end_lineno = getattr(node, "end_lineno", lineno)
            if lineno is None or end_lineno is None:
                continue
            fns.append({"name": node.name, "line": int(lineno), "endLine": int(end_lineno)})
    return fns


def _build_index(tree: ast.AST, source: str) -> Dict[str, Any]:
    classes = _index_classes(tree)
    functions = _index_functions(tree)
    params = _extract_assignments(tree, source)
    return {"classes": classes, "functions": functions, "params": params}


def _find_strategy_class(index: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    classes = index.get("classes") or []
    for cls in classes:
        if "IStrategy" in (cls.get("bases") or []):
            return cls
    if classes:
        return classes[0]
    return None


def _find_class(index: Dict[str, Any], name: str) -> Optional[Dict[str, Any]]:
    for cls in index.get("classes") or []:
        if cls.get("name") == name:
            return cls
    return None


def _find_param(index: Dict[str, Any], name: str) -> Optional[Dict[str, Any]]:
    for param in index.get("params") or []:
        if param.get("name") == name:
            return param
    return None


def _find_function(index: Dict[str, Any], name: str) -> Optional[Dict[str, Any]]:
    strategy = _find_strategy_class(index)
    if strategy:
        for method in strategy.get("methods") or []:
            if method.get("name") == name:
                return {"type": "method", "className": strategy.get("name"), **method}
    for cls in index.get("classes") or []:
        for method in cls.get("methods") or []:
            if method.get("name") == name:
                return {"type": "method", "className": cls.get("name"), **method}
    for fn in index.get("functions") or []:
        if fn.get("name") == name:
            return {"type": "function", **fn}
    return None


def _normalize_text(value: str) -> str:
    return value.replace("\r\n", "\n")


def _segment_matches(segment: str, before: str) -> bool:
    segment_norm = _normalize_text(segment)
    before_norm = _normalize_text(before)
    if segment_norm == before_norm:
        return True
    if segment_norm.rstrip("\n") == before_norm.rstrip("\n"):
        return True
    return False


def _resolve_replace_target(target: Dict[str, Any], index: Dict[str, Any], lines: List[str]) -> Tuple[int, int, str, str]:
    kind = str(target.get("kind") or "").strip()
    if kind == "function":
        name = str(target.get("name") or "").strip()
        if not name:
            raise ValueError("target name required for function")
        found = _find_function(index, name)
        if not found:
            raise ValueError(f"target-not-found: function {name}")
        start = int(found["line"])
        end = int(found["endLine"])
        segment = "".join(lines[start - 1 : end])
        label = f"function {name}"
        if found.get("type") == "method":
            label = f"method {found.get('className')}.{name}"
        return start, end, segment, label

    if kind == "class":
        name = str(target.get("name") or "").strip()
        if not name:
            raise ValueError("target name required for class")
        cls = _find_class(index, name)
        if not cls:
            raise ValueError(f"target-not-found: class {name}")
        start = int(cls["line"])
        end = int(cls["endLine"])
        segment = "".join(lines[start - 1 : end])
        return start, end, segment, f"class {name}"

    if kind == "param":
        name = str(target.get("name") or "").strip()
        if not name:
            raise ValueError("target name required for param")
        param = _find_param(index, name)
        if not param:
            raise ValueError(f"target-not-found: param {name}")
        start = int(param["line"])
        end = int(param["endLine"])
        segment = "".join(lines[start - 1 : end])
        return start, end, segment, f"param {name}"

    if kind == "range":
        start = int(target.get("startLine") or 0)
        end = int(target.get("endLine") or 0)
        if start < 1 or end < start or end > len(lines):
            raise ValueError("invalid-range")
        segment = "".join(lines[start - 1 : end])
        return start, end, segment, f"range {start}-{end}"

    raise ValueError("invalid target kind")


def _resolve_anchor(anchor: Dict[str, Any], index: Dict[str, Any], lines: List[str]) -> Tuple[int, str]:
    kind = str(anchor.get("kind") or "").strip()
    if kind == "after_function":
        name = str(anchor.get("name") or "").strip()
        if not name:
            raise ValueError("anchor name required for after_function")
        found = _find_function(index, name)
        if not found:
            raise ValueError(f"anchor-not-found: function {name}")
        return int(found["endLine"]), f"after function {name}"

    if kind == "after_imports":
        # Insert after module docstring + import block.
        # If there are no imports, insert after module docstring if present, otherwise at top.
        insert_at = 0
        try:
            current_src = "".join(lines)
            tree = ast.parse(current_src)

            doc_end = 0
            if tree.body:
                first = tree.body[0]
                if (
                    isinstance(first, ast.Expr)
                    and isinstance(getattr(first, "value", None), ast.Constant)
                    and isinstance(getattr(first.value, "value", None), str)
                ):
                    doc_end = int(getattr(first, "end_lineno", getattr(first, "lineno", 1)) or 1)

            last_import_end = 0
            for node in tree.body:
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    last_import_end = int(getattr(node, "end_lineno", getattr(node, "lineno", 1)) or 1)
                    continue
                # stop scanning once we leave the initial import section
                if last_import_end > 0:
                    break

            insert_at = max(doc_end, last_import_end)
        except Exception:
            insert_at = 0

        # _resolve_anchor expects a 0-based splice index for `lines[insert_at:insert_at]`.
        # `insert_at` above is 1-based end_lineno, so it's already the correct slice index.
        return insert_at, "after imports"

    if kind == "class_end":
        name = str(anchor.get("name") or "").strip()
        cls = _find_class(index, name) if name else _find_strategy_class(index)
        if not cls:
            raise ValueError("anchor-not-found: class")
        return int(cls["endLine"]), f"end of class {cls.get('name')}"

    if kind == "module_end":
        return len(lines), "end of module"

    if kind == "heuristic_indicators":
        strategy = _find_strategy_class(index)
        if strategy:
            for method in strategy.get("methods") or []:
                if method.get("name") == "populate_indicators":
                    return int(method["endLine"]), "after populate_indicators"
            return int(strategy["endLine"]), f"end of class {strategy.get('name')}"
        return len(lines), "end of module"

    raise ValueError("invalid anchor kind")


def _ensure_trailing_newline(content: str, must_terminate: bool) -> str:
    if must_terminate and content and not content.endswith("\n"):
        return content + "\n"
    return content


def _apply_edits(src: str, edits: List[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]]]:
    lines = src.splitlines(keepends=True)
    applied: List[Dict[str, Any]] = []

    for edit in edits:
        if not isinstance(edit, dict):
            raise ValueError("each edit must be an object")
        kind = str(edit.get("kind") or "").strip()

        current_src = "".join(lines)
        tree = ast.parse(current_src)
        index = _build_index(tree, current_src)

        if kind == "replace":
            target = edit.get("target")
            before = edit.get("before")
            after = edit.get("after")
            if not isinstance(target, dict):
                raise ValueError("replace edits require target")
            if not isinstance(before, str) or not isinstance(after, str):
                raise ValueError("replace edits require before/after strings")

            start, end, segment, label = _resolve_replace_target(target, index, lines)
            if not _segment_matches(segment, before):
                raise ValueError(f"before mismatch for {label}")

            lines[start - 1 : end] = after.splitlines(keepends=True)
            applied.append({"kind": "replace", "target": target, "startLine": start, "endLine": end})
            continue

        if kind == "insert":
            anchor = edit.get("anchor")
            content = edit.get("after") if isinstance(edit.get("after"), str) else edit.get("content")
            if not isinstance(anchor, dict):
                raise ValueError("insert edits require anchor")
            if not isinstance(content, str):
                raise ValueError("insert edits require content")

            insert_at, label = _resolve_anchor(anchor, index, lines)
            content = _ensure_trailing_newline(content, insert_at < len(lines))
            insert_lines = content.splitlines(keepends=True)
            lines[insert_at:insert_at] = insert_lines
            applied.append({"kind": "insert", "anchor": anchor, "line": insert_at + 1, "label": label})
            continue

        raise ValueError("invalid edit kind")

    return "".join(lines), applied


def _diff_text(before: str, after: str) -> str:
    before_lines = before.splitlines()
    after_lines = after.splitlines()
    diff = difflib.unified_diff(before_lines, after_lines, fromfile="before", tofile="after", lineterm="")
    return "\n".join(diff)


def cmd_index(file_path: str) -> None:
    src = open(file_path, "r", encoding="utf-8").read()
    tree = ast.parse(src)
    index = _build_index(tree, src)
    sys.stdout.write(json.dumps(index, ensure_ascii=False))


def cmd_apply(file_path: str) -> None:
    src = open(file_path, "r", encoding="utf-8").read()
    payload = json.loads(sys.stdin.read() or "{}")
    edits = payload.get("edits")
    if not isinstance(edits, list):
        raise ValueError("edits must be a list")
    dry_run = bool(payload.get("dryRun"))

    new_src, applied = _apply_edits(src, edits)
    diff = _diff_text(src, new_src)

    if not dry_run:
        open(file_path, "w", encoding="utf-8").write(new_src)

    sys.stdout.write(
        json.dumps(
            {
                "success": True,
                "dryRun": dry_run,
                "diff": diff,
                "content": new_src,
                "applied": applied,
            },
            ensure_ascii=False,
        )
    )


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("usage: edit_tools.py <index|apply> <strategy_file>")

    action = sys.argv[1]
    file_path = sys.argv[2]

    if action == "index":
        cmd_index(file_path)
        return

    if action == "apply":
        cmd_apply(file_path)
        return

    raise SystemExit("unknown action")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stderr.write(str(exc))
        sys.exit(1)
