import ast
import json
import sys
import textwrap
from typing import Any, Dict, List, Optional, Tuple


_ALLOWED_ATTRS = {
    "stoploss",
    "trailing_stop",
    "trailing_stop_positive",
    "trailing_stop_positive_offset",
    "trailing_only_offset_is_reached",
}


def _get_target_name(node: ast.AST) -> Optional[str]:
    if isinstance(node, ast.Name):
        return node.id
    return None


def _safe_literal(node: ast.AST) -> Any:
    try:
        return ast.literal_eval(node)
    except Exception:
        return None


def _get_assignment(node: ast.AST) -> Optional[Tuple[str, ast.AST, int, int]]:
    if isinstance(node, ast.Assign):
        if len(node.targets) != 1:
            return None
        name = _get_target_name(node.targets[0])
        if not name or name not in _ALLOWED_ATTRS:
            return None
        lineno = getattr(node, "lineno", None)
        end_lineno = getattr(node, "end_lineno", lineno)
        if lineno is None or end_lineno is None:
            return None
        return name, node.value, int(lineno), int(end_lineno)

    if isinstance(node, ast.AnnAssign):
        name = _get_target_name(node.target)
        if not name or name not in _ALLOWED_ATTRS:
            return None
        if node.value is None:
            return None
        lineno = getattr(node, "lineno", None)
        end_lineno = getattr(node, "end_lineno", lineno)
        if lineno is None or end_lineno is None:
            return None
        return name, node.value, int(lineno), int(end_lineno)

    return None


def _find_strategy_class(tree: ast.Module) -> Optional[ast.ClassDef]:
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            return node
    return None


def _extract(tree: ast.Module, src: str) -> List[Dict[str, Any]]:
    cls = _find_strategy_class(tree)
    if not cls:
        return []

    lines = src.splitlines(keepends=True)
    out: List[Dict[str, Any]] = []

    for node in cls.body:
        parsed = _get_assignment(node)
        if not parsed:
            continue
        name, value_node, lineno, end_lineno = parsed
        value = _safe_literal(value_node)
        seg = "".join(lines[lineno - 1 : end_lineno])
        out.append(
            {
                "name": name,
                "line": lineno,
                "endLine": end_lineno,
                "value": value,
                "before": seg,
            }
        )

    out.sort(key=lambda x: int(x.get("line") or 0))
    return out


def _parse_statement(src: str) -> ast.stmt:
    mod = ast.parse(textwrap.dedent(src))
    if len(mod.body) != 1:
        raise ValueError("Expected exactly one statement")
    st = mod.body[0]
    if not isinstance(st, ast.stmt):
        raise ValueError("Not a statement")
    return st


def _normalize_assignment(st: ast.stmt) -> Tuple[str, ast.AST]:
    if isinstance(st, ast.Assign):
        if len(st.targets) != 1:
            raise ValueError("Assignment must have exactly one target")
        name = _get_target_name(st.targets[0])
        if not name:
            raise ValueError("Assignment target must be a name")
        return name, st.value

    if isinstance(st, ast.AnnAssign):
        name = _get_target_name(st.target)
        if not name:
            raise ValueError("Assignment target must be a name")
        if st.value is None:
            raise ValueError("Annotated assignment must have a value")
        return name, st.value

    raise ValueError("Only assignment statements are allowed")


def _validate_literal_change(before_stmt: ast.stmt, after_stmt: ast.stmt) -> None:
    b_name, b_value = _normalize_assignment(before_stmt)
    a_name, a_value = _normalize_assignment(after_stmt)

    if b_name != a_name:
        raise ValueError("Assignment target must match")

    if b_name not in _ALLOWED_ATTRS:
        raise ValueError("Attribute not allowed")

    if not isinstance(b_value, ast.Constant) or not isinstance(a_value, ast.Constant):
        raise ValueError("Only literal (constant) assignments are allowed")


def cmd_extract(file_path: str) -> None:
    src = open(file_path, "r", encoding="utf-8").read()
    tree = ast.parse(src)
    attrs = _extract(tree, src)
    sys.stdout.write(json.dumps({"attrs": attrs}, ensure_ascii=False))


def cmd_apply(file_path: str) -> None:
    src = open(file_path, "r", encoding="utf-8").read()
    tree = ast.parse(src)
    attrs = _extract(tree, src)
    by_name = {a["name"]: a for a in attrs}

    payload = json.loads(sys.stdin.read() or "{}")
    changes = payload.get("changes")
    if not isinstance(changes, list):
        raise ValueError("changes must be a list")

    lines = src.splitlines(keepends=True)

    for ch in changes:
        if not isinstance(ch, dict):
            raise ValueError("each change must be an object")
        name = str(ch.get("name") or "")
        before = ch.get("before")
        after = ch.get("after")
        if not name or not isinstance(before, str) or not isinstance(after, str):
            raise ValueError("change must include name, before, after")

        meta = by_name.get(name)
        if not meta:
            raise ValueError(f"unknown attribute: {name}")

        start = int(meta["line"]) - 1
        end = int(meta["endLine"])
        current_seg = "".join(lines[start:end])
        if current_seg != before:
            raise ValueError(f"before mismatch for {name}")

        b_stmt = _parse_statement(before)
        a_stmt = _parse_statement(after)
        _validate_literal_change(b_stmt, a_stmt)

        lines[start:end] = after.splitlines(keepends=True)

    new_src = "".join(lines)
    open(file_path, "w", encoding="utf-8").write(new_src)
    sys.stdout.write(json.dumps({"success": True}, ensure_ascii=False))


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("usage: attr_tools.py <extract|apply> <strategy_file>")

    action = sys.argv[1]
    file_path = sys.argv[2]

    if action == "extract":
        cmd_extract(file_path)
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
