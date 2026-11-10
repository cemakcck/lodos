// dom-accessibility-api ships its types, but its package "exports" map hides them from "Bundler" resolution.
declare module "dom-accessibility-api" {
  export function computeAccessibleName(root: Element): string;
}
