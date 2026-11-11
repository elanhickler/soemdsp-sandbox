from pathlib import Path
import re

# Collect store catalog labels -> types and categories
store = Path("public/node-graph-module-store.js").read_bytes().decode("utf-8")
defs = Path("public/node-graph-module-definitions.js").read_bytes().decode("utf-8")

# Parse catalog entries: type: { category, label }
# The catalog is in nodeGraphModuleStoreCatalog or similar early in the file
# Look for patterns like:  fooBar: {\n    category: "...",\n    ...\n    label: "...",

# Also label map at top of definitions: fooBar: "Human Name",

# Human names we need to resolve
wanted = [
  "Output", "Keyboard", "DSF Oscillator", "Spiral",
  "Additive Generator", "Additive Out",
  "Lorenz", "Fluv Noise", "Robin Sinepulse", "Attenuverter",
  "Comparator", "Vactrol", "EQ Filter ZDF", "Passive Filter",
  "Ping Pong Delay", "Clock", "t", "Text Box", "Sample Player",
  "Phone Tone", "Scan Grid", "1D Plot", "Spectrogram",
  "BADVAL Monitor", "Gravity Walker",
]

# From definitions name map: extract first occurrence of type: "Label" near the top
name_map = {}
# Get a chunk of the label dictionary
m = re.search(r"const nodeGraphModule(?:Names|Labels|TypeLabels)[^{]*\{(.*?)\n\};", defs, re.S)
# fallback: search "  typeKey: \"Label\"," in first 400 lines and throughout definitions header
lines = defs.splitlines()
# typically early: dsfOscillator: "DSF Oscillator",
for i, line in enumerate(lines[:800], 1):
    mm = re.match(r'\s+([A-Za-z0-9_]+):\s*"([^"]+)",?\s*$', line)
    if mm:
        name_map.setdefault(mm.group(2).lower(), []).append((mm.group(1), i, "defs-map"))

# store labels
for mm in re.finditer(r'^\s+([A-Za-z0-9_]+):\s*\{', store, re.M):
    typ = mm.group(1)
    # take a window
    window = store[mm.end():mm.end()+800]
    lab = re.search(r'label:\s*"([^"]+)"', window)
    cat = re.search(r'category:\s*"([^"]+)"', window)
    if lab:
        name_map.setdefault(lab.group(1).lower(), []).append((typ, cat.group(1) if cat else "?", "store"))

print("=== RESOLVE WANTED ===")
for w in wanted:
    hits = name_map.get(w.lower(), [])
    # also fuzzy contains
    if not hits:
        for k, v in name_map.items():
            if w.lower() in k or k in w.lower():
                hits.extend([(*h, "fuzzy:"+k) for h in v])
    print(w, "=>", hits[:8] if hits else "NOT FOUND")

print("\n=== GRAVITY / WALKER ===")
for k, v in sorted(name_map.items()):
    if "gravit" in k or "walker" in k or "gravity" in k:
        print(k, v)
