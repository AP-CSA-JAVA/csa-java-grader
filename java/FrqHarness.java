import java.io.OutputStream;
import java.io.PrintStream;
import java.util.Arrays;

/**
 * Rubric-mapped FRQ grading, browser version. Every FRQ grader (PlantGridGrader, CargoBikeGrader, ...)
 * extends this class. Same API as frq-grader's desktop FrqHarness.java, so the graders don't change.
 *
 * Each rubric point is a group of test cases. A point is earned only when every test case in its
 * group passes. A crash or endless loop costs that one case and nothing else.
 *
 * What's different from the desktop version:
 *  - No threads. In CheerpJ, Java threads take turns on the browser's one thread, so a thread with a
 *    time limit can't stop a tight loop. Instead each case gets its own cjgrader.LoopGuard deadline:
 *    js/java-text.js adds LoopGuard.tick() to every loop in the student's code, and tick() throws
 *    Error("__GRADER_TIMEOUT__") once the case's time is up.
 *  - Whatever the student's code prints during a case is thrown away (up to a limit), so it can't
 *    mix with the POINT lines or fill the run's output cap.
 *  - No System.exit at the end: there are no stuck threads to kill.
 *
 * Output (one line per point, read by js/frq.js):
 *   POINT|A1|1|<feedback>     (earned)
 *   POINT|A1|0|<feedback>     (not earned)
 *
 * Built into lib/grader-harness.jar (default package), see lib/README.md.
 */
public abstract class FrqHarness
{
    /** Milliseconds each test case may run before it counts as an endless loop. */
    protected static final long TIME_LIMIT_MS = 2000;

    /** Characters a student's code may print during one case before it counts as an endless print loop. */
    private static final int PRINT_LIMIT = 200000;

    private String currentPoint;
    private String firstFailure;
    private int casesRun;
    private final PrintStream out = System.out;   // the real output, for POINT lines

    /** A single test case. Throw AssertionError (via expect) to fail it. */
    protected interface TestCase { void run() throws Exception; }

    /** Subclasses define their rubric points here by calling point(...) and test(...). */
    protected abstract void defineChecks();

    /** Starts a new rubric point. */
    protected void point(String id)
    {
        finishPoint();
        currentPoint = id;
        firstFailure = null;
        casesRun = 0;
    }

    /** True if the rubric point currently being checked has this id. */
    protected boolean currentPointIs(String id)
    {
        return id.equals(currentPoint);
    }

    /** Thrown when the student's code prints too much during one case. */
    private static final class PrintLimit extends Error
    {
        PrintLimit() { super("__FRQ_PRINT_LIMIT__"); }
    }

    /** Counts what the student's code prints and stops it past the limit. Keeps nothing. */
    private static final class Sink extends OutputStream
    {
        private int n;
        @Override public void write(int b) { if (++n > PRINT_LIMIT) throw new PrintLimit(); }
        @Override public void write(byte[] b, int off, int len) { n += len; if (n > PRINT_LIMIT) throw new PrintLimit(); }
    }

    /** Runs one test case for the current point. Only the first failure is reported. */
    protected void test(String description, TestCase tc)
    {
        casesRun++;
        if (firstFailure != null) return;   // point already lost; skip remaining cases

        PrintStream sink = new PrintStream(new Sink(), true);
        PrintStream oldErr = System.err;
        System.setOut(sink);
        System.setErr(sink);
        cjgrader.LoopGuard.start(TIME_LIMIT_MS);
        try
        {
            tc.run();
        }
        catch (AssertionError e)
        {
            firstFailure = description + ": " + e.getMessage();
        }
        catch (Throwable t)
        {
            firstFailure = description + ": " + describe(t);
        }
        finally
        {
            cjgrader.LoopGuard.stop();
            System.setOut(out);
            System.setErr(oldErr);
        }
    }

    /** What a student sees when a case crashes or runs too long. */
    private static String describe(Throwable t)
    {
        String m = t.getMessage();
        if (t instanceof Error && "__GRADER_TIMEOUT__".equals(m))
            return "did not finish (possible infinite loop).";
        if (t instanceof PrintLimit)
            return "printed too much (possible infinite loop).";
        if (t instanceof Error && "__GRADER_EXIT__".equals(m))
            return "called System.exit, which ends the whole program.";
        if (t instanceof StackOverflowError)
            return "threw StackOverflowError (recursion that never reaches its base case?).";
        if (t instanceof SecurityException && m != null && m.startsWith("System.exit"))
            return "called System.exit, which ends the whole program.";
        return "threw " + t.getClass().getSimpleName() + (m != null ? " (" + m + ")" : "") + ".";
    }

    private void finishPoint()
    {
        if (currentPoint == null) return;
        if (firstFailure == null)
            emit(currentPoint, 1, "Passed all " + casesRun + " checks.");
        else
            emit(currentPoint, 0, firstFailure);
        currentPoint = null;
    }

    private void emit(String id, int earned, String msg)
    {
        out.println("POINT|" + id + "|" + earned + "|" + msg.replace('\n', ' ').replace('|', '/'));
    }

    /** Runs all checks. Call from main. */
    protected void runAll()
    {
        defineChecks();
        finishPoint();
        out.println("FRQ-DONE");
        out.flush();
    }

    // ---------- assertion helpers (same as the desktop version) ----------

    protected static void expect(boolean condition, String message)
    {
        if (!condition) throw new AssertionError(message);
    }

    protected static void expectEquals(int expected, int actual, String context)
    {
        if (expected != actual)
            throw new AssertionError(context + " expected " + expected + ", got " + actual + ".");
    }

    protected static void expectEquals(boolean expected, boolean actual, String context)
    {
        if (expected != actual)
            throw new AssertionError(context + " expected " + expected + ", got " + actual + ".");
    }

    protected static void expectEquals(String expected, String actual, String context)
    {
        if (expected == null ? actual != null : !expected.equals(actual))
            throw new AssertionError(context + " expected " + quote(expected) + ", got " + quote(actual) + ".");
    }

    protected static String quote(String s)
    {
        return s == null ? "null" : "\"" + s + "\"";
    }

    /** Null if every instance (non-static) field of c is private and there is at least one; otherwise what's wrong. */
    protected static String checkPrivateFields(Class<?> c)
    {
        int instance = 0;
        for (java.lang.reflect.Field f : c.getDeclaredFields())
        {
            if (f.isSynthetic()) continue;
            int m = f.getModifiers();
            if (java.lang.reflect.Modifier.isStatic(m)) continue;
            instance++;
            if (!java.lang.reflect.Modifier.isPrivate(m))
                return "instance variable '" + f.getName() + "' is not private.";
        }
        return instance == 0 ? "no instance variables were declared." : null;
    }

    protected static int[][] copy(int[][] g)
    {
        int[][] c = new int[g.length][];
        for (int r = 0; r < g.length; r++) c[r] = Arrays.copyOf(g[r], g[r].length);
        return c;
    }

    protected static String show(int[][] g)
    {
        StringBuilder sb = new StringBuilder("{");
        for (int r = 0; r < g.length; r++)
        {
            if (r > 0) sb.append(", ");
            sb.append(Arrays.toString(g[r]).replace('[', '{').replace(']', '}'));
        }
        return sb.append("}").toString();
    }
}
