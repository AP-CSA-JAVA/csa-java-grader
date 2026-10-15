package cjgrader;

/**
 * Stops endless loops in student programs.
 *
 * In CheerpJ, Java threads take turns on the browser's single thread, so a
 * tight loop like `while (true) { n++; }` never lets the grader's time limit
 * run and the whole tab freezes. Before compiling, js/java-text.js adds a
 * call to tick() inside every student loop (on the same line, so line
 * numbers don't change). tick() is cheap: it only looks at the clock every
 * 256 calls, and ends the program once the run's time is up.
 */
public final class LoopGuard {
    private static volatile long deadline = Long.MAX_VALUE;
    private static int count = 0;

    private LoopGuard() {
    }

    /** Called by GraderHarness before running a program. */
    public static void start(long timeoutMs) {
        count = 0;
        deadline = System.currentTimeMillis() + timeoutMs;
    }

    /** Called by GraderHarness after the program ends. */
    public static void stop() {
        deadline = Long.MAX_VALUE;
    }

    /** Added to student loops. Always true, so it can also sit in a loop condition. */
    public static boolean tick() {
        if ((++count & 255) == 0 && System.currentTimeMillis() > deadline) {
            throw new Error("__GRADER_TIMEOUT__");
        }
        return true;
    }
}
