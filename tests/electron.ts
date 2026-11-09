export {};

// Native focus and clipboard are shared, so the complete suite runs sequentially.
await import('./editor.electron');
await import('./hosting.electron');
