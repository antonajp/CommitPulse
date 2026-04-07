#!/usr/bin/env python3
"""
compare_permsets.py

Compare two Salesforce permissionset-meta.xml files and report differences.

Usage:
    python compare_permsets.py <file1.permissionset-meta.xml> <file2.permissionset-meta.xml>

Output sections:
  - Only in FILE1 / Only in FILE2
  - In both but with different values
  - Summary counts
"""

import sys
import xml.etree.ElementTree as ET
from collections import defaultdict


# Tags that represent collections of named items (keyed by a child element).
# Format: tag_name -> key_child_element
KEYED_COLLECTIONS = {
    "applicationVisibilities":  "application",
    "classAccesses":            "apexClass",
    "customPermissions":        "name",
    "fieldPermissions":         "field",
    "flowAccesses":             "flow",
    "objectPermissions":        "object",
    "pageAccesses":             "apexPage",
    "recordTypeVisibilities":   "recordType",
    "tabSettings":              "tab",
    "userPermissions":          "name",
}

# Tags whose text value is a simple scalar (single occurrence, no key).
SCALAR_TAGS = {
    "label", "description", "license", "hasActivationRequired",
    "isOwnedByProfile",
}


def strip_ns(tag: str) -> str:
    """Remove XML namespace from a tag."""
    return tag.split("}")[-1] if "}" in tag else tag


def parse_file(path: str):
    """Return (scalars dict, collections dict) for a permission set XML."""
    tree = ET.parse(path)
    root = tree.getroot()

    scalars = {}
    collections = defaultdict(dict)   # {tag: {key: {attr: value, ...}}}

    for child in root:
        tag = strip_ns(child.tag)

        if tag in SCALAR_TAGS:
            scalars[tag] = (child.text or "").strip()

        elif tag in KEYED_COLLECTIONS:
            key_field = KEYED_COLLECTIONS[tag]
            key_el = child.find(key_field)
            # Try namespace-stripped search if direct lookup fails
            if key_el is None:
                key_el = next(
                    (c for c in child if strip_ns(c.tag) == key_field), None
                )
            if key_el is None:
                continue
            key = (key_el.text or "").strip()
            attrs = {}
            for attr_el in child:
                attr_tag = strip_ns(attr_el.tag)
                if attr_tag != key_field:
                    attrs[attr_tag] = (attr_el.text or "").strip()
            collections[tag][key] = attrs

        else:
            # Unknown/unhandled tag — capture as raw text for completeness
            scalars[f"[unknown] {tag}"] = (child.text or "").strip()

    return scalars, dict(collections)


def compare_scalars(s1, s2, name1, name2):
    rows = []
    all_keys = sorted(set(s1) | set(s2))
    for k in all_keys:
        v1, v2 = s1.get(k), s2.get(k)
        if v1 is None:
            rows.append(("ONLY_IN_2", k, "", v2))
        elif v2 is None:
            rows.append(("ONLY_IN_1", k, v1, ""))
        elif v1 != v2:
            rows.append(("CHANGED", k, v1, v2))
    return rows


def compare_collections(c1, c2):
    """Return list of (status, section, key, detail) tuples."""
    rows = []
    all_sections = sorted(set(c1) | set(c2))

    for section in all_sections:
        d1 = c1.get(section, {})
        d2 = c2.get(section, {})
        all_keys = sorted(set(d1) | set(d2))

        for key in all_keys:
            a1 = d1.get(key)
            a2 = d2.get(key)

            if a1 is None:
                rows.append(("ONLY_IN_2", section, key, a2))
            elif a2 is None:
                rows.append(("ONLY_IN_1", section, key, a1))
            elif a1 != a2:
                # Find which attribute(s) changed
                changed_attrs = {
                    k: (a1.get(k, "<missing>"), a2.get(k, "<missing>"))
                    for k in sorted(set(a1) | set(a2))
                    if a1.get(k) != a2.get(k)
                }
                rows.append(("CHANGED", section, key, changed_attrs))

    return rows


def format_attrs(attrs: dict) -> str:
    return ", ".join(f"{k}={v}" for k, v in sorted(attrs.items()))


def print_report(scalar_diffs, coll_diffs, name1, name2):
    label1 = f"FILE1 ({name1})"
    label2 = f"FILE2 ({name2})"
    sep = "─" * 80

    # ── Scalar / metadata fields ──────────────────────────────────────────────
    print(f"\n{'═' * 80}")
    print("  METADATA FIELDS")
    print(f"{'═' * 80}")
    if not scalar_diffs:
        print("  (no differences)\n")
    else:
        for status, key, v1, v2 in scalar_diffs:
            if status == "ONLY_IN_1":
                print(f"  ONLY IN {label1}: {key} = {v1!r}")
            elif status == "ONLY_IN_2":
                print(f"  ONLY IN {label2}: {key} = {v2!r}")
            else:
                print(f"  CHANGED: {key}")
                print(f"    {label1}: {v1!r}")
                print(f"    {label2}: {v2!r}")
        print()

    # ── Collection diffs by status ────────────────────────────────────────────
    for status_filter, heading in [
        ("ONLY_IN_1", f"ONLY IN {label1}"),
        ("ONLY_IN_2", f"ONLY IN {label2}"),
        ("CHANGED",   "IN BOTH BUT DIFFERENT"),
    ]:
        subset = [r for r in coll_diffs if r[0] == status_filter]
        print(f"\n{'═' * 80}")
        print(f"  {heading}  ({len(subset)} item(s))")
        print(f"{'═' * 80}")

        if not subset:
            print("  (none)\n")
            continue

        current_section = None
        for _, section, key, detail in subset:
            if section != current_section:
                print(f"\n  [{section}]")
                current_section = section

            if status_filter == "CHANGED":
                print(f"    {key}")
                for attr, (old, new) in sorted(detail.items()):
                    print(f"      {attr}:  {label1}={old!r}  →  {label2}={new!r}")
            else:
                print(f"    {key}  →  {format_attrs(detail)}")

        print()

    # ── Summary ───────────────────────────────────────────────────────────────
    only1  = sum(1 for r in coll_diffs if r[0] == "ONLY_IN_1")
    only2  = sum(1 for r in coll_diffs if r[0] == "ONLY_IN_2")
    changed = sum(1 for r in coll_diffs if r[0] == "CHANGED")
    total  = only1 + only2 + changed + len(scalar_diffs)

    print(f"{'═' * 80}")
    print(f"  SUMMARY")
    print(f"{'═' * 80}")
    print(f"  Total differences   : {total}")
    print(f"  Metadata fields     : {len(scalar_diffs)}")
    print(f"  Only in {label1}: {only1}")
    print(f"  Only in {label2}: {only2}")
    print(f"  Changed (in both)   : {changed}")
    print(f"{'═' * 80}\n")


def main():
    if len(sys.argv) != 3:
        print("Usage: python compare_permsets.py <file1> <file2>")
        sys.exit(1)

    path1, path2 = sys.argv[1], sys.argv[2]

    try:
        s1, c1 = parse_file(path1)
        s2, c2 = parse_file(path2)
    except ET.ParseError as e:
        print(f"XML parse error: {e}")
        sys.exit(1)
    except FileNotFoundError as e:
        print(f"File not found: {e}")
        sys.exit(1)

    name1 = path1.split("/")[-1]
    name2 = path2.split("/")[-1]

    scalar_diffs = compare_scalars(s1, s2, name1, name2)
    coll_diffs   = compare_collections(c1, c2)

    if not scalar_diffs and not coll_diffs:
        print("\n✓ Permission sets are identical.\n")
    else:
        print_report(scalar_diffs, coll_diffs, name1, name2)


if __name__ == "__main__":
    main()
