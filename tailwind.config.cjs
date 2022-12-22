// eslint-disable-next-line @typescript-eslint/no-var-requires
const defaultTheme = require("tailwindcss/defaultTheme");
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  future: {
    hoverOnlyWhenSupported: true
  },
  theme: {
    colors: {
      white: "#fff",
      gray: {
        50: "#fafafa",
        100: "#f5f5f5",
        200: "#e5e5e5",
        300: "#d4d4d4",
        400: "#a3a3a3",
        500: "#737373",
        600: "#525252",
        700: "#404040",
        800: "#262626",
        900: "#171717"
      },
      blue: {
        50: "#eff6ff",
        100: "#dbeafe",
        200: "#bfdbfe",
        300: "#93c5fd",
        400: "#60a5fa",
        500: "#3b82f6",
        600: "#2563eb",
        700: "#1d4ed8",
        800: "#1e40af",
        900: "#1e3a8a"
      }

    },
    fontFamily: {
      inter: ["var(--font-inter)", ...defaultTheme.fontFamily.sans]
    }
  },
  plugins: [require("@tailwindcss/typography")]
};
