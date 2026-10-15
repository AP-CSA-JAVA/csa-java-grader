# lib/

| File | What it is |
|---|---|
| `grader-harness.jar` | Built from `java/GraderHarness.java` and `java/cjgrader/LoopGuard.java`. Compiles and runs one student's program with scripted input; LoopGuard ends endless loops. |
| `ecj-3.36.0.jar` | The Eclipse Compiler for Java 3.36.0, from Maven Central (`org.eclipse.jdt:ecj`). Eclipse Public License 2.0. Compiles Java 8 through 21; it needs Java 17 to run, which matches CheerpJ's Java 17. Newer ECJ versions may need Java 21, so keep 3.36.0. |
| `ecj-bridge.jar` | Built from `java/EcjBridge.java`. Runs the Eclipse compiler with the API jars below instead of the JDK "modules image", which CheerpJ doesn't have. |
| `java8-api.jar`, `java17-api.jar` | Class signatures (no code) of Java 8 and Java 17, built by `java/make_api_jars.py` from OpenJDK's `ct.sym` (the data javac uses for `--release`). GPLv2 with the Classpath Exception. |

Rebuild only if you change the Java files (needs a JDK 17 or newer):

```
javac --release 8 -d build java/GraderHarness.java java/cjgrader/LoopGuard.java
jar cf lib/grader-harness.jar -C build .
javac --release 17 -cp lib/ecj-3.36.0.jar -d build-ecj java/EcjBridge.java
jar cf lib/ecj-bridge.jar -C build-ecj .
python3 java/make_api_jars.py <jdk>/lib/ct.sym lib/
```
