#!/usr/bin/env python3
"""Check static HTML references, semantics, and metadata. No third-party packages."""
from __future__ import annotations
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.refs: list[str] = []
        self.errors: list[str] = []
        self.h1_count = 0
        self.lang = False
        self.viewport = False
        self.description = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if attr.get('id'):
            self.ids.append(attr['id'])
        for key in ('src', 'href'):
            if attr.get(key):
                self.refs.append(attr[key])
        if attr.get('srcset'):
            self.refs.extend(part.strip().split()[0] for part in attr['srcset'].split(','))
        if tag == 'html':
            self.lang = bool(attr.get('lang'))
        if tag == 'h1':
            self.h1_count += 1
        if tag == 'img' and 'alt' not in attr:
            self.errors.append('Image missing alt attribute.')
        if tag == 'a' and attr.get('target') == '_blank':
            rel = (attr.get('rel') or '').split()
            if 'noopener' not in rel:
                self.errors.append('New-tab link is missing rel=noopener.')
        if tag == 'meta' and attr.get('name') == 'viewport':
            self.viewport = True
        if tag == 'meta' and attr.get('name') == 'description':
            self.description = bool(attr.get('content'))


def main() -> int:
    errors: list[str] = []
    count = 0
    for file in ROOT.glob('*.html'):
        source = file.read_text(encoding='utf-8')
        parsed = Page()
        parsed.feed(source)
        errors.extend(f'{file.name}: {e}' for e in parsed.errors)
        if parsed.h1_count != 1:
            errors.append(f'{file.name}: Expected exactly one h1, got {parsed.h1_count}.')
        if not parsed.lang or not parsed.viewport:
            errors.append(f'{file.name}: Missing language or viewport metadata.')
        if file.name == 'index.html' and not parsed.description:
            errors.append('index.html: Missing search description.')
        for name, number in Counter(parsed.ids).items():
            if number > 1:
                errors.append(f'{file.name}: Duplicate ID {name!r}.')
        for ref in parsed.refs:
            url = urlsplit(ref)
            if url.scheme or url.netloc:
                continue
            count += 1
            if not url.path:
                if url.fragment and unquote(url.fragment) not in parsed.ids:
                    errors.append(f'{file.name}: Missing anchor #{url.fragment}.')
                continue
            path = (ROOT / unquote(url.path).lstrip('/')) if url.path.startswith('/') else (file.parent / unquote(url.path))
            if path.is_dir():
                path = path / 'index.html'
            if not path.is_file():
                errors.append(f'{file.name}: Missing local resource {ref!r}.')
        if '{{' in source or re.search(r'lorem ipsum', source, re.I):
            errors.append(f'{file.name}: Unresolved placeholder content.')
        for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', source, re.S):
            try:
                json.loads(block)
            except json.JSONDecodeError as error:
                errors.append(f'{file.name}: Invalid structured-data JSON: {error}.')
    for name in ('vercel.json', 'site.webmanifest'):
        try:
            data = json.loads((ROOT / name).read_text(encoding='utf-8'))
            if name == 'site.webmanifest':
                for icon in data.get('icons', []):
                    if not (ROOT / icon['src']).is_file():
                        errors.append(f'{name}: Missing icon {icon["src"]}.')
        except (OSError, json.JSONDecodeError) as error:
            errors.append(f'{name}: {error}.')
    try:
        ET.parse(ROOT / 'sitemap.xml')
    except (OSError, ET.ParseError) as error:
        errors.append(f'sitemap.xml: {error}.')
    if not (ROOT / 'assets/images/social-cover.jpg').is_file():
        errors.append('Missing social sharing image.')
    forbidden = list(ROOT.rglob('*.woff*')) + list(ROOT.rglob('*.ttf')) + list(ROOT.rglob('*.otf'))
    if forbidden:
        errors.append('Unexpected bundled font files.')
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print(f'PASS: {count} local references, document headings, IDs, image descriptions, and JSON/XML metadata.')
    print('External sites and the actual hosting platform are not contacted by this check.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
