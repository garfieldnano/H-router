#!/bin/bash
# Fill missing sparse-index cache entries for cargo 1.99 by fetching them
# with curl (tolerates the egress proxy's slow start, unlike cargo's
# 30s low-speed abort) and writing them in cargo's .cache format.
# Usage: fill-index-cache.sh  (loops until generate-lockfile --offline succeeds)
set -u
export PATH="$HOME/.cargo/bin:$PATH"
NEWI="$HOME/.cargo/registry/index/index.crates.io-1949cf8c6b5b557f/.cache"
cd ~/workspace/analysis/9router/relay || exit 1

idx_path() {
  local name="$1" len=${#1}
  if [ "$len" -eq 1 ]; then echo "1/$name";
  elif [ "$len" -eq 2 ]; then echo "2/$name";
  elif [ "$len" -eq 3 ]; then echo "3/${name:0:1}/$name";
  else echo "${name:0:2}/${name:2:2}/$name"; fi
}

fetch_index() {
  local name="$1" path dest tmp hdr etag
  path=$(idx_path "$name")
  dest="$NEWI/$path"
  [ -f "$dest" ] && return 0
  tmp=$(mktemp); hdr=$(mktemp)
  if ! curl -s --retry 3 --retry-all-errors --max-time 240 -D "$hdr" -o "$tmp" "https://index.crates.io/$path"; then
    echo "curl failed for $name"; rm -f "$tmp" "$hdr"; return 1
  fi
  etag=$(grep -i '^etag:' "$hdr" | head -1 | tr -d '\r' | sed 's/^[Ee][Tt][Aa][Gg]: *//;s/"//g')
  mkdir -p "$(dirname "$dest")"
  python3 - "$tmp" "$dest" "$etag" <<'PYEOF'
import sys, json
raw = open(sys.argv[1], 'rb').read().decode()
entries = []
for line in raw.splitlines():
    if not line.strip():
        continue
    entries.append((json.loads(line)["vers"], line))
with open(sys.argv[2], 'wb') as f:
    f.write(bytes([3, 2, 0, 0, 0]))
    f.write(('etag: "%s"' % sys.argv[3]).encode() + b'\x00')
    for v, line in entries:
        f.write(("%s\x00%s\x00" % (v, line)).encode())
print("wrote %s (%d versions)" % (sys.argv[2], len(entries)))
PYEOF
  rm -f "$tmp" "$hdr"
}

for i in $(seq 1 100); do
  out=$(cargo generate-lockfile --offline 2>&1)
  if [ -f Cargo.lock ]; then echo "LOCKFILE OK after $i iterations"; echo "$out" | tail -3; exit 0; fi
  missing=$(echo "$out" | sed -n 's/.*no matching package named .\([A-Za-z0-9_.-]*\).*/\1/p' | head -1)
  if [ -z "$missing" ]; then echo "FAILED (not a missing-package error):"; echo "$out" | tail -20; exit 1; fi
  echo "[$i] missing index entry: $missing"
  fetch_index "$missing" || { echo "fetch failed for $missing"; exit 1; }
done
echo "too many iterations"; exit 1
