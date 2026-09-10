# Legacy shells

`index_new.html` and `index_old.html` are earlier generations of `web/index.html`,
kept for reference only. **Neither is shipped** — Capacitor serves `web/` and only
`web/index.html` is loaded.

They are archived here rather than left in `web/` because they are near-duplicates
of the live file (2,591 lines between them) and every `grep` across `web/` returned
three hits for every real one.

`index_old.html` is the light-theme generation with a desktop sidebar and emoji
icons; `index_new.html` is the intermediate "Stitch 3D Dark" generation and still
carries the fully retired mint/navy palette (`primary #44e5c2`, `background #051424`,
Inter + Outfit). Do not copy markup out of either — the palette in them is dead.

## Removed alongside these

`scripts/bind_alpine.py`, `scripts/copy_modals.py` and `scripts/migrate_html.py`
were one-shot generators that produced the current `index.html` from these files
and from `stitch_exports/`. They rewrote `web/index.html` **in place**, were not
idempotent, and `copy_modals.py` hardcoded `bg-[#051424]` — so running any of them
today would re-inject the retired palette into the live app. Their output is already
committed. Recover from git history if the transformation logic is ever needed:

    git log --diff-filter=D --name-only -- scripts/
