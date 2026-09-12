#!/usr/bin/env python3
"""Export this static site as one offline HTML file. Python 3.9+, no dependencies."""
from __future__ import annotations
import argparse
import base64
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MIME = {'.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png'}


def export(destination: Path) -> None:
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    css = (ROOT / 'assets/styles.css').read_text(encoding='utf-8')
    js = (ROOT / 'assets/main.js').read_text(encoding='utf-8')
    html = html.replace('<link rel="stylesheet" href="assets/styles.css">', '<style>\n' + css + '\n</style>')
    html = html.replace('<script src="assets/main.js" defer></script>', '')
    # Inline classic scripts do not honor defer. Run after the document instead.
    html = html.replace('</body>', '<script>\n' + js + '\n</script>\n</body>')
    html = re.sub(r'\s*<link rel="manifest"[^>]+>', '', html)
    html = re.sub(r'\s+srcset="[^"]+"', '', html)
    html = re.sub(r'\s+sizes="\(max-width:[^"]+"', '', html)
    for path in (ROOT / 'assets').rglob('*'):
        if path.is_file() and path.suffix in MIME:
            relative = path.relative_to(ROOT).as_posix()
            quoted_reference = '"' + relative + '"'
            if quoted_reference in html:
                data = base64.b64encode(path.read_bytes()).decode('ascii')
                html = html.replace(quoted_reference, f'"data:{MIME[path.suffix]};base64,{data}"')
    # A downloadable fallback avoids top-level data-URL navigation restrictions.
    html = html.replace('data-photo-open aria-label=', 'data-photo-open download="iit-bombay-convocation.webp" aria-label=')
    if re.search(r'(?:src|href)="assets/', html):
        raise ValueError('An asset reference could not be embedded.')
    if destination.resolve() == (ROOT / 'index.html').resolve():
        raise ValueError('Refusing to overwrite the editable index.html.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(html, encoding='utf-8')
    print(f'Exported {destination} ({destination.stat().st_size:,} bytes).')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT.parent / 'rohit-pachar.html')
    args = parser.parse_args()
    try:
        export(args.output.expanduser())
    except (OSError, ValueError) as error:
        print(f'Export failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
