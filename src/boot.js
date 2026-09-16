// Registers Corpus's own Alpine directives, then starts Alpine.
//
// Must run AFTER app.js has registered its `alpine:init` listener and BEFORE
// Alpine.start(), which is exactly the window this file exists to occupy.

const Alpine = window.Alpine;

/* ── x-money ───────────────────────────────────────────────────────────────
   A money field that reads like money. type="number" cannot show separators,
   so amounts appeared as "185000" — legible to a parser, not to a person.
   This shows ₹1,85,000 at rest and the bare number while editing, which is the
   only moment grouping gets in the way.

   Usage:  <input x-money="networth.bankBalance">                             */
Alpine.directive('money', (el, { expression }, { evaluate, effect, cleanup }) => {
    el.type = 'text';
    el.inputMode = 'decimal';
    el.autocomplete = 'off';

    const fmt = (n) => {
        const v = Number(n);
        if (!Number.isFinite(v) || v === 0) return '';
        return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    };
    const parse = (s) => {
        const n = Number(String(s).replace(/[^0-9.-]/g, ''));
        return Number.isFinite(n) ? n : 0;
    };

    let focused = false;

    // Follow the model while the user is not typing into this field.
    effect(() => {
        const v = evaluate(expression);
        if (!focused) el.value = fmt(v);
    });

    const onFocus = () => {
        focused = true;
        const raw = parse(el.value);
        el.value = raw === 0 ? '' : String(raw);
        // Select-all so the first keystroke replaces rather than appends — the
        // behaviour people expect from a field that already holds a figure.
        // Guarded: select() on an UNFOCUSED input re-focuses it, so a blur that
        // lands within the same frame was re-firing onFocus and rewriting the
        // raw number straight back over the formatted one.
        requestAnimationFrame(() => { if (focused && document.activeElement === el) el.select(); });
    };
    const onBlur = () => {
        focused = false;
        const n = parse(el.value);
        evaluate(`${expression} = ${n}`);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Re-applied on the next frame as well as immediately: the change
        // handler can write state, which re-runs the effect above, and whichever
        // of the two lands last must be the FORMATTED value. Doing it once left
        // the raw number on screen depending on that ordering.
        el.value = fmt(n);
        requestAnimationFrame(() => { if (!focused) el.value = fmt(evaluate(expression)); });
    };

    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
    cleanup(() => {
        el.removeEventListener('focus', onFocus);
        el.removeEventListener('blur', onBlur);
    });
});

Alpine.start();
