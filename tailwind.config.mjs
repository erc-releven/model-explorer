/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        panel: "0.5rem",
      },
      colors: {
        brand: "rgb(76 100 217)",
        "edge-selected": "rgb(45 58 104)",
        muted: "rgb(0 9 51)",
        "node-count": "rgb(6 122 87)",
        "node-default": "rgb(186 194 214)",
        "node-selected": "rgb(45 58 104)",
        primary: "rgb(45 58 104)",
        surface: "rgb(255 255 255)",
        "surface-alt": "rgb(245 246 250)",
        "surface-subtle": "rgb(0 21 128)",
        "text-strong": "rgb(0 6 38)",
        "ui-border": "rgb(0 17 102)",
      },
      maxWidth: {
        page: "75rem",
      },
      minHeight: {
        loader: "4.5rem",
        panel: "20rem",
        results: "11.25rem",
      },
    },
  },
};
