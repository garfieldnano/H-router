#!/usr/bin/env python3
"""Download every .crate file listed in Cargo.lock that is missing from the
local cargo cache, using curl (tolerates the egress proxy's slow start,
unlike cargo's 30s low-speed abort). Cargo verifies checksums on extract."""
import os
import re
import subprocess
import sys

os.chdir(os.path.expanduser("~/workspace/analysis/9router/relay"))
CACHE = os.path.expanduser(
    "~/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f"
)
text = open("Cargo.lock").read()
pkgs = re.findall(r'\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"', text)
have = set(os.listdir(CACHE))
missing = [(n, v) for n, v in pkgs if f"{n}-{v}.crate" not in have]
print(f"missing crates: {len(missing)}", flush=True)
fails = []
for i, (name, ver) in enumerate(missing, 1):
    f = f"{name}-{ver}.crate"
    url = f"https://static.crates.io/crates/{name}/{f}"
    tmp = os.path.join(CACHE, f + ".tmp")
    r = subprocess.run(
        ["curl", "-s", "--retry", "5", "--retry-all-errors",
         "--retry-delay", "5", "--max-time", "600", "-o", tmp, url],
        capture_output=True,
    )
    ok = r.returncode == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > 0
    if ok:
        os.rename(tmp, os.path.join(CACHE, f))
        print(f"[{i}/{len(missing)}] OK {f}", flush=True)
    else:
        fails.append(f)
        print(f"[{i}/{len(missing)}] FAIL {f} rc={r.returncode}", flush=True)
        if os.path.exists(tmp):
            os.remove(tmp)
print("FAILURES:", fails if fails else "none")
sys.exit(1 if fails else 0)
