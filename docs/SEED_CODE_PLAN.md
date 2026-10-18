# Seed Code Plan: show seeds as a 4-character code

Source: Thoughts agent for Argi, 2026-10-17. Planning only.

**Status: done (implemented; confirmed by Argi, 2026-10-17).**

SEED CODE PLAN: show seeds as a 4-character code

Problem: the seed range is 0 to 16,777,215 (2^24). With a decimal readout, about 99.4% of dice rolls land above 100,000, so seeds look like long, similar 7–8 digit numbers that are hard to remember.

Decision:
1. Storage doesn't change. The seed stays an integer from 0 to 16,777,215 in patches, params and the engine. The code exists only for display and input.
2. Display: 4 characters of URL-safe base64 (A–Z a–z 0–9 - _). 64^4 = 2^24 exactly, so the code and the integer map one-to-one. Example: `P6nC`.
3. Scramble before encoding: run the integer through a reversible 24-bit bit-mix (e.g. multiply by an odd constant mod 2^24, then an xor-shift, with a matching inverse) so neighboring seeds like 1000 and 1001 get unrelated-looking codes. The mix is applied only at the display/input boundary, so the stored integer stays the same.
4. Input is forgiving: the field accepts either a 4-character code or a plain decimal number, and both set the same stored integer.
5. The dice button rolls a new integer, and the field shows its code (e.g. 🎲 P6nC).
6. Future option, not in scope now: because the code is exactly 24 bits, it can convert directly to an #RRGGBB color (a seed swatch, display tint, shader input or cable color) with nothing lost.

Notes: one shared encode/decode helper for every seed widget (JS UI side; the engine never needs it). The known downside is that base64 mixes upper and lower case, so l/I/O/0 look-alikes are possible; Argi accepted that in exchange for the 4-character length. Crockford base32 (5 characters) was considered and set aside.

Open question for the implementer: confirm where the new seed widget with the dice button lives and whether any saved patches or URLs show seeds as decimals; those should keep loading, since storage doesn't change.

## Addendum: hex color input

- The input accepts three forms: a 4-character base64 code (`P6nC`), a plain decimal number (`1000`), or a hex color (`#3FA9C2`, also short `#3AC`, case-insensitive). The leading `#` tells hex apart from the other two.
- Hex is the raw 24-bit seed integer (0x000000–0xFFFFFF), not the scrambled value, so `#0003E8` = seed 1000. That way a future seed-to-color feature uses the same number the user typed.
- The display still shows the 4-character code. Showing hex or a swatch stays a later option.
- Shorthand `#RGB` expands the CSS way (#3AC to #33AACC).

## Decisions (Argi, 2026-10-17)

1. ~~Any 4-character input is always parsed as a code.~~ **Superseded by decision 3** (revised the same day).
2. **Alphabet confirmed:** letters + digits base64 (URL-safe, A–Z a–z 0–9 - _). Letters only would need 5 characters.
3. **Revised (supersedes decision 1): codes carry a `~` prefix.** Codes are written `~P6nC`; the display shows 🎲 ~P6nC. Input parsing:
   - `~xxxx` = code (4 base64 characters after `~`).
   - `#` = hex color, the raw 24-bit seed: `#RGB` and `#RRGGBB`. `#RRGGBBAA` is also accepted: the last 2 hex characters (alpha) are dropped and `#RRGGBB` is the seed. `#RGBA` (4 hex) expands CSS-style to `#RRGGBBAA`, then drops alpha the same way. So `#3FA9C2FF` gives the same seed as `#3FA9C2` (Argi, 2026-10-17).
   - Bare digits (any length) = decimal.
   - Why `~`: `!` looks like irrational/factorial, `@` is email, `$` is regex.
4. **Bare 4-character input with a non-digit** (e.g. `P6nC`, no `~`) is still read as a code. Bare digits stay decimal (decision 3).
5. **Stepping operates on the displayed code** (code space, i.e. the scrambled value), not the stored integer. Each step un-scrambles the result back to the stored integer.
   - +/− click: steps the last character by 1 (±1).
   - Click + 1 modifier: ±64 (2 characters' worth).
   - Click + 2 modifiers: ±64^2 = 4096 (3 characters).
   - Click + 3 modifiers: ±64^3 = 262144 (4 characters).
   - All steps wrap within 2^24.
   - Alt+click = random, same as the dice button.
   - Implementer picks which three modifiers (Shift / Ctrl / Meta) count; Alt is reserved for random. The current widget (`node-graph-seed-control.js`) uses Ctrl = 10, Ctrl+Shift = 100, Ctrl+Alt+Shift = 1000 on the integer, which uses Alt and has to change.
   - Drag: same per-character stepping as clicks, in code space (decision 6; replaces today's `10^(digits-2)` decimal drag step).
6. **Drag** uses the same per-character stepping as clicks.
7. **Scramble constants:** the implementer picks the odd multiplier + xor-shift (with matching inverse) once and freezes them forever, verified by a round-trip test over all 2^24 values.

## Notes from the repo (Grok Bot, 2026-10-17)

**Where the seed widget lives** (answers the open question):
- `public/node-graph-seed-control.js`: the `[NUMBER][🎲][+][−]` control decorating every `kind: "seed"` parameter row (`.node-parameter-row-seed`). The 🎲 button and Alt+click on +/− roll `randomIn` (uniform min..max); +/− step 1 / 10 / 100 / 1000 and wrap; dragging the number steps `10^(digits-2)`; double-click opens the typed-value editor. `fitSeedNumber` sizes the text to the character count (4 characters will render larger than today's 7–8 digits).
- Styles: `public/styles.css` ~L25607 ("Seed control [NUMBER][🎲][+][−]").
- GL graph: `public/node-graph-gl-graph.js` draws the seed control and dice cells itself (~L336, L359–380, L508–529), so the readout text it draws must come from the same helper.
- Display text: `formatNodeSliderNumber` in `public/node-graph-slider-metadata.js` (L155) returns `String(Math.round(n))` for `kind === "seed"`. This is the one place to swap in the code.
- Typed input: `public/node-graph-slider-dragging.js` (~L320) strips commas/spaces for seeds before parsing; the new code / decimal / hex parser goes here. `normalizeNodeSliderValue` (`node-graph-slider-values.js` ~L530) wraps the integer into min..max and stays as is.
- Definitions declare seeds as `kind: "seed"`, `min 0`, `max 16777215`, `step 1` (e.g. `node-graph-module-definitions.js` L1303, L1427).
- Note: `public/node-graph-seed-control.js` and `public/node-graph-gl-graph.js` have uncommitted edits from another agent right now; coordinate before implementing.

**Saved patches and URLs:**
- Patches store seeds as plain decimal integers in `params` (e.g. `"seed": 12328661` in `patches/livedemos/softpop.json`; 107 numeric seed values across `patches/`). Since storage doesn't change, they keep loading with no migration.
- No URL query parameter carrying a seed was found in `public/`.

**Gaps for the implementer / Argi:** all resolved (2026-10-17); no open questions remain. The plan's original implementer question (where the widget lives, decimal seeds in patches/URLs) is answered above.
- ~~**Decimal vs code ambiguity** (all-digit 4-character input).~~ **Resolved (Argi, 2026-10-17, revised again):** typed text is always a 4-character code, including all-digit codes such as `1000`. No `~` prefix. `#rgb` / `#rrggbb` is a color, and the seed becomes that color. It is not hex number entry. Decimal entry is not supported. `-` is a code character.
- ~~**+/− and drag on a scrambled display.**~~ **Resolved (Argi, 2026-10-17, decisions 5 and 6):** clicks and drag both step per character in code space.
- ~~**Scramble constants.**~~ **Resolved (Argi, 2026-10-17, decision 7):** the implementer picks the odd multiplier + xor-shift (with inverse) once and freezes them forever; a round-trip test over all 2^24 values verifies them (plus the hex and decimal examples, `#0003E8` = 1000, `#3AC` = `#33AACC`).

**APP_POLICY check:**
- No JS DSP: complies. The helper is UI-only (display/input boundary); the engine and patches still get the integer.
- Labels: the parameter keeps the full-word label **Seed**; the code is a value readout, not a label abbreviation (APP_POLICY §11 L406).
- Stored values (§18 "A stored 0 is a value"): seed 0 must show its own code, never be replaced by a default.
- No legacy shims (§1): none needed, since storage is unchanged. Typed entry is the code. Decimal input is not supported.
