# Rohit Pachar — A life in progress

A complete, static personal website. Warm paper, forest-green ink, oversized serif type, photographic details, and a little room for play.

**No framework. No npm install. No build step. No environment variables.**

## Preview

Open `index.html` in your browser. The page, photographs, navigation, and expandable stories are local files.

For an HTTP preview, run this from the repository directory:

```sh
python3 -m http.server 3000 --bind 127.0.0.1
```

Then open `http://localhost:3000`. On Windows, use `py -m http.server 3000 --bind 127.0.0.1` when `python3` is unavailable. The clipboard control is shown only when a secure-context clipboard API is available; it is not essential to contacting Rohit.

## Publish on Vercel

Commit this folder's contents to your Git repository, then import that repository in Vercel. Select the directory containing `index.html` as the project root.

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Root directory | The directory containing `index.html` |
| Build command | Empty / no build |
| Output directory | `.` |
| Install command | None required |
| Environment variables | None |

The included `vercel.json` sets the framework to none, skips the build, serves the root, and adds basic security and cache-revalidation headers. Do not add an SPA catch-all rewrite: this is a normal static page, and `404.html` is the intended not-found page.

This project has not been deployed to an account on your behalf. Vercel's official static-site instructions are at `https://vercel.com/docs/builds/configure-a-build#skip-build-step`.

### Optional initial Git commands

Create an empty GitHub repository, then run:

```sh
git init
git add .
git commit -m "Build Rohit Pachar's personal website"
git branch -M main
git remote add origin YOUR_GIT_REPOSITORY_URL
git push -u origin main
```

Replace `YOUR_GIT_REPOSITORY_URL` with the remote URL supplied by your Git provider. An existing repository only needs the add, commit, and push steps.

## What's inside

```text
index.html                   All public copy, sections, links, metadata
404.html                     A matching, self-contained not-found page
assets/
  styles.css                 Design tokens, layouts, responsive rules, print styles
  main.js                    Small, optional interaction layer
  brand/                     SVG favicon and PNG app/home-screen icons
  images/
    rohit-portrait-480.webp   Small-screen portrait
    rohit-portrait-960.webp   High-resolution portrait
    convocation.webp         Full photograph for the viewer
    social-cover.jpg         1200 × 630 social sharing image
robots.txt
sitemap.xml
site.webmanifest
vercel.json
scripts/
  check_site.py              Dependency-free local asset and HTML checks
  export_single_file.py      Export an all-in-one, offline HTML copy
CONTENT.md                   Source provenance and editorial review notes
QA.md                        What was actually checked
```

## Edit the content

All copy is normal HTML in `index.html`, grouped by section comments:

- **00 / Introduction:** headline, current role, portrait, location.
- **01 / Work:** TechMonk, Closelooped, Build on the Go, and the expandable stories.
- **02 / Film:** Silverscreen, the film archive, and clearly attributed club milestones.
- **03 / Background:** Rajasthan, IIT Bombay, school history, and working principles.
- **04 / Contact:** the real social links provided in the original profile.

The source remains the editable version. There is no hidden CMS, content API, account, or database to configure.

### Change the design

The `:root` block at the top of `assets/styles.css` contains the colors, fonts, spacing, and content width. The page uses Georgia plus system sans-serif and monospace fallbacks. No font files are bundled or downloaded; appearance can vary slightly with the device's installed fonts.

### Change the photograph

Replace the two portrait WebP files with the same 4:5 aspect ratio. Update their dimensions and `srcset` in `index.html` when changing sizes. Replace `convocation.webp` for the full-photo view, and edit the image descriptions and caption to match. The supplied photo has been cropped and optimized; its embedded metadata is not included in the exported WebP files.

### Change the domain

The canonical URL, social image URLs, structured data, `robots.txt`, and `sitemap.xml` use `https://rohitpachar.com` from the source website. Replace that domain in those files before publishing under a different permanent domain. Update `social-cover.jpg` when changing the main name or headline.

### Contact behavior

The contact section links directly to LinkedIn, Instagram, X, and YouTube. It does not collect visitor data or pretend to send a message. No email address was supplied, so no guessed email or dummy contact form was added.

## Interaction details

The compact navigation, active-section indicator, reading-progress line, photograph viewer, entrance effects, and clipboard button are progressive enhancements. Story disclosure uses native HTML `details` / `summary`, so it also works without JavaScript. The full photo remains a real image link when the dialog is unavailable. Reduced-motion preferences disable transitions and reveal effects.

The project artwork is editorial illustration built from HTML, CSS, and simple inline SVG—not an operational AI agent, a real product screenshot, or a map of an actual BOG itinerary. The film poster links to the supplied Silverscreen YouTube channel; it does not pretend to be an embedded film player.

There are no tracking scripts, cookies, analytics integrations, external font requests, video embeds, runtime libraries, or API credentials. External social/product sites are opened only when a visitor follows a link.

## Check and export

```sh
python3 scripts/check_site.py
python3 scripts/export_single_file.py --output ../rohit-pachar.html
```

Both scripts use the Python standard library only. Python is an optional editing tool, not a deployment requirement. The single-file exporter embeds styles, scripts, images, and icons. For routine edits and deployment, the normal repository is easier to maintain and cache. For the easiest possible preview, open the exported HTML.

In the exported HTML, the photograph opens in the same viewer with JavaScript; without JavaScript it downloads as an image. Metadata still points to the chosen production domain. The single-file version does not replace `robots.txt`, `sitemap.xml`, the custom 404 page, or HTTP response headers.

## Before public launch

Read `CONTENT.md` and confirm the current job wording, biographical details, milestone numbers, photo permission, and destination links. The copy is an editorial rewrite of the supplied profile, not independently verified reporting. No clients, testimonials, commercial results, product features, or personal email addresses were invented.
