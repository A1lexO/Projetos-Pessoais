import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: "#0f1218", raised: "#161b24", border: "#232a36" },
        accent: { DEFAULT: "#34d399", muted: "#10b981" },
        negative: "#f87171",
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
