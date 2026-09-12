# Verification notes

## Results

**55 / 55 browser checks passed.** The separate dependency-free repository checker also passed all 57 local references, plus the document and metadata checks. JavaScript passed `node --check`.

Testing used headless Chromium 144.0.7559.96 on Linux. The browser rendered the self-contained HTML exported directly from this repository's HTML, CSS, JavaScript, and images. Because local URL navigation was restricted in the execution environment, the document was loaded in memory; this is not a claim of a live Vercel or local-HTTP deployment test.

## Layout checks

Checked widths: **320, 360, 390, 600, 700, 768, 900, 1024, 1280, 1440, and 1920 pixels**.

At every width, the document had no horizontal page overflow and the main headings fit. Desktop and mobile captures were visually reviewed. The main sections, project cards, timeline, contact area, and portrait were inspected. The 1200 × 630 social sharing image was generated from matching HTML art direction.

## Browser behavior checks

| Area | Result |
| --- | --- |
| Mobile menu | Starts collapsed; opens; closes with Escape and an anchor selection |
| Keyboard focus | Menu focus returns on Escape; photo focus returns when the dialog closes |
| Anchor navigation | Reaches the requested section and updates the active-navigation marker |
| Four expandable stories | Each opens and closes using the keyboard |
| Photo viewer | Loads the full photo; closes by Escape, close button, and backdrop |
| Reading progress | Reaches 100% at the end of the page |
| Reduced motion | Reveal initialization is skipped and transitions are disabled |
| Default motion | Below-fold elements reveal on entering the viewport |
| JavaScript disabled | Navigation stays visible, stories work, and content is not hidden |
| Clipboard control | Success and denied-permission branches checked with a controlled API stub |
| Browser errors | No JavaScript runtime errors in the checked document |
| Runtime requests | No external HTTP/HTTPS asset requests in the rendered standalone document |
| Custom 404 | Fits a 390-pixel viewport |

The clipboard test checked the application's response logic, not access to the host operating system's actual clipboard. On the deployed site, the browser and visitor's permissions determine whether copying is allowed. Failure is reported honestly and the ordinary LinkedIn link remains available.

## Repository checks

The included `scripts/check_site.py` verifies local resources and anchors, unique IDs, one main heading per HTML document, language/viewport metadata, image descriptions, safe new-tab links, structured-data JSON, manifest icon references, JSON/XML syntax, placeholder absence, the social-cover file, and absence of bundled font files.

Images use local WebP files. Exported photographs do not include the original embedded EXIF metadata. No API keys, environment files, framework runtime, font files, or package dependencies are included.

## Not claimed

This is not a manual screen-reader audit, a Lighthouse score, a formal WCAG certification, or a cross-engine Safari/Firefox test. The Vercel configuration has not been exercised in the owner's hosting account. External destination availability, biography claims, photo permission, current job wording, and historical film metrics were not independently verified. See `CONTENT.md` for provenance and the pre-launch review notes.

## Repeat the local checks

```sh
python3 scripts/check_site.py
```

Optional JavaScript syntax check, when Node.js is installed:

```sh
node --check assets/main.js
```

These checks are optional development tools, not deployment requirements.
