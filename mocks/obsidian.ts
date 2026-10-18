// A minimal stand-in for the parts of the `obsidian` package this plugin
// uses. The real package ships only type declarations; its runtime is
// provided by the Obsidian app, so unit tests need this replacement.
import { parse } from "yaml";

// Mirrors the real declaration, which returns `any`.
export function parseYaml(text: string): any {
  return parse(text);
}

export class Component {
  load(): void {
    this.onload();
  }
  onload(): void {}
  unload(): void {
    this.onunload();
  }
  onunload(): void {}
  addChild<T extends Component>(component: T): T {
    component.load();
    return component;
  }
  register(cb: () => unknown): void {}
  registerEvent(eventRef: unknown): void {}
}

export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super();
  }
}

export class Plugin extends Component {}

export abstract class TAbstractFile {
  path = "";
  name = "";
}

export class TFile extends TAbstractFile {
  basename = "";
  extension = "md";
}
