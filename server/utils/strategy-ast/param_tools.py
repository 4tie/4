import ast
import json
import sys
import textwrap
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


def _parse_statement(src: str) -> ast.stmt:
    mod = ast.parse(textwrap.dedent(src))
    if len(mod.body) != 1:
        raise ValueError("Expected exactly one statement")
    st = mod.body[0]
    if not isinstance(st, ast.stmt):
        raise ValueError("Not a statement")
    return st


def _call_signature(call: ast.Call) -> Tuple[str, List[str], List[Tuple[str, str]]]:
    fn = call.func
    fn_name = fn.id if isinstance(fn, ast.Name) else fn.attr if isinstance(fn, ast.Attribute) else ""
    args_dump = [ast.dump(a, include_attributes=False) for a in call.args]
    kws_dump = []
    for k in call.keywords:
        if not isinstance(k, ast.keyword) or not k.arg:
            continue
        kws_dump.append((k.arg, ast.dump(k.value, include_attributes=False)))
    kws_dump.sort(key=lambda x: x[0])
    return fn_name, args_dump, kws_dump


def _validate_default_only(before_stmt: ast.stmt, after_stmt: ast.stmt) -> None:
    def normalize(st: ast.stmt) -> Tuple[str, ast.Call]:
        if isinstance(st, ast.Assign):
            targets = [_get_param_target_name(t) for t in st.targets]
            targets = [t for t in targets if t]
            if len(targets) != 1:
                raise ValueError("Assignment target must be a single name")
            if not isinstance(st.value, ast.Call):
                raise ValueError("Assigned value must be a call")
            return targets[0], st.value

        if isinstance(st, ast.AnnAssign):
            target = _get_param_target_name(st.target)
            if not target:
                raise ValueError("Assignment target must be a single name")
            if not isinstance(st.value, ast.Call):
                raise ValueError("Assigned value must be a call")
            return target, st.value

        raise ValueError("Only assignment statements are allowed")

    b_name, b_call = normalize(before_stmt)
    a_name, a_call = normalize(after_stmt)

    if b_name != a_name:
        raise ValueError("Assignment target must match")

    if not _is_param_call(b_call) or not _is_param_call(a_call):
        raise ValueError("Assigned value must be a Parameter(...) call")

    b_fn, b_args, b_kws = _call_signature(b_call)
    a_fn, a_args, a_kws = _call_signature(a_call)

    if b_fn != a_fn or b_args != a_args:
        raise ValueError("Parameter call signature (func/args) must not change")

    def strip_default(kws: List[Tuple[str, str]]) -> List[Tuple[str, str]]:
        return [(k, v) for (k, v) in kws if k != "default"]

    if strip_default(b_kws) != strip_default(a_kws):
        raise ValueError("Only the default= keyword may change")


def cmd_extract(file_path: str) -> None:
    src = open(file_path, "r", encoding="utf-8").read()
    tree = ast.parse(src)
    params = _extract_assignments(tree, src)
    sys.stdout.write(json.dumps({"params": params}, ensure_ascii=False))


def cmd_apply(file_path: str) -> None:
    src = open(file_path, "r", encoding="utf-8").read()
    tree = ast.parse(src)
    params = _extract_assignments(tree, src)
    by_name = {p["name"]: p for p in params}

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
            raise ValueError(f"unknown parameter: {name}")

        start = int(meta["line"]) - 1
        end = int(meta["endLine"])
        current_seg = "".join(lines[start:end])
        if current_seg != before:
            raise ValueError(f"before mismatch for {name}")

        b_stmt = _parse_statement(before)
        a_stmt = _parse_statement(after)
        _validate_default_only(b_stmt, a_stmt)

        new_lines = after.splitlines(keepends=True)
        lines[start:end] = new_lines

    new_src = "".join(lines)
    open(file_path, "w", encoding="utf-8").write(new_src)
    sys.stdout.write(json.dumps({"success": True}, ensure_ascii=False))


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("usage: param_tools.py <extract|apply> <strategy_file>")

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
    main()
