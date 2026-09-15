// Vite's `?raw` suffix imports a file as a string (used by tests/contrast.test.ts to read ui/app.css).
declare module '*?raw' {
  const content: string;
  export default content;
}
