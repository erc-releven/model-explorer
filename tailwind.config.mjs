/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        panel: "0.5rem",
      },
      colors: {
        muted: "#555555",
        "node-count": "#16a34a",
        "node-selected": "#000000",
        surface: "#f7f7f7",
        "ui-border": "#d9d9d9",
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
