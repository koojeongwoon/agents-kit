/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0B0F17',
        surface: '#151C2C',
        border: '#26334D',
        primary: '#3B82F6',
        accent: '#8B5CF6',
      }
    },
  },
  plugins: [],
}
