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
                        "on-primary-container": "#1b2238",
                        "outline": "#777e8d",
                        "tertiary-fixed-dim": "#d8bd91",
                        "on-secondary": "#2b2113",
                        "surface": "#17191e",
                        "secondary": "#e2b97d",
                        "primary-fixed-dim": "#93a6ff",
                        "surface-dim": "#101114",
                        "on-surface": "#f0f1f3",
                        "on-tertiary": "#2a2015",
                        "inverse-surface": "#e5e7eb",
                        "surface-variant": "#282b33",
                        "background": "#101114",
                        "surface-container": "#1a1d23",
                        "outline-variant": "rgba(255,255,255,0.1)",
                        "primary-fixed": "#c7d0ff",
                        "error": "#ffb4ab",
                        "inverse-on-surface": "#1a1d23",
                        "secondary-container": "#423119",
                        "primary-container": "#8299f7",
                        "on-error": "#690005",
                        "surface-tint": "#a7b8ff",
                        "tertiary-fixed": "#f0d8ad",
                        "on-secondary-fixed-variant": "#56411f",
                        "on-tertiary-fixed": "#2a2010",
                        "on-primary-fixed-variant": "#35437f",
                        "surface-container-low": "#14161b",
                        "surface-container-high": "#23262e",
                        "on-primary-fixed": "#17204a",
                        "surface-container-lowest": "#0b0c0f",
                        "tertiary": "#e6bd80",
                        "error-container": "#93000a",
                        "surface-container-highest": "#2d313b",
                        "on-background": "#f0f1f3",
                        "on-tertiary-container": "#ffe7bf",
                        "secondary-fixed": "#f7dbad",
                        "inverse-primary": "#4052a0",
                        "on-tertiary-fixed-variant": "#5e4927",
                        "secondary-fixed-dim": "#e5bc7d",
                        "on-error-container": "#ffdad6",
                        "on-primary": "#161b31",
                        "primary": "#a7b8ff",
                        "tertiary-container": "#70552b",
                        "on-secondary-fixed": "#2b210e",
                        "on-secondary-container": "#ffdfad",
                        "on-surface-variant": "#a7acb8",
                        "surface-bright": "#353943"
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

module.exports.content = ['./web/**/*.html', './web/**/*.js'];
