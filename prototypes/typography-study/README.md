# Typography study

The retained typography comparison for the selected widget Home design. Run `node server.mjs` here and open `http://127.0.0.1:41974/`. The sample prototype runs on port 41973; connected Home runs through the agent service at `/home/`.

The study reads the widget prototype source and renders it inside a comparison frame. Its separate loopback origin gives it independent browser storage. A/B/C change typography only; Previous restores the earlier system-sans treatment. B (IBM Plex Sans) is applied in the main prototype. The study keeps the earlier HTML/CSS baseline for comparison.

- A: Source Sans 3. Humanist shapes, moderate emphasis, and a lighter reading rhythm. [Adobe's source](https://github.com/adobe-fonts/source-sans).
- B: IBM Plex Sans. More angular shapes, restrained heading weights, and aligned numerals. [IBM's typeface reference](https://www.ibm.com/design/language/typography/typeface/).
- C: Atkinson Hyperlegible Next. Open shapes and differentiated letters, with slightly more generous body text. [Braille Institute's reference](https://www.brailleinstitute.org/freefont/).

These are typography treatments within one approved layout direction, not three complete design concepts. Descriptive labels are design interpretations, not evidence of usability improvement. The user's visual response decides the next iteration.

The three unmodified Latin WOFF2 subsets came from the Google Fonts API on September 9, 2026 and are served locally. Original URLs are recorded in `font-sources.json`; each font's full SIL Open Font License and copyright notice are retained beside it. No system-wide font installation or external font requests occur in the browser.
