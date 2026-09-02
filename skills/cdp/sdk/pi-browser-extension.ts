// @ts-expect-error Pi provides this package when it loads the explicit extension.
import { Type } from '@earendil-works/pi-ai';
// @ts-expect-error Pi provides this package when it loads the explicit extension.
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';

const PORT = process.env.CDP_REPL_PORT ?? '9876';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ONLY_TOOLS = 'Drive the attached Chrome tab with browser_* tools, not Aside or curl. File, shell, spawn and web-search tools are allowed for everything else.';

async function request(path: string, body?: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  let result: unknown;
  try { result = text ? JSON.parse(text) : null; } catch { result = text; }
  if (!response.ok) {
    const message = result && typeof result === 'object' && typeof (result as { error?: unknown }).error === 'string'
      ? (result as { error: string }).error
      : `Browser daemon returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return result;
}

function toolResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    details: value,
  };
}

const tools = [
  defineTool({
    name: 'browser_tabs',
    label: 'Browser Tabs',
    description: `List attached browser page targets. ${ONLY_TOOLS}`,
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, signal?: AbortSignal) {
      return toolResult(await request('/browser/tabs', undefined, signal));
    },
  }),
  defineTool({
    name: 'browser_open',
    label: 'Browser Open',
    description: `Open an http(s) URL or about:blank and return its first accessibility snapshot in the same call. Do not snapshot again unless the page changed. ${ONLY_TOOLS}`,
    parameters: Type.Object({ url: Type.String({ description: 'URL to open' }) }),
    async execute(_id: string, params: { url: string }, signal?: AbortSignal) {
      return toolResult(await request('/browser/open', { url: params.url }, signal));
    },
  }),
  defineTool({
    name: 'browser_snapshot',
    label: 'Browser Snapshot',
    description: `Get the current tab accessibility snapshot with fresh [n] refs. browser_open already returns a snapshot. ${ONLY_TOOLS}`,
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, signal?: AbortSignal) {
      return toolResult(await request('/browser/snapshot', {}, signal));
    },
  }),
  defineTool({
    name: 'browser_click',
    label: 'Browser Click',
    description: `Click a [n] ref from the latest snapshot and return a fresh snapshot. ${ONLY_TOOLS}`,
    parameters: Type.Object({ ref: Type.Integer({ description: 'Latest snapshot ref number' }) }),
    async execute(_id: string, params: { ref: number }, signal?: AbortSignal) {
      return toolResult(await request('/browser/click', { ref: params.ref }, signal));
    },
  }),
  defineTool({
    name: 'browser_type',
    label: 'Browser Type',
    description: `Real-click-focus a [n] ref from the latest snapshot, insert text and return a fresh snapshot with landing diagnostics. Confirm that the intended field's text changed. ${ONLY_TOOLS}`,
    parameters: Type.Object({
      ref: Type.Integer({ description: 'Latest snapshot ref number' }),
      text: Type.String({ description: 'Text to insert' }),
    }),
    async execute(_id: string, params: { ref: number; text: string }, signal?: AbortSignal) {
      return toolResult(await request('/browser/type', params, signal));
    },
  }),
  defineTool({
    name: 'browser_press',
    label: 'Browser Press',
    description: `Press a key in the current tab (Enter to submit a field) and return a fresh snapshot. ${ONLY_TOOLS}`,
    parameters: Type.Object({ key: Type.String({ description: 'Key name, for example Enter' }) }),
    async execute(_id: string, params: { key: string }, signal?: AbortSignal) {
      return toolResult(await request('/browser/press', params, signal));
    },
  }),
  defineTool({
    name: 'browser_eval',
    label: 'Browser Eval',
    description: `Evaluate a JavaScript expression in the current tab as an escape hatch. Prefer the other browser tools. ${ONLY_TOOLS}`,
    parameters: Type.Object({ expression: Type.String({ description: 'JavaScript expression' }) }),
    async execute(_id: string, params: { expression: string }, signal?: AbortSignal) {
      return toolResult(await request('/browser/eval', params, signal));
    },
  }),
  defineTool({
    name: 'browser_screenshot',
    label: 'Browser Screenshot',
    description: `Capture a JPEG of the current tab viewport (or the full page) and return it as an image. Use this to see layout, color, and whether a visual change landed. ${ONLY_TOOLS}`,
    parameters: Type.Object({
      fullPage: Type.Optional(Type.Boolean({ description: 'Capture beyond the viewport. Default false.' })),
    }),
    async execute(_id: string, params: { fullPage?: boolean }, signal?: AbortSignal) {
      const result = await request('/browser/screenshot', { fullPage: params.fullPage === true }, signal) as { mimeType: string; data: string; title: string; url: string };
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ title: result.title, url: result.url }) },
          { type: 'image' as const, data: result.data, mimeType: result.mimeType },
        ],
        details: { title: result.title, url: result.url },
      };
    },
  }),
  defineTool({
    name: 'browser_fill',
    label: 'Browser Fill',
    description: `Replace the full value of an input or textarea [n] ref and return a fresh snapshot. Use this for Code-mode editors and settings fields. Do not select-all and type. Do not fill contenteditable this way. ${ONLY_TOOLS}`,
    parameters: Type.Object({
      ref: Type.Integer({ description: 'Latest snapshot ref number' }),
      text: Type.String({ description: 'Complete replacement value' }),
    }),
    async execute(_id: string, params: { ref: number; text: string }, signal?: AbortSignal) {
      return toolResult(await request('/browser/fill', params, signal));
    },
  }),
];

export default function (pi: ExtensionAPI) {
  for (const tool of tools) pi.registerTool(tool);
}
