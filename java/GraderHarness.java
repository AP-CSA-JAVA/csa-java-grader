/*
 * GraderHarness — compiles and runs one student's Java program inside CheerpJ.
 *
 * Called from JavaScript (js/runner.js) in CheerpJ "library mode".
 * Kept deliberately small: all grading logic lives in JavaScript so it can be
 * edited in the GitHub web editor without rebuilding this JAR.
 *
 * Build (Java 8 target; includes cjgrader/LoopGuard):
 *   javac --release 8 -d build java/GraderHarness.java java/cjgrader/LoopGuard.java
 *   jar cf lib/grader-harness.jar -C build .
 */

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.List;

public class GraderHarness {

    /** Shown by the grader and test page, to confirm the browser loaded this build and not a cached one. */
    public static final String VERSION = "2026-10-14c (Eclipse compiler, loop guard, library mode)";

    public static String version() {
        return VERSION;
    }

    /** Thrown when a program prints too much (usually an infinite print loop). */
    static class OutputLimitError extends Error {
        OutputLimitError() {
            super("output limit reached");
        }
    }

    /** Thrown instead of letting System.exit() shut down the whole grader. */
    static class ExitCalled extends SecurityException {
        final int status;

        ExitCalled(int status) {
            super("System.exit(" + status + ")");
            this.status = status;
        }
    }

    /** Counts characters written and stops the program past a limit. */
    static class CappedStream extends OutputStream {
        private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        private final int limit;

        CappedStream(int limit) {
            this.limit = limit;
        }

        @Override
        public synchronized void write(int b) {
            if (buffer.size() >= limit) {
                throw new OutputLimitError();
            }
            buffer.write(b);
        }

        @Override
        public synchronized void write(byte[] b, int off, int len) {
            if (buffer.size() + len > limit) {
                int room = Math.max(0, limit - buffer.size());
                buffer.write(b, off, room);
                throw new OutputLimitError();
            }
            buffer.write(b, off, len);
        }

        synchronized String text() {
            try {
                return buffer.toString("UTF-8");
            } catch (Exception e) {
                return buffer.toString();
            }
        }
    }

    // ------------------------------------------------------------------
    // Compile
    // ------------------------------------------------------------------

    /**
     * Compiles the given source files into outDir with javac.
     *
     * @param outDir      writable directory for .class files (under /files/)
     * @param sourceList  source file paths separated by newlines (under /str/)
     * @return            first line is javac's exit code (0 = success),
     *                    the rest is javac's error/warning text
     */
    public static String compile(String outDir, String sourceList) {
        deleteRecursive(new File(outDir));
        return compileInto(outDir, sourceList, "");
    }

    /**
     * Compiles more sources into an existing class folder without clearing it,
     * e.g. a grader test class that calls the student's classes.
     *
     * @param classPath  where already-compiled classes live ("" for none)
     */
    public static String compileInto(String outDir, String sourceList, String classPath) {
        File out = new File(outDir);
        out.mkdirs();

        List<String> args = new ArrayList<String>();
        args.add("-d");
        args.add(outDir);
        // The harness jar is on the classpath so student code can call
        // cjgrader.LoopGuard.tick(), which js/java-text.js adds to every loop.
        String cp = ownJar();
        if (classPath != null && classPath.length() > 0) {
            cp = cp.length() > 0 ? classPath + File.pathSeparator + cp : classPath;
        }
        if (cp.length() > 0) {
            args.add("-cp");
            args.add(cp);
        }
        args.add("-encoding");
        args.add("UTF-8");
        args.add("-nowarn");
        for (String path : sourceList.split("\n")) {
            if (path.trim().length() > 0) {
                args.add(path.trim());
            }
        }

        StringWriter messages = new StringWriter();
        PrintWriter writer = new PrintWriter(messages);
        int code;
        try {
            if (javaLevel != null) {
                // Eclipse compiler at a chosen Java level (8 or 17), see EcjBridge.java
                code = (Integer) ecjMethod().invoke(null, args.toArray(new String[0]), writer, javaLevel,
                        libDir() + "java" + javaLevel + "-api.jar");
            } else {
                Method compile = javacMethod();
                code = (Integer) compile.invoke(null, args.toArray(new String[0]), writer);
            }
        } catch (Throwable t) {
            Throwable cause = (t instanceof InvocationTargetException && t.getCause() != null) ? t.getCause() : t;
            writer.println("GRADER-ERROR: could not run " + (javaLevel != null ? "the Eclipse compiler" : "javac") + ": " + cause);
            StringWriter trace = new StringWriter();
            cause.printStackTrace(new PrintWriter(trace));
            String[] lines = trace.toString().split("\n");
            for (int i = 1; i < Math.min(lines.length, 6); i++) {
                writer.println(lines[i]);
            }
            code = -1;
        }
        writer.flush();
        return code + "\n" + messages.toString();
    }

    private static String toolsJar = null;
    private static Method javacCompile = null;

    // ---- Eclipse compiler (newer Java in CheerpJ's Java 17 runtime) ----

    /** Java level for the next compile ("8", "17"), or null to use javac. */
    private static String javaLevel = null;
    private static Method ecjCompile = null;

    /** Chooses the Java level for compiling: "8", "17", or null for javac. */
    public static void useJavaLevel(String level) {
        javaLevel = (level == null || level.length() == 0 || level.equals("-")) ? null : level;
    }

    /** EcjBridge.compile, from lib/ecj-bridge.jar on the classpath. */
    private static Method ecjMethod() throws Exception {
        if (ecjCompile == null) {
            Class<?> bridge = Class.forName("EcjBridge");
            ecjCompile = bridge.getMethod("compile", String[].class, PrintWriter.class, String.class, String.class);
        }
        return ecjCompile;
    }

    /** The lib/ folder, when JavaScript sets it (library mode); otherwise found from the classpath. */
    private static String libDirOverride = null;

    /** Tells the harness where lib/ is, e.g. "/app/csa-java-grader/lib/". */
    public static void useLibDir(String dir) {
        libDirOverride = dir == null || dir.length() == 0 ? null : (dir.endsWith("/") ? dir : dir + "/");
    }

    /** Path of grader-harness.jar itself (from the classpath), or "" if not found. */
    private static String ownJar() {
        if (libDirOverride != null) {
            return libDirOverride + "grader-harness.jar";
        }
        String cp = System.getProperty("java.class.path", "");
        for (String entry : cp.split(File.pathSeparator.equals(";") ? ";" : ":")) {
            if (entry.endsWith("grader-harness.jar")) {
                return entry;
            }
        }
        return "";
    }

    /** The folder holding ecj-bridge.jar (and the java*-api.jar files), with a trailing slash. */
    private static String libDir() {
        if (libDirOverride != null) {
            return libDirOverride;
        }
        String cp = System.getProperty("java.class.path", "");
        for (String entry : cp.split(File.pathSeparator.equals(";") ? ";" : ":")) {
            if (entry.endsWith("ecj-bridge.jar")) {
                return entry.substring(0, entry.length() - "ecj-bridge.jar".length());
            }
        }
        return "";
    }

    /** Where tools.jar lives, so javac can be loaded even if it is not on the classpath. */
    public static String useToolsJar(String path) {
        toolsJar = path;
        return new File(path).exists() ? "found" : "missing";
    }

    /** Finds javac: first on the classpath, then from tools.jar with its own class loader. */
    private static Method javacMethod() throws Exception {
        if (javacCompile != null) {
            return javacCompile;
        }
        Class<?> javac;
        try {
            javac = Class.forName("com.sun.tools.javac.Main");
        } catch (ClassNotFoundException e) {
            if (toolsJar == null) {
                throw e;
            }
            URLClassLoader tools = new URLClassLoader(new URL[] {new File(toolsJar).toURI().toURL()},
                    GraderHarness.class.getClassLoader());
            javac = Class.forName("com.sun.tools.javac.Main", true, tools);
        }
        javacCompile = javac.getMethod("compile", String[].class, PrintWriter.class);
        return javacCompile;
    }

    // ------------------------------------------------------------------
    // Run
    // ------------------------------------------------------------------

    /**
     * Runs mainClass from classDir with scripted keyboard input.
     *
     * @param classDir   directory holding the compiled classes
     * @param mainClass  fully qualified class with the main method
     * @param stdin      text fed to System.in (what the "user" types)
     * @param timeoutMs  how long to wait before giving up
     * @param maxChars   output cap in bytes
     * @return           a small JSON object: status, exception, where, stdout, stderr, ms
     */
    public static String run(String classDir, String mainClass, String stdin,
                             int timeoutMs, int maxChars) {
        final CappedStream outBuf = new CappedStream(maxChars);
        final CappedStream errBuf = new CappedStream(maxChars);
        PrintStream oldOut = System.out;
        PrintStream oldErr = System.err;
        InputStream oldIn = System.in;
        SecurityManager oldSm = System.getSecurityManager();

        final String[] status = {"ok"};
        final String[] exception = {""};
        final String[] where = {""};
        long start = System.currentTimeMillis();

        try {
            PrintStream newOut = new PrintStream(outBuf, true, "UTF-8");
            PrintStream newErr = new PrintStream(errBuf, true, "UTF-8");
            System.setOut(newOut);
            System.setErr(newErr);
            System.setIn(new ByteArrayInputStream(stdin.getBytes("UTF-8")));

            installExitBlocker();

            // A fresh class loader per run, so static variables start clean.
            URL url = new File(classDir).toURI().toURL();
            final URLClassLoader loader = new URLClassLoader(new URL[] {url},
                    GraderHarness.class.getClassLoader());
            Class<?> cls = Class.forName(mainClass, true, loader);
            final Method main = cls.getMethod("main", String[].class);
            if (!Modifier.isStatic(main.getModifiers())) {
                throw new NoSuchMethodException("main is not static");
            }

            Thread worker = new Thread(new Runnable() {
                public void run() {
                    try {
                        main.invoke(null, (Object) new String[0]);
                    } catch (InvocationTargetException ite) {
                        Throwable cause = ite.getCause();
                        if (cause instanceof ExitCalled) {
                            status[0] = "exit";
                            exception[0] = "System.exit(" + ((ExitCalled) cause).status + ")";
                        } else if (cause instanceof Error
                                && "__GRADER_EXIT__".equals(cause.getMessage())) {
                            // js/runner.js rewrites System.exit(...) to throw this Error
                            status[0] = "exit";
                            exception[0] = "System.exit(...)";
                        } else if (cause instanceof Error
                                && "__GRADER_TIMEOUT__".equals(cause.getMessage())) {
                            // cjgrader.LoopGuard ended an endless loop
                            status[0] = "timeout";
                        } else if (cause instanceof OutputLimitError) {
                            status[0] = "outputLimit";
                        } else {
                            status[0] = "exception";
                            exception[0] = String.valueOf(cause);
                            where[0] = studentFrame(cause);
                        }
                    } catch (Throwable t) {
                        status[0] = "exception";
                        exception[0] = String.valueOf(t);
                    }
                }
            }, "student-main");
            worker.setDaemon(true);
            cjgrader.LoopGuard.start(timeoutMs);
            worker.start();
            worker.join(timeoutMs);

            if (worker.isAlive()) {
                status[0] = "timeout";
                stopThread(worker);
            }
        } catch (ClassNotFoundException e) {
            status[0] = "noMain";
            exception[0] = "Class not found: " + mainClass;
        } catch (NoSuchMethodException e) {
            status[0] = "noMain";
            exception[0] = "No public static void main(String[] args) in " + mainClass;
        } catch (Throwable t) {
            status[0] = "exception";
            exception[0] = String.valueOf(t);
        } finally {
            System.out.flush();
            System.err.flush();
            System.setOut(oldOut);
            System.setErr(oldErr);
            System.setIn(oldIn);
            cjgrader.LoopGuard.stop();
            restoreSecurityManager(oldSm);
        }

        long ms = System.currentTimeMillis() - start;
        return "{"
                + "\"status\":" + json(status[0]) + ","
                + "\"exception\":" + json(exception[0]) + ","
                + "\"where\":" + json(where[0]) + ","
                + "\"stdout\":" + json(outBuf.text()) + ","
                + "\"stderr\":" + json(errBuf.text()) + ","
                + "\"ms\":" + ms
                + "}";
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** First stack frame that is in the student's code, e.g. "Main.main(Main.java:34)". */
    private static String studentFrame(Throwable t) {
        for (StackTraceElement e : t.getStackTrace()) {
            String c = e.getClassName();
            if (!c.startsWith("java.") && !c.startsWith("javax.") && !c.startsWith("sun.")
                    && !c.startsWith("jdk.") && !c.startsWith("GraderHarness")) {
                return e.toString();
            }
        }
        return "";
    }

    @SuppressWarnings({"deprecation", "removal"})
    private static void installExitBlocker() {
        try {
            System.setSecurityManager(new SecurityManager() {
                @Override
                public void checkExit(int status) {
                    throw new ExitCalled(status);
                }

                @Override
                public void checkPermission(java.security.Permission perm) {
                    // allow everything else
                }

                @Override
                public void checkPermission(java.security.Permission perm, Object ctx) {
                    // allow everything else
                }
            });
        } catch (Throwable ignored) {
            // Not supported on this runtime; System.exit will just end the run.
        }
    }

    @SuppressWarnings({"deprecation", "removal"})
    private static void restoreSecurityManager(SecurityManager old) {
        try {
            System.setSecurityManager(old);
        } catch (Throwable ignored) {
            // ignore
        }
    }

    @SuppressWarnings({"deprecation", "removal"})
    private static void stopThread(Thread t) {
        try {
            t.interrupt();
            t.stop();
        } catch (Throwable ignored) {
            // Thread.stop is unavailable on newer JVMs; the thread is a daemon.
        }
    }

    private static void deleteRecursive(File f) {
        if (!f.exists()) {
            return;
        }
        File[] kids = f.listFiles();
        if (kids != null) {
            for (File k : kids) {
                deleteRecursive(k);
            }
        }
        f.delete();
    }

    private static String json(String s) {
        if (s == null) {
            return "\"\"";
        }
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append('"').toString();
    }

    /**
     * Command-line entry point. The browser page runs this with CheerpJ's
     * cheerpjRunMain (the same way JavaFiddle runs javac), and reads the result file.
     *
     *   run  classDir mainClass stdinFile timeoutMs maxChars outFile
     *        runs a student's program and writes the JSON result to outFile
     *
     *   test file.java [MainClass] [typed input with \n]
     *        desktop check: compile one file and run it
     */
    public static void main(String[] args) throws Exception {
        if (args.length >= 5 && (args[0].equals("compile") || args[0].equals("compileInto"))) {
            // compile|compileInto  outDir  sourceListFile  classPath("-" for none)  resultFile  [javaLevel]
            writeFile(args[4], compileCommand(args[0], args[1], args[2], args[3], args.length >= 6 ? args[5] : null));
            return;
        }
        if (args.length >= 7 && args[0].equals("run")) {
            writeFile(args[6], runCommand(args[1], args[2], args[3], args[4], args[5]));
            return;
        }
        String file = args[0].equals("test") ? args[1] : args[0];
        int shift = args[0].equals("test") ? 1 : 0;
        String out = System.getProperty("java.io.tmpdir") + "/grader-test";
        String compiled = compile(out, file);
        System.out.println(compiled);
        if (compiled.startsWith("0")) {
            String input = args.length > 2 + shift ? args[2 + shift].replace("\\n", "\n") : "";
            System.out.println(run(out, args.length > 1 + shift ? args[1 + shift] : "Main", input, 5000, 200000));
        }
    }

    // ------------------------------------------------------------------
    // Library mode: js/runner.js keeps one Java session loaded with
    // cheerpjRunLibrary and calls these directly. cheerpjRunMain reloads the
    // compiler on every call (about 15 s each in CheerpJ's Java 17).
    // ------------------------------------------------------------------

    /** compile|compileInto, as in main(); returns the result text instead of writing a file. */
    public static String compileCommand(String command, String outDir, String sourceListFile, String classPath,
                                        String javaLevel) throws Exception {
        useJavaLevel(javaLevel);
        String list = stageSources(outDir, readFile(sourceListFile));
        String cp = classPath == null || classPath.equals("-") ? "" : classPath;
        return "compile".equals(command) ? compileClean(outDir, list, cp) : compileInto(outDir, list, cp);
    }

    /** run, as in main(); returns the JSON result. Numbers come as text so JavaScript can pass strings only. */
    public static String runCommand(String classDir, String mainClass, String stdinFile, String timeoutMs,
                                    String maxChars) throws Exception {
        return run(classDir, mainClass, readFile(stdinFile), Integer.parseInt(timeoutMs.trim()),
                Integer.parseInt(maxChars.trim()));
    }

    /**
     * CheerpJ's /str/ folder only holds flat file names, but javac needs each
     * file named after its class. A list line "Main.java<TAB>/str/x_1.txt" is
     * copied to <outDir>_src/Main.java; plain paths are used as they are.
     */
    private static String stageSources(String outDir, String list) throws Exception {
        String base = outDir.endsWith("/") ? outDir.substring(0, outDir.length() - 1) : outDir;
        File srcDir = new File(base + "_src");
        StringBuilder paths = new StringBuilder();
        for (String line : list.split("\n")) {
            if (line.trim().length() == 0) {
                continue;
            }
            int tab = line.indexOf('\t');
            if (tab < 0) {
                paths.append(line.trim()).append('\n');
                continue;
            }
            File target = new File(srcDir, line.substring(0, tab).trim());
            writeFile(target.getPath(), readFile(line.substring(tab + 1).trim()));
            paths.append(target.getPath()).append('\n');
        }
        return paths.toString();
    }

    private static String compileClean(String outDir, String sourceList, String classPath) {
        deleteRecursive(new File(outDir));
        return compileInto(outDir, sourceList, classPath);
    }

    private static void writeFile(String path, String text) throws Exception {
        File f = new File(path);
        if (f.getParentFile() != null) {
            f.getParentFile().mkdirs();
        }
        java.io.Writer w = new java.io.OutputStreamWriter(new java.io.FileOutputStream(f), "UTF-8");
        w.write(text);
        w.close();
    }

    private static String readFile(String path) throws Exception {
        java.io.InputStream in = new java.io.FileInputStream(path);
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int n;
        while ((n = in.read(chunk)) > 0) {
            buf.write(chunk, 0, n);
        }
        in.close();
        return buf.toString("UTF-8");
    }
}
