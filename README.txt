PDF EXAM QUIZ — PWA WITH PDF IMPORT
===================================

This is the PDF-import version. Questions are NOT built into the app and there is
NO questions.json file. You can import new PDF files whenever you want.

FILES
-----
index.html              App interface
styles.css              Responsive dark theme
app.js                  PDF extraction, quiz, timer, scoring and mistakes
sw.js                   Offline service worker
manifest.webmanifest    Installable PWA metadata
icons/                  App icons

HOW PDF IMPORT WORKS
--------------------
1. Open the app and choose one or more PDF files.
2. PDF.js reads selectable text in the browser.
3. The app renders each page and checks the actual glyph pixels to detect red
   answer text. Red blank spaces are not counted as red answers.
4. Questions and their answer options are parsed across page boundaries.
5. The app validates that each question has four options and exactly one red
   answer. Any exceptions are shown in the imported-PDF library.
6. Extracted questions are stored in IndexedDB on the device.

The PDF itself is not uploaded to a server. The extracted question text and
progress remain in the browser's local storage.

PDF REQUIREMENTS / LIMITATIONS
------------------------------
- Designed for selectable-text PDFs with numbered multiple-choice questions,
  four options labelled α/β/γ/δ (or a/b/c/d), and the correct answer formatted
  in red.
- Scanned/image-only PDFs need OCR and are not supported by this build.
- Unusual layouts, different labels, or non-red answer markings may need parser
  adjustments. The app reports questions that do not pass the four-option /
  one-red-answer check rather than silently grading them.
- The PDF.js library is loaded from cdnjs the first time. Open the published app
  online once so the app shell and PDF.js library can be cached. Later use can
  work offline, including PDF importing, after those resources are cached.

DEPLOY WITH GITHUB PAGES
------------------------
1. Create a GitHub repository.
2. Extract this ZIP.
3. Upload the CONTENTS of the pdf_upload_pwa folder to the repository root.
   index.html must be at the root, not in a nested folder.
4. Commit the files.
5. Open repository Settings > Pages.
6. Choose Deploy from a branch, select your branch (usually main) and folder
   "/" (root), then Save.
7. Wait for GitHub Pages to publish the HTTPS address.
8. Open that HTTPS address in Chrome on Android.
9. Use Chrome menu (⋮) > Install app / Add to Home screen.

USE
---
- Import PDFs using the "Choose PDF files" button.
- You can select multiple PDFs at once.
- Imported PDFs remain in the app's library after closing/reopening it.
- Importing a PDF with the same filename replaces that PDF's previous questions,
  but only after at least one question was successfully extracted.
- Remove a PDF from the library to remove its questions and associated mistakes.
- Select a PDF or all PDFs, choose quiz size, and start.
- Each question has a 90-second timer.
- Select an answer, change it if needed, then press Select answer.
- Wrong answers are saved and can be retried. A correctly answered question is
  removed from the saved-mistakes list.

LOCAL TEST
----------
PWA installation and service workers require HTTPS or localhost. Do not open
index.html directly from the file manager. For a quick local preview, use any
static web server. If Python is installed:
    python -m http.server 8000
Then visit http://localhost:8000.
This is only an optional local preview command; no Python is required to use
the app after it is hosted.

VALIDATION NOTE
---------------
The question parsing rules were tested against the seven supplied PDFs using
their native text and colour metadata: 1,613 questions, four options and one
red answer per question. The app's browser-side pixel colour detection still
needs a real-device check after deployment; use the import report to confirm
the counts on your PDFs.
