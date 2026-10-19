// A minimal stand-in for the parts of the `obsidian` package this plugin
// uses. The real package ships only type declarations; its runtime is
// provided by the Obsidian app, so unit tests need this replacement.
import { parse, stringify } from "yaml";

// Mirrors the real declaration, which returns `any`.
export function parseYaml(text: string): any {
  return parse(text);
}

// Mirrors the real declaration, which takes `any`.
export function stringifyYaml(obj: any): string {
  return stringify(obj);
}

export class Component {
  private cleanups: (() => unknown)[] = [];
  load(): void {
    this.onload();
  }
  onload(): void {}
  unload(): void {
    for (const cleanup of this.cleanups.splice(0)) {
      cleanup();
    }
    this.onunload();
  }
  onunload(): void {}
  addChild<T extends Component>(component: T): T {
    component.load();
    return component;
  }
  register(cb: () => unknown): void {
    this.cleanups.push(cb);
  }
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

// Obsidian adds DOM helpers to every element; tests running in a jsdom
// environment get the subset this plugin uses.
type ElementInfo = { cls?: string | string[]; text?: string };

function installDomHelpers(proto: HTMLElement): void {
  proto.createEl = function <K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tag: K,
    o?: ElementInfo | string
  ): HTMLElementTagNameMap[K] {
    const el = this.ownerDocument.createElement(tag);
    const info: ElementInfo = typeof o === "string" ? { cls: o } : o ?? {};
    if (info.cls !== undefined) {
      const classes = Array.isArray(info.cls) ? info.cls : info.cls.split(" ");
      el.classList.add(...classes.filter((c) => c.length > 0));
    }
    if (info.text !== undefined) {
      el.textContent = info.text;
    }
    this.appendChild(el);
    return el;
  } as HTMLElement["createEl"];
  proto.createDiv = function (
    this: HTMLElement,
    o?: ElementInfo | string
  ): HTMLDivElement {
    return this.createEl("div", o);
  };
  proto.empty = function (this: HTMLElement): void {
    while (this.firstChild) {
      this.removeChild(this.firstChild);
    }
  };
  proto.setText = function (this: HTMLElement, text: string): void {
    this.textContent = text;
  } as HTMLElement["setText"];
  proto.setCssProps = function (
    this: HTMLElement,
    props: Record<string, string>
  ): void {
    for (const [name, value] of Object.entries(props)) {
      this.style.setProperty(name, value);
    }
  };
}

if (typeof HTMLElement !== "undefined") {
  installDomHelpers(HTMLElement.prototype);
}
