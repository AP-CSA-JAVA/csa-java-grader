# CSA Java Grader

Grades AP CSA Java submissions straight from a Canvas **Download Submissions** zip. Everything runs in the browser tab: student code is never uploaded anywhere. The one exception is **Email students**, which sends only the emails you choose, through your own Google account.

For each student it shows the rubric columns separately:

| Column | How it's scored |
|---|---|
| **Compilation & Output** | Compiled as Java 8, the course version. A program that only compiles as Java 17 (it used `var`, records, switch arrows…) is graded as Java 17 with no penalty and flagged **JAVA 17**; see *Newer Java* below. The assignment's checks run against the code and against scripted runs where the grader types the answers. The same problem repeating across runs counts once. 0 failed → 5, 1 → 4, up to half → 3, more → 2. Doesn't compile → 2 (≤ 2 errors) or 1. |
| **Documentation & Style** | Oracle code conventions. Each *type* of mistake counts once; students see every line. 0 types → 5, 1 → 4, 2–3 → 3, 4–5 → 2, 6+ → 1. The header is skipped. In a `switch`, `case` labels may line up with `switch` (Oracle's convention) or be indented one level (what most editors do). |
| **Submission** | A `.java` file plus test cases: a document or screenshot (png, jpg, pdf, docx, txt…), or a comment in the code labeled `TEST CASE 1:`, `TEST CASE 2:`… (any capitalization, any comment style). Missing test cases → 4. |
| **Header** | −1 if missing, or if any field is blank or still a placeholder like `[Your Full Name]`. Accepts any comment style (`//`, `/* */`, `/** */`, the bordered `/*=====` header), a header placed below the imports (the student is told to move it up), several fields on one line, `Label - value` lines, and Javadoc `@author`. |
| **Suggested** | Average of the three columns, never higher than Compilation & Output; then the grading-note caps (no compile ≤ 2, no test cases ≤ 4) and the header deduction. Type in **Final** to override. |

Every number above lives in `js/config.js`.

## Put it on GitHub Pages (web editor only)

1. On GitHub, create a new **public** repository, e.g. `csa-java-grader`.
2. **Add file → Upload files**, then drag in everything from this folder (keep the folders). The biggest file, `lib/ecj-3.36.0.jar`, is about 3 MB. Make sure the hidden `.nojekyll` file comes along; if your computer hides it, create an empty file named `.nojekyll` with **Add file → Create new file**.
3. **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, Branch `main`, folder `/ (root)`. Save.
4. After a minute the site is at `https://<your-account>.github.io/csa-java-grader/`.

## Using it

1. In Canvas: Assignment → **Download Submissions**.
2. Open the grader. The first time on a computer, click **Load assignments** and choose your private assignments zip (see below). Pick the assignment and drop the Canvas zip.
3. Wait for **Java ready** (the first load downloads the Java runtime, then the browser caches it), then **Grade all**.
4. Open a row for the details and the student feedback. **Copy for Canvas** copies the feedback for a SpeedGrader comment. **Export CSV** saves every score and comment.
5. **Print correction sheets** makes one PDF for the class: at most two pages per student (suggested score, a numbered fix list with checkboxes, style notes), padded so a double-sided print is one sheet of paper each. Each row also has its own **Correction sheet (PDF)** button for reprints.
6. **Class summary (PDF)** makes one landscape PDF for you, not the students: the class average and score spread, a table of every student's Compilation & Output, Documentation & Style and Submission scores with the header deduction, suggested and final score, and the most common program and style mistakes across the class with who made them. Save one after each grading run as a record.

7. **Email students** sends each student their feedback and correction sheet from your school Google account. It needs a one-time setup (a small Google Apps Script mailer and a Canvas gradebook export as the roster): see [EMAIL-SETUP.md](EMAIL-SETUP.md). A test run sends to you first, and nobody gets the same assignment twice.

Results are saved in your browser. If a reload is needed, drop the same zip again and it continues where it left off. **Clear saved** starts over.

## Your assignments (kept private)

Only **Any assignment (compile, style, header only)** is built into this site. The files that test each assignment (its typed inputs, expected output and required methods) live in a **private** repository, so students who find this site can't see what is checked.

To grade with them:

1. On GitHub, open the private repository → **Code → Download ZIP**.
2. In the grader, click **Load assignments** and choose that zip. The grader finds the `specs` folder inside it.
3. Pick the assignment from the dropdown as usual.

The assignments are kept in this browser only (nothing is uploaded). Load the zip again after you edit an assignment, or when you grade on another computer. **Remove** clears them from the browser, which is worth doing on a shared computer.

Adding an assignment and testing changes are explained in the private repository's README.

## Good to know

- **Java 8 and newer Java.** Every program is compiled by Java 8 rules first, because that is the course version. If that fails, the grader tries Java 17 rules. A program that compiles there was written with newer Java (common for students who compete or copy from tutorials or AI): it is graded normally with **no penalty**, marked **JAVA 17** in the table, and the details, correction sheet and class summary list each newer feature with its line numbers and the Java 8 way to write it. To treat newer Java as a compile error instead, set `allowNewerJava: false` in `js/config.js`. Java 21 features (pattern matching in `switch`) still don't compile.
- **Network.** Java loads from `cjrtnc.leaningtech.com`. If the district filter blocks it, grade from home or your hotspot.
- **Speed.** The first compile after opening the page takes about 15 seconds while the compiler loads; after that each compile takes well under a second (the page keeps Java loaded with CheerpJ's library mode). If the status pill says **Java ready (slow mode)**, library mode didn't start and every compile takes about 15 seconds; reload the page.
- **Infinite loops.** A run is stopped after 8 seconds. CheerpJ can't interrupt a tight loop on its own, so before compiling, the grader adds a tiny time check inside every student loop (`cjgrader.LoopGuard.tick()`, on the same line, so line numbers don't change and students never see it). If a program still locks up the tab (for example, endless recursion that takes a long time to overflow), reload: that student is marked **CHECK** and the rest continue.
- **Canvas file names.** Resubmitted files like `Main-1.java` are renamed back to the class name before compiling. A student's own `.zip` inside the Canvas zip is opened too.
- **Student names** come from Canvas file names, which join last and first name (`Smithjordan`).

## Credits

Java runs in the browser with [CheerpJ](https://cheerpj.com), used under the free CheerpJ Community Licence for non-commercial education. Java runs on CheerpJ's Java 17. The compiler is the Eclipse Compiler for Java (`lib/ecj-3.36.0.jar`, Eclipse Public License 2.0), because CheerpJ's Java 17 has no javac; `lib/java8-api.jar` and `lib/java17-api.jar` hold Java's class signatures, built from OpenJDK's `ct.sym` (GPLv2 with the Classpath Exception). Zip reading by [JSZip](https://stuk.github.io/jszip/) (MIT). PDFs by [jsPDF](https://github.com/parallax/jsPDF) (MIT).
