PDF EXAM QUIZ — ANDROID PWA
===========================

WHAT'S INCLUDED
- Android-friendly dark interface
- Import multiple PDFs from your phone
- 90-second timer per question
- Select an answer, change it, then press Select to submit
- Correct/incorrect feedback and Next Question
- Random quiz sizes
- Source PDF and page shown for each question
- Mistakes saved locally and Retry Wrong Questions mode
- Offline app shell and local IndexedDB storage

IMPORTANT: A PWA must be served from HTTPS to be installable.
This ZIP is the app package. Publish it once to a static HTTPS host.

FREE PUBLISHING WITH GITHUB PAGES
1. On a computer, sign in or create a GitHub account.
2. Create a new public repository, e.g. "pdf-exam-quiz".
3. Upload the CONTENTS of this folder to the repository root:
   index.html, app.js, styles.css, sw.js, manifest.webmanifest, icons/
   Do not upload the ZIP itself as the website.
4. Open repository Settings -> Pages.
5. Under Build and deployment choose "Deploy from a branch".
6. Select branch "main", folder "/ (root)", then Save.
7. Wait for GitHub Pages to publish. It will show a URL similar to:
   https://YOUR-USERNAME.github.io/pdf-exam-quiz/
8. Open that URL in Chrome on your Android phone.
9. Load the app once while online. Then Chrome menu (three dots) ->
   "Install app" or "Add to Home screen" -> confirm.
10. Launch PDF Exam Quiz from your home screen.

USING THE APP
1. Tap Import PDF files and select your study PDFs.
2. Wait for import. Total loaded questions appears on the home screen.
3. Choose the quiz size and optional answer shuffling.
4. Tap Start New Quiz.
5. Tap an answer to highlight it. You can change your choice.
6. Press Select to submit, then Next Question.
7. If time expires, it is recorded as incorrect automatically.
8. Use Retry Wrong Questions to practice mistakes.
9. A question leaves the mistakes list once answered correctly.

OFFLINE
After the first successful online load, the app shell and PDF.js library
are cached for offline use. Open the installed app online at least once
before relying on offline access. Questions and mistakes are stored
locally on your phone in browser storage.

PARSING LIMITATION — PLEASE TEST
The app attempts to detect red answer text from PDF drawing instructions.
PDFs vary in how they encode text colors and fonts. Verify a few known
answers after importing before relying on a full exam session. Scanned
(image-only) PDFs are not supported. Unusual PDF text/color encoding may
need a parser adjustment.

PRIVACY
PDFs are processed in your browser and are not uploaded to a server.
Questions and mistakes stay in local browser storage. Clearing Chrome
site data or uninstalling/clearing app storage may erase progress.
Keep your original PDFs as backups.
