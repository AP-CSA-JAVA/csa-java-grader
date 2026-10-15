"""
Builds lib/java8-api.jar and lib/java17-api.jar for the Eclipse compiler.

Each jar holds the public class signatures (no code) of one Java release,
taken from ct.sym in a JDK 17 or newer: the same data javac uses for
`--release 8` and `--release 17`. EcjBridge gives the Eclipse compiler one
of these jars in place of the JDK "modules image", which CheerpJ lacks.

Usage (needs a JDK 17+; ct.sym is in its lib folder):
    python3 java/make_api_jars.py /path/to/jdk/lib/ct.sym lib/

ct.sym entries look like "89A/java.base/java/lang/Object.sig": the first
folder lists every release the file applies to (8, 9, A=10, B=11 ... H=17,
...), then the module, then the class path.
"""

import sys
import zipfile

RELEASES = {"8": "8", "17": "H"}


def build(ct_sym, out_dir):
    with zipfile.ZipFile(ct_sym) as ct:
        names = ct.namelist()
        for version, letter in RELEASES.items():
            out_path = f"{out_dir.rstrip('/')}/java{version}-api.jar"
            seen = set()
            with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as jar:
                for name in names:
                    parts = name.split("/")
                    if len(parts) < 3 or letter not in parts[0] or not name.endswith(".sig"):
                        continue
                    path = "/".join(parts[2:])[: -len(".sig")] + ".class"   # drop release + module folders
                    if path.endswith("module-info.class") or path in seen:
                        continue
                    seen.add(path)
                    jar.writestr(path, ct.read(name))
            print(f"{out_path}: {len(seen)} classes")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2])
