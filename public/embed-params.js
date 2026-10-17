// Embed URL aliases, run before boot so every later reader sees canonical params.
//   ?patch=<slug>  -> ?pagePatch=<slug>
//   ?embed=1       -> ?hideui=1&autoframe=1 (chrome-less player frame)
//   ?bg=<css color> -> perform background (--soemdsp-perform-bg), any CSS color incl. alpha:
//                     rgba(r,g,b,a), #rrggbbaa, transparent. Invalid values are ignored.
// See docs/EMBED.md.
(function soemdspEmbedParams() {
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams;
    let changed = false;
    const patch = String(q.get("patch") || "").trim();
    if (patch && !q.get("pagePatch")) {
      q.set("pagePatch", patch);
      changed = true;
    }
    const embed = String(q.get("embed") || "").trim().toLowerCase();
    if (embed === "1" || embed === "true" || embed === "yes") {
      for (const key of ["hideui", "autoframe"]) {
        if (!q.has(key)) {
          q.set(key, "1");
          changed = true;
        }
      }
      document.documentElement.classList.add("soemdsp-embed");
    }
    const bg = String(q.get("bg") || "").trim();
    if (bg && window.CSS && CSS.supports("color", bg)) {
      document.documentElement.style.setProperty("--soemdsp-perform-bg", bg);
    }
    if (changed) {
      window.history.replaceState(window.history.state, "", url.toString());
    }
  } catch (_error) {
    // Bad URL: boot normally.
  }
})();
