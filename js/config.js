// =====================================================================
// config.js — every grading number in one place.
// Edit these in the GitHub web editor; no rebuild needed.
// =====================================================================

export const CONFIG = {
  // ---------- Running student programs ----------
  runTimeoutMs: 8000,        // per run; a run longer than this is reported as a possible infinite loop
  maxOutputChars: 400000,    // stops runaway print loops

  // ---------- Documentation & Style column ----------
  // Unique mistake TYPES (each type counts once, like the PEP 8 Checker).
  // Score = the first band whose "max" is >= the number of unique types.
  styleBands: [
    { max: 0, score: 5 },
    { max: 1, score: 4 },
    { max: 3, score: 3 },
    { max: 5, score: 2 },
    { max: Infinity, score: 1 },
  ],
  maxLineLength: 100,        // Oracle suggests 80; 100 is friendlier for printf lines
  minCommentRatio: 1 / 15,   // at least 1 comment line per 15 code lines (header not counted)
  allowedShortNames: ['i', 'j', 'k', 'x', 'y', 'n', 'e'],

  // ---------- Newer Java ----------
  // Programs are compiled as Java 8 (the course version). When that fails but the
  // program compiles as Java 17, it was written with newer Java (var, records,
  // switch arrows, ...). true: grade it as Java 17 with no penalty and flag the
  // features. false: treat it like any other program that doesn't compile.
  allowNewerJava: true,

  // ---------- Compilation & Output column ----------
  // Based on how many checks fail (requirements + program runs).
  outputBands: [
    { maxFailed: 0, score: 5 },
    { maxFailed: 1, score: 4 },
    { maxFailedFraction: 0.5, score: 3 },
    { maxFailedFraction: 1, score: 2 },
  ],
  compileFailFewErrors: 2,   // <= this many compiler errors -> 2, more -> 1

  // ---------- Submission column ----------
  testCaseExtensions: ['png', 'jpg', 'jpeg', 'gif', 'pdf', 'docx', 'doc', 'txt', 'md', 'heic', 'webp'],
  // Test cases written in a comment inside the .java file count too. Each one is
  // labeled "TEST CASE 1:", "TEST CASE 2:", ... (any capitalization; //, /* */ or /** */).
  // This many differently numbered labels counts as "test cases submitted".
  commentTestCasesMin: 1,

  // ---------- Header ----------
  headerFields: [
    { key: 'name', label: 'Name', aliases: ['name', 'author', 'student'] },
    { key: 'partner', label: 'Partner', aliases: ['partner', 'partners'] },
    { key: 'course', label: 'Course', aliases: ['course', 'course name'] },
    { key: 'instructor', label: 'Instructor', aliases: ['instructor', 'teacher'] },
    { key: 'assignment', label: 'Assignment', aliases: ['assignment', 'program'] },
    { key: 'due', label: 'Due Date', aliases: ['due date', 'due', 'date'] },
  ],
  headerDeduction: 1,        // one deduction if the header is missing OR has blank fields

  // ---------- Suggested score ----------
  // 'capped-average': average of the three columns, but never above the
  //                   Compilation & Output column (style can't outweigh broken code)
  // 'average':        plain rounded average of the three columns
  // 'lowest':         the lowest of the three columns
  suggestedMethod: 'capped-average',

  // ---------- Grading notes caps ----------
  capNoCompile: 2,           // "A program that does not compile cannot earn higher than a 2"
  capNoTestCases: 4,         // "A missing test cases document cannot earn higher than a 4"

  // ---------- Email students (setup: EMAIL-SETUP.md) ----------
  // Addresses come from the roster you load (a Canvas gradebook export).
  // If it has an Email column, that is used; otherwise <idColumn>@<domain>.
  email: {
    mailerUrl: 'https://script.google.com/macros/s/AKfycbwzu5C7JpTc9tz7q3snwHNZ2bo1ngnOjdJa3o8zWRuZScn5AWNH5xDAR_Y-7dBNhclgaw/exec',
    domain: 'lbschools.net',      // student addresses must end with this
    idColumn: 'SIS User ID',      // roster column holding the part before the @
    testLimit: 3,                 // a test run sends at most this many, all to you
    // {first}, {name}, {assignment}, {score} are filled in for each student.
    subject: '{assignment}: your score and correction sheet',
    intro: 'Hi {first},\n\n'
      + 'Your program for {assignment} has been graded: {score}. Your correction sheet is attached. '
      + 'Make each fix on the list, highlight your changes, and turn in a printed copy.\n\n'
      + 'Your feedback:',
  },
};
