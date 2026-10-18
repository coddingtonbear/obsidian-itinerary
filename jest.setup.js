// Obsidian plugins use window.setTimeout etc. in plugin code.
// In the Node test environment there is no window object, so alias the global.
if (typeof window === "undefined") {
  global.window = global;
}
