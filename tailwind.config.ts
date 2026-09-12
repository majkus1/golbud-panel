import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif"
        ]
      },
      colors: {
        ink: "#17201b",
        concrete: "#e7e3d9",
        steel: "#5d6b66",
        moss: "#536b4d",
        "moss-dark": "#3f5239",
        amberline: "#d59a32"
      },
      boxShadow: {
        panel: "0 18px 45px rgba(23, 32, 27, 0.08)",
        card: "0 1px 2px rgba(23, 32, 27, 0.06), 0 8px 24px rgba(23, 32, 27, 0.05)"
      },
      borderRadius: {
        xl2: "0.875rem"
      }
    }
  },
  plugins: []
};

export default config;
