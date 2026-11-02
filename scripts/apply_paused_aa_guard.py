"""Apply only the graph-engine paused-frequency unsupported-AA silence guard."""
from pathlib import Path

path = Path('native_modules/graph_engine/graph_engine.cpp')
source = path.read_text(encoding='utf-8')
start = source.index('static void process_pulse_train(')
end = source.index('const double periodS', start)
section = source[start:end]
old = '      node.buf[kPortMono][f] = node.phase;'
new = '''      // Unsupported AA shapes stay silent even while frequency pauses DSP.
      const int aaShape = (int)(control_effective(node.oversample) + 0.5);
      const bool aaSupported = aaShape == 0 || aaShape == 1 || aaShape == 2
        || aaShape == 3 || aaShape == 6 || aaShape == 7 || aaShape == 8;
      const bool aaSilent = control_effective(node.waveform) >= 2.5 && !aaSupported;
      node.buf[kPortMono][f] = aaSilent ? 0.0 : node.phase;'''
if new in section:
    print('Paused AA silence guard already applied.')
elif section.count(old) == 1:
    path.write_text(source[:start] + section.replace(old, new) + source[end:], encoding='utf-8')
    print('Applied paused AA silence guard; rebuild combined WASM next.')
else:
    raise SystemExit('Paused branch differs; merge the guard manually rather than overwriting source.')