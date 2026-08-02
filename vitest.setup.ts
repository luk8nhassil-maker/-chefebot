import "@testing-library/jest-dom/vitest";

// jsdom não implementa matchMedia — polyfill mínimo (sempre "não corresponde",
// nunca dispara "change") só para os testes de componente que rodam em
// ambiente jsdom; testes em ambiente "node" (a maioria) nunca veem `window`.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
