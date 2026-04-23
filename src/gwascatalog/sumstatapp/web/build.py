#!/usr/bin/env python3
"""
Build script for the GWAS Catalog web validator.

Builds the sumstatlib wheel and copies it into the web app's dist/ directory,
then starts a local development server.

Usage:
    python build.py          # build only
    python build.py --serve  # build and start dev server on port 8000
"""

from __future__ import annotations

import argparse
import http.server
import shutil
import subprocess
import sys
from pathlib import Path

# Paths relative to this script
WEB_DIR = Path(__file__).parent
PROJECT_ROOT = WEB_DIR.parents[3]  # gwas-pysumstats/
SUMSTATLIB_DIR = PROJECT_ROOT / "sumstatlib"
DIST_DIR = WEB_DIR / "dist"

DEFAULT_PORT = 8000


def build_wheel() -> Path:
    """Build the sumstatlib wheel and return the path to the .whl file."""
    print("📦 Building sumstatlib wheel…")
    # uv build places wheels in <workspace-root>/dist/ by default
    subprocess.run(
        ["uv", "build", "--wheel", "--package", "gwascatalog-sumstatlib"],
        cwd=PROJECT_ROOT,
        check=True,
    )

    # Find the built wheel (uv puts it in project root dist/)
    wheels = list((PROJECT_ROOT / "dist").glob("gwascatalog_sumstatlib-*.whl"))
    if not wheels:
        print("❌ No wheel found in dist/", file=sys.stderr)
        sys.exit(1)

    wheel = sorted(wheels)[-1]  # latest by name
    print(f"   Built: {wheel.name}")
    return wheel


def copy_wheel(wheel: Path) -> None:
    """Copy the wheel into the web app's dist/ directory."""
    DIST_DIR.mkdir(exist_ok=True)

    # Remove old wheels
    for old in DIST_DIR.glob("gwascatalog_sumstatlib-*.whl"):
        old.unlink()

    dest = DIST_DIR / wheel.name
    shutil.copy2(wheel, dest)
    print(f"   Copied to: {dest.relative_to(PROJECT_ROOT)}")

    # Write the wheel filename to a text file for the web worker to discover
    (DIST_DIR / "wheel.txt").write_text(wheel.name, encoding="utf-8")
    print(f"   Updated: {DIST_DIR.relative_to(PROJECT_ROOT)}/wheel.txt")


def copy_to_dir(target: Path, base_path: str | None = None) -> None:
    """Copy the web app (including built dist/) into *target* for static hosting.

    If *base_path* is given (e.g. ``"/validator/"``) a ``<base href>`` tag is
    injected into the copied ``index.html`` so that all relative URLs resolve
    correctly even when the page is reached without a trailing slash.
    """
    EXCLUDE = {".gitignore", ".DS_Store", "README.md", "__pycache__"}

    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)

    for item in WEB_DIR.iterdir():
        if item.name in EXCLUDE:
            continue
        dest = target / item.name
        if item.is_dir():
            shutil.copytree(item, dest, ignore=shutil.ignore_patterns(*EXCLUDE))
        else:
            shutil.copy2(item, dest)

    if base_path:
        _inject_base_href(target / "index.html", base_path)

    print(f"   Staged web app → {target}")


def _inject_base_href(html_file: Path, base_path: str) -> None:
    """Insert ``<base href='...'>`` as the first child of ``<head>``."""
    # Normalise: must start and end with /
    href = "/" + base_path.strip("/") + "/"
    tag = f'  <base href="{href}">\n'
    text = html_file.read_text(encoding="utf-8")
    # Insert immediately after the opening <head> tag
    patched = text.replace("<head>\n", f"<head>\n{tag}", 1)
    if patched == text:
        # Fallback: <head> without a trailing newline
        patched = text.replace("<head>", f"<head>\n{tag}", 1)
    html_file.write_text(patched, encoding="utf-8")
    print(f'   Injected <base href="{href}"> into {html_file.name}')


def serve(port: int) -> None:
    """Start a local HTTP server for development."""
    print(f"\n🌐 Serving at http://localhost:{port}")
    print(f"   Root: {WEB_DIR}")
    print("   Press Ctrl+C to stop\n")

    handler = http.server.SimpleHTTPRequestHandler
    # Serve from the web directory
    import os

    os.chdir(WEB_DIR)

    with http.server.HTTPServer(("", port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 Server stopped")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and serve the web validator")
    parser.add_argument(
        "--serve",
        action="store_true",
        help="Start a development server after building",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port for the development server (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip building the wheel (use existing dist/)",
    )
    parser.add_argument(
        "--copy-to",
        metavar="DIR",
        help="Copy the built web app into DIR (e.g. for static hosting in a "
        "Docusaurus site)",
    )
    parser.add_argument(
        "--base-path",
        metavar="PATH",
        help="URL path the app will be served from (e.g. /validator/). "
        "Injects a <base href> tag so relative assets resolve correctly "
        "when accessed without a trailing slash.",
    )
    args = parser.parse_args()

    if not args.skip_build:
        wheel = build_wheel()
        copy_wheel(wheel)
        print("✅ Build complete\n")
    else:
        print("⏭️  Skipping build (using existing dist/)\n")

    if args.copy_to:
        copy_to_dir(Path(args.copy_to).resolve(), base_path=args.base_path)
        print("✅ Web app staged\n")

    if args.serve:
        serve(args.port)


if __name__ == "__main__":
    main()
