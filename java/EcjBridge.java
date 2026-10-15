/*
 * EcjBridge — runs the Eclipse Java compiler (ECJ) for newer Java (11–17)
 * inside CheerpJ.
 *
 * CheerpJ's Java 11/17 runtimes have no javac, and ECJ normally reads
 * Java's own classes from the JDK "modules image", which CheerpJ doesn't
 * provide. This bridge hands ECJ a plain jar of the Java API instead:
 * lib/java8-api.jar or lib/java17-api.jar (class signatures only, built from
 * OpenJDK's ct.sym, the same data javac uses for --release).
 *
 * GraderHarness calls compile(...) through reflection when a Java level is
 * given, so the harness itself stays Java 8. Errors are printed in javac's
 * format (-Xemacs: "Main.java:3: error: ..."), so the grader reads them the same way.
 *
 * Build (needs the ECJ jar; Java 17 target to match ECJ):
 *   javac --release 17 -cp lib/ecj-3.36.0.jar -d build-ecj java/EcjBridge.java
 *   jar cf lib/ecj-bridge.jar -C build-ecj .
 */

import java.io.File;
import java.io.PrintWriter;
import java.util.ArrayList;

import org.eclipse.jdt.internal.compiler.batch.FileSystem;
import org.eclipse.jdt.internal.compiler.batch.Main;

public class EcjBridge extends Main {

    private final String apiJar;

    private EcjBridge(PrintWriter out, String apiJar) {
        super(out, out, false, null, null);
        this.apiJar = apiJar;
    }

    /** Use the API jar for Java's own classes instead of the modules image. */
    @Override
    protected ArrayList<FileSystem.Classpath> handleBootclasspath(ArrayList<String> bootclasspaths, String customEncoding) {
        ArrayList<FileSystem.Classpath> result = new ArrayList<>();
        FileSystem.Classpath api = FileSystem.getClasspath(apiJar, null, null);
        if (api == null) {
            throw new IllegalStateException("Java API jar not found: " + apiJar);
        }
        result.add(api);
        return result;
    }

    /**
     * Compiles like javac's Main.compile: same arguments (-d, -cp, -encoding,
     * -nowarn, files). Returns 0 on success, 1 on compile errors.
     *
     * @param level   Java level, "8" or "17"
     * @param apiJar  path of the Java API jar for that level
     */
    public static int compile(String[] javacArgs, PrintWriter out, String level, String apiJar) {
        if (!new File(apiJar).exists()) {
            out.println("GRADER-ERROR: Java API jar not found: " + apiJar);
            return -1;
        }
        String[] args = new String[javacArgs.length + 3];
        args[0] = level.equals("8") ? "-1.8" : "-" + level;
        args[1] = "-proc:none";
        args[2] = "-Xemacs";
        System.arraycopy(javacArgs, 0, args, 3, javacArgs.length);
        boolean ok = new EcjBridge(out, apiJar).compile(args);
        out.flush();
        return ok ? 0 : 1;
    }
}
