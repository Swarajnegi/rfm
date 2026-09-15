// Extracted verbatim from the inline <script id="tailwind-config"> that the
// Tailwind CDN used to read at runtime. Tailwind v4 consumes it via @config in
// src/app.css, so the 47 colour / 24 fontSize / 5 spacing keys are carried over
// byte-for-byte rather than re-typed.
/** @type {import('tailwindcss').Config} */
module.exports = {
            darkMode: "class",
            theme: {
                extend: {
                    "colors": {
                        "on-primary-container": "rgb(var(--c-on-primary-container) / <alpha-value>)",
                        "outline": "rgb(var(--c-outline) / <alpha-value>)",
                        "tertiary-fixed-dim": "rgb(var(--c-tertiary-fixed-dim) / <alpha-value>)",
                        "on-secondary": "rgb(var(--c-on-secondary) / <alpha-value>)",
                        "surface": "rgb(var(--c-surface) / <alpha-value>)",
                        "secondary": "rgb(var(--c-secondary) / <alpha-value>)",
                        "primary-fixed-dim": "rgb(var(--c-primary-fixed-dim) / <alpha-value>)",
                        "surface-dim": "rgb(var(--c-surface-dim) / <alpha-value>)",
                        "on-surface": "rgb(var(--c-on-surface) / <alpha-value>)",
                        "on-tertiary": "rgb(var(--c-on-tertiary) / <alpha-value>)",
                        "inverse-surface": "rgb(var(--c-inverse-surface) / <alpha-value>)",
                        "surface-variant": "rgb(var(--c-surface-variant) / <alpha-value>)",
                        "background": "rgb(var(--c-background) / <alpha-value>)",
                        "surface-container": "rgb(var(--c-surface-container) / <alpha-value>)",
                        "outline-variant": "rgb(var(--c-outline-variant) / <alpha-value>)",
                        "primary-fixed": "rgb(var(--c-primary-fixed) / <alpha-value>)",
                        "error": "rgb(var(--c-error) / <alpha-value>)",
                        "inverse-on-surface": "rgb(var(--c-inverse-on-surface) / <alpha-value>)",
                        "secondary-container": "rgb(var(--c-secondary-container) / <alpha-value>)",
                        "primary-container": "rgb(var(--c-primary-container) / <alpha-value>)",
                        "on-error": "rgb(var(--c-on-error) / <alpha-value>)",
                        "surface-tint": "rgb(var(--c-surface-tint) / <alpha-value>)",
                        "tertiary-fixed": "rgb(var(--c-tertiary-fixed) / <alpha-value>)",
                        "on-secondary-fixed-variant": "rgb(var(--c-on-secondary-fixed-variant) / <alpha-value>)",
                        "on-tertiary-fixed": "rgb(var(--c-on-tertiary-fixed) / <alpha-value>)",
                        "on-primary-fixed-variant": "rgb(var(--c-on-primary-fixed-variant) / <alpha-value>)",
                        "surface-container-low": "rgb(var(--c-surface-container-low) / <alpha-value>)",
                        "surface-container-high": "rgb(var(--c-surface-container-high) / <alpha-value>)",
                        "on-primary-fixed": "rgb(var(--c-on-primary-fixed) / <alpha-value>)",
                        "surface-container-lowest": "rgb(var(--c-surface-container-lowest) / <alpha-value>)",
                        "tertiary": "rgb(var(--c-tertiary) / <alpha-value>)",
                        "error-container": "rgb(var(--c-error-container) / <alpha-value>)",
                        "surface-container-highest": "rgb(var(--c-surface-container-highest) / <alpha-value>)",
                        "on-background": "rgb(var(--c-on-background) / <alpha-value>)",
                        "on-tertiary-container": "rgb(var(--c-on-tertiary-container) / <alpha-value>)",
                        "secondary-fixed": "rgb(var(--c-secondary-fixed) / <alpha-value>)",
                        "inverse-primary": "rgb(var(--c-inverse-primary) / <alpha-value>)",
                        "positive": "rgb(var(--c-positive) / <alpha-value>)",
                        "negative": "rgb(var(--c-negative) / <alpha-value>)",
                        "caution":  "rgb(var(--c-caution) / <alpha-value>)",
                        "on-tertiary-fixed-variant": "rgb(var(--c-on-tertiary-fixed-variant) / <alpha-value>)",
                        "secondary-fixed-dim": "rgb(var(--c-secondary-fixed-dim) / <alpha-value>)",
                        "on-error-container": "rgb(var(--c-on-error-container) / <alpha-value>)",
                        "on-primary": "rgb(var(--c-on-primary) / <alpha-value>)",
                        "primary": "rgb(var(--c-primary) / <alpha-value>)",
                        "tertiary-container": "rgb(var(--c-tertiary-container) / <alpha-value>)",
                        "on-secondary-fixed": "rgb(var(--c-on-secondary-fixed) / <alpha-value>)",
                        "on-secondary-container": "rgb(var(--c-on-secondary-container) / <alpha-value>)",
                        "on-surface-variant": "rgb(var(--c-on-surface-variant) / <alpha-value>)",
                        "surface-bright": "rgb(var(--c-surface-bright) / <alpha-value>)"
                    },
                    "borderRadius": {
                        "DEFAULT": "0.25rem",
                        "lg": "0.5rem",
                        "xl": "0.75rem",
                        "full": "9999px"
                    },
                    "spacing": {
                        "container-padding-desktop": "40px",
                        "container-padding-mobile": "20px",
                        "card-gap": "16px",
                        "gutter": "24px",
                        "unit": "8px"
                    },
                    "fontFamily": {
                        "body-md": ["Manrope"],
                        "display-currency-mobile": ["DM Serif Display"],
                        "display-currency": ["DM Serif Display"],
                        "headline-lg": ["DM Serif Display"],
                        "headline-md": ["DM Serif Display"],
                        "body-lg": ["Manrope"],
                        "label-caps": ["Manrope"]
                    },
                    "fontSize": {
                        "body-md": ["16px", { "lineHeight": "24px", "fontWeight": "400" }],
                        "display-currency-mobile": ["32px", { "lineHeight": "40px", "letterSpacing": "-0.01em", "fontWeight": "700" }],
                        "display-currency": ["48px", { "lineHeight": "56px", "letterSpacing": "-0.02em", "fontWeight": "700" }],
                        "headline-lg": ["32px", { "lineHeight": "40px", "fontWeight": "600" }],
                        "headline-md": ["24px", { "lineHeight": "32px", "fontWeight": "600" }],
                        "body-lg": ["18px", { "lineHeight": "28px", "fontWeight": "400" }],
                        "label-caps": ["12px", { "lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "600" }]
                    }
                }
            }
        };


// Legibility floor. The app was built for a 60+ user and shipped with 169 of its
// 240 explicit sizes below 12px. 13px is the floor and nothing may go under it —
// text-xs is used 280 times, so leaving it at Tailwind's 12px default would have
// undone the codemod that raised the arbitrary values.
module.exports.theme.extend.fontSize = Object.assign({}, module.exports.theme.extend.fontSize, {
  xs:   ['13px', { lineHeight: '18px' }],
  sm:   ['15px', { lineHeight: '22px' }],
  base: ['16px', { lineHeight: '24px' }],
  'label-caps': ['13px', { lineHeight: '18px', letterSpacing: '0.02em', fontWeight: '600' }],
});

module.exports.content = ['./web/**/*.html', './web/**/*.js'];
