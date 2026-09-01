import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const extensionDirectory = new URL('../../../extension/', import.meta.url);

const uiModuleNames = [
  'sidepanel.js', 'dom.js', 'state.js', 'views.js', 'home.js', 'sessions-ui.js',
  'editors.js', 'pickers.js', 'tabs-ui.js', 'composer.js', 'sources.js', 'transcript.js', 'markdown.js',
];
const readUiSource = async () =>
  (await Promise.all(uiModuleNames.map(name => readFile(new URL(name, extensionDirectory), 'utf8')))).join('\n');

test('offscreen document does not access extension storage', async () => {
  const source = await readFile(new URL('offscreen.js', extensionDirectory), 'utf8');
  assert.doesNotMatch(source, /chrome\.storage/);
});

test('offscreen reconnect ignores stale socket callbacks and closes before replacing', async () => {
  const source = await readFile(new URL('offscreen.js', extensionDirectory), 'utf8');
  const connect = source.slice(source.indexOf('function connect()'), source.indexOf('\nconnect();'));
  const closeIndex = connect.indexOf('previous?.close()');
  const openIndex = connect.indexOf('new WebSocket(');

  assert.match(source, /const generation = \+\+socketGeneration/);
  assert.ok(closeIndex >= 0 && closeIndex < openIndex);
  assert.match(connect, /const isLive = \(\) => socket === nextSocket && socketGeneration === generation/);
  assert.match(connect, /nextSocket\.onopen = \(\) => \{\s*if \(!isLive\(\)\) return;/);
  assert.match(connect, /nextSocket\.onerror = \(\) => \{\s*if \(!isLive\(\)\) return;/);
  assert.match(connect, /nextSocket\.onclose = \(\) => \{\s*if \(!isLive\(\)\) return;/);
  assert.doesNotMatch(source, /socket\?\.close\(\);\s*connect\(\)/);
});

test('bootstrap reconnects only for a new offscreen document or changed port', async () => {
  const source = await readFile(new URL('background.js', extensionDirectory), 'utf8');
  const bootstrap = source.slice(source.indexOf('async function bootstrap()'), source.indexOf('\nchrome.action.onClicked'));

  assert.match(bootstrap, /const hadOffscreen = await chrome\.offscreen\.hasDocument\(\);\s*await ensureOffscreen\(\)/);
  assert.match(bootstrap, /if \(!hadOffscreen \|\| offscreenDaemonPort !== daemonPort\)/);
  assert.match(bootstrap, /chrome\.storage\.local\.set\(\{ offscreenDaemonPort: daemonPort \}\)/);
});

test('local chats URLs replace the shortcut tab or focus an existing full chats tab', async () => {
  const source = await readFile(new URL('background.js', extensionDirectory), 'utf8');
  const shortcut = source.slice(source.indexOf('async function handleChatsShortcut'), source.indexOf('\nasync function openChatsTab'));
  const matcher = source.slice(source.indexOf('function isChatsShortcut'), source.indexOf('\nasync function openChatsTab'));
  const openChats = source.slice(source.indexOf('async function openChatsTab'), source.indexOf('\nasync function ensureOffscreen'));
  const context: { URL: typeof URL; isChatsShortcut?: (url: string, port: number) => boolean } = { URL };
  runInNewContext(`${matcher}\nglobalThis.isChatsShortcut = isChatsShortcut;`, context);

  assert.equal(context.isChatsShortcut?.('http://127.0.0.1:9876/chats', 9876), true);
  assert.equal(context.isChatsShortcut?.('http://localhost:4321/chats/?from=bookmark', 4321), true);
  assert.equal(context.isChatsShortcut?.('http://[::1]:9876/chats?from=bookmark', 9876), true);
  assert.equal(context.isChatsShortcut?.('http://127.0.0.1:1234/chats', 9876), false);
  assert.equal(context.isChatsShortcut?.('https://127.0.0.1:9876/chats', 9876), false);
  assert.match(source, /chrome\.tabs\.onUpdated\.addListener\(\(tabId, changeInfo, tab\) => \{\s*if \(changeInfo\.url\) handleChatsShortcut\(tabId, changeInfo\.url, tab\.windowId\)/);
  assert.match(shortcut, /const \{ daemonPort = 9876 \} = await chrome\.storage\.local\.get\('daemonPort'\)/);
  assert.match(shortcut, /pendingChatsShortcuts\.has\(tabId\)/);
  assert.match(shortcut, /\['127\.0\.0\.1', 'localhost', '\[::1\]'\]\.includes\(parsed\.hostname\)/);
  assert.match(shortcut, /parsed\.port === String\(daemonPort\)/);
  assert.ok(shortcut.includes("&& /^\\/chats\\/?$/.test(parsed.pathname);"));
  assert.match(openChats, /getURL\('sidepanel\.html'\)/);
  assert.doesNotMatch(openChats, /layout=full/);
  assert.match(openChats, /await detach\(existing\.id\)/);
  assert.match(openChats, /await detach\(shortcutTabId\)/);
  assert.match(openChats, /chrome\.tabs\.remove\(sourceTab\.id\)/);
  assert.match(openChats, /chrome\.tabs\.update\(shortcutTabId, \{ url: baseUrl, active: true \}\)/);
  assert.doesNotMatch(openChats, /attachIfNeeded/);
  assert.ok(matcher.includes('chrome:\\/\\/newtab'));
  assert.match(matcher, /chrome\.runtime\.getURL\('ntp-redirect\.html'\)/);
  assert.match(matcher, /chrome\.runtime\.getURL\('newtab\.html'\)/);

  const tabCalls: unknown[] = [];
  const ntpContext: {
    chrome: Record<string, unknown>;
    tabCalls: unknown[];
    openChatsTab?: (windowId?: number, shortcutTabId?: number) => Promise<unknown>;
  } = {
    tabCalls,
    chrome: {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      tabs: {
        query: async () => [{ id: 41, index: 3, windowId: 7, active: true, url: 'chrome://newtab/' }],
        create: async (options: unknown) => { tabCalls.push(['create', options]); return { id: 42 }; },
        update: async (id: number, options: unknown) => { tabCalls.push(['update', id, options]); },
        remove: async (id: number) => { tabCalls.push(['remove', id]); },
      },
      windows: { update: async () => undefined },
    },
  };
  runInNewContext(
    `${matcher}\n${openChats}\nasync function detach(id) { tabCalls.push(['detach', id]); }\nglobalThis.openChatsTab = openChatsTab;`,
    ntpContext,
  );
  await ntpContext.openChatsTab?.(7);
  assert.deepEqual(JSON.parse(JSON.stringify(tabCalls)), [
    ['create', { url: 'chrome-extension://test/sidepanel.html', active: true, index: 3, windowId: 7 }],
    ['detach', 41],
    ['remove', 41],
  ]);
  assert.match(source, /message\?\.type === 'openChats'[\s\S]*?const windowId = message\.windowId \?\? sender\?\.tab\?\.windowId;[\s\S]*?openChatsTab\(windowId\)/);
  assert.match(source, /error => sendResponse\(\{ ok: false, error: error\?\.message \|\| String\(error\) \}\)/);
});

test('fullscreen rail keeps the collapse toggle on the New chat row without an active pip', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('sidepanel.html', extensionDirectory), 'utf8'),
    readFile(new URL('newtab.css', extensionDirectory), 'utf8'),
  ]);
  const toggleRule = css.match(/\.nav-toggle\s*\{([^}]*)\}/)?.[1] || '';
  const expandRule = css.match(/\.nav-expand\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(html, /<div class="nav-new-row">[\s\S]*id="nav-new-chat"[\s\S]*id="nav-toggle"[\s\S]*<\/div>\s*<nav class="nav-primary"/);
  assert.doesNotMatch(toggleRule, /align-self:\s*flex-end/);
  assert.doesNotMatch(css, /\.active::after|#6aa1ed/i);
  assert.match(css, /\.full-chats button\s*\{[\s\S]*?padding:\s*8px 10px;/);
  assert.match(css, /\.full-chats button\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  assert.match(css, /\.full-chats\s*\{[\s\S]*?gap:\s*4px;/);
  assert.doesNotMatch(css, /\.full-chats button\s*\{[\s\S]*?padding:\s*5px 16px 5px 6px;/);
  assert.match(css, /#full-nav:not\(\[hidden\]\)\s*\{[\s\S]*?background:\s*#f2f2f2;/);
  assert.match(css, /#full-nav:not\(\[hidden\]\)\s*\{[\s\S]*?border-right:\s*1px solid #dadce0;/);
  assert.doesNotMatch(css, /#full-nav[\s\S]{0,200}var\(--/);
  assert.match(expandRule, /width:\s*30px/);
  assert.match(expandRule, /height:\s*30px/);
  assert.match(expandRule, /left:\s*10px/);
});

test('side panel prompt enables a full Pi agent without terminating the running REPL', async () => {
  const [prompt, repl] = await Promise.all([
    readFile(new URL('pi-sidepanel-prompt.md', import.meta.url), 'utf8'),
    readFile(new URL('repl.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(prompt, /full Pi coding agent/);
  assert.match(prompt, /general assistant/);
  assert.match(prompt, /search memory and the web before answering/);
  assert.match(prompt, /REPL is already running/);
  assert.match(prompt, /Never run `browser-harness-js --stop` or `browser-harness-js --restart`/);
  assert.match(prompt, /Never POST `\/quit` or call `process\.exit`/);
  assert.match(prompt, /browser_eval runs page JavaScript through Runtime\.evaluate/);
  assert.match(prompt, /normal Pi tools, including read, bash/);
  assert.match(prompt, /Ignore other browser-automation skills when browser_\* or browser-harness-js can do the job/);
  assert.doesNotMatch(prompt, /aside-browser/);
  assert.match(prompt, /Do not start by reading `skills\/cdp\/SKILL\.md`/);
  assert.doesNotMatch(prompt, /Never read files|Never use bash/);
  assert.match(repl, /console\.error\('Browser Harness REPL quit requested via POST \/quit'\)/);
});

test('toolbar action opens chats and attaches without toggling', async () => {
  const source = await readFile(new URL('background.js', extensionDirectory), 'utf8');
  const actionHandler = source.slice(
    source.indexOf('chrome.action.onClicked.addListener'),
    source.indexOf('chrome.commands.onCommand.addListener'),
  );
  const attachIndex = actionHandler.indexOf('attachIfNeeded(tab.id)');

  assert.ok(actionHandler.includes('openHarness(tab)'));
  assert.ok(attachIndex >= 0);
  assert.doesNotMatch(actionHandler, /toggleAttach/);
  assert.match(source, /chrome\.sidePanel\.open/);
  assert.match(source, /isHarnessSurface\(tab\?\.url\)/);
  assert.match(source, /setPanelBehavior\(\{ openPanelOnActionClick: false \}\)/);
});

test('agent-created tabs stay backgrounded and join the collapsed Agent Tabs group', async () => {
  const [source, manifest, browserApi] = await Promise.all([
    readFile(new URL('background.js', extensionDirectory), 'utf8'),
    readFile(new URL('manifest.json', extensionDirectory), 'utf8'),
    readFile(new URL('browser-api.ts', import.meta.url), 'utf8'),
  ]);
  const createTarget = source.slice(source.indexOf("message.type === 'createTarget'"), source.indexOf("message.type === 'attachTarget'"));
  const activateTarget = source.slice(source.indexOf("message.type === 'activateTarget'"), source.indexOf('\n    }', source.indexOf("message.type === 'activateTarget'")) + 6);
  const open = browserApi.slice(browserApi.indexOf('async open('), browserApi.indexOf('\n  async snapshot(', browserApi.indexOf('async open(')));

  assert.match(createTarget, /chrome\.tabs\.create\(\{ url: requestedUrl, active: false \}\)/);
  assert.match(source, /group\.title === 'Agent Tabs'/);
  assert.match(source, /chrome\.tabs\.group/);
  assert.match(source, /chrome\.tabGroups\.update\(groupId, \{ title: 'Agent Tabs', collapsed: true \}\)/);
  assert.doesNotMatch(createTarget, /focused:\s*true/);
  assert.doesNotMatch(activateTarget, /active:\s*true|focused:\s*true/);
  assert.doesNotMatch(open, /activateTarget/);
  assert.ok((JSON.parse(manifest) as { permissions: string[] }).permissions.includes('tabGroups'));
});

test('active web tabs attach automatically while extension and daemon tabs are rejected', async () => {
  const source = await readFile(new URL('background.js', extensionDirectory), 'utf8');
  const attachableSource = source.slice(source.indexOf('async function isAttachablePage'), source.indexOf('\nfunction delay'));
  const context: {
    URL: typeof URL;
    chrome: { storage: { local: { get: () => Promise<{ daemonPort: number }> } } };
    isAttachablePage?: (url: string, allowAboutBlank?: boolean) => Promise<boolean>;
  } = {
    URL,
    chrome: { storage: { local: { get: async () => ({ daemonPort: 9876 }) } } },
  };
  runInNewContext(`${attachableSource}\nglobalThis.isAttachablePage = isAttachablePage;`, context);

  assert.equal(await context.isAttachablePage?.('https://example.test/'), true);
  assert.equal(await context.isAttachablePage?.('http://127.0.0.1:9876/chats'), false);
  assert.equal(await context.isAttachablePage?.('http://localhost:9876/sessions'), false);
  assert.equal(await context.isAttachablePage?.('http://[::1]:9876/anything'), false);
  assert.equal(await context.isAttachablePage?.('chrome-extension://example/sidepanel.html?layout=full'), false);
  assert.equal(await context.isAttachablePage?.('chrome://extensions/'), false);
  assert.match(source, /chrome\.tabs\.onActivated\.addListener\(\(\{ tabId \}\) => \{\s*if \(daemonConnected\) attachIfNeeded\(tabId\)/);
  assert.match(source, /!await isAttachablePage\(tab\.url \|\| '', allowAboutBlank\)/);
  assert.match(source, /async function attach\(tabId, reportError = true, allowAboutBlank = false\) \{\s*const tab = await chrome\.tabs\.get[\s\S]*?!await isAttachablePage\(tab\.url \|\| '', allowAboutBlank\)/);
  assert.match(attachableSource, /allowAboutBlank && url === 'about:blank'/);
  assert.match(attachableSource, /const \{ daemonPort = 9876 \} = await chrome\.storage\.local\.get\('daemonPort'\)/);
  assert.match(source, /message\.type === 'createTarget'[\s\S]*?Date\.now\(\) \+ 3000[\s\S]*?attachWithRetry\(tab\.id\)/);
  assert.match(source, /message\.type === 'connected'[\s\S]*?daemonConnected = true;\s*attachActiveTab\(\)/);
});

test('side panel target selection skips the full chats UI and daemon pages', async () => {
  const source = await readFile(new URL('tabs-ui.js', extensionDirectory), 'utf8');
  const targetSource = source.slice(source.indexOf('function isTargetPage'), source.indexOf('\nexport {'));
  const context: {
    URL: typeof URL;
    settings: { daemonPort: number };
    state: { activeTabId: number; tabs: Array<Record<string, unknown>> };
    targetId?: () => string | undefined;
  } = {
    URL,
    settings: { daemonPort: 9876 },
    state: {
      activeTabId: 1,
      tabs: [
        { tabId: 1, targetId: 'chrome-tab-1', attached: true, url: 'chrome-extension://example/sidepanel.html?layout=full' },
        { tabId: 2, targetId: 'chrome-tab-2', attached: true, url: 'http://127.0.0.1:9876/chats' },
        { tabId: 3, targetId: 'chrome-tab-3', attached: true, url: 'https://example.test/' },
      ],
    },
  };
  runInNewContext(`${targetSource}\nglobalThis.targetId = targetId;`, context);

  assert.equal(context.targetId?.(), 'chrome-tab-3');
  assert.match(targetSource, /\^\(chrome-extension\|chrome\):/);
  assert.match(targetSource, /attachedPages = state\.tabs\.filter\(isTargetPage\)/);
});

test('side panel queues busy sends by default and offers per-message actions', async () => {
  const [source, html] = await Promise.all([
    readUiSource(),
    readFile(new URL('sidepanel.html', extensionDirectory), 'utf8'),
  ]);
  const updateSend = source.slice(source.indexOf('function updateSend()'), source.indexOf('\nfunction autosize()'));
  const sendFlow = source.slice(source.indexOf('async function sendAsk('), source.indexOf('\nfunction applySseBlock'));

  assert.match(source, /busySend: 'queue'/);
  assert.match(source, /stored\.busySend[\s\S]*: 'queue'/);
  assert.match(source, /chrome\.storage\.local\.set\(\{[\s\S]*busySend: settings\.busySend/);
  assert.match(html, /name="busySend" value="queue" checked> Queue/);
  assert.match(html, /name="busySend" value="steer"> Steer/);
  assert.match(html, /name="busySend" value="now"> Send now/);
  assert.match(html, /When a reply is already running/);
  assert.match(html, /data-action="queue">Queue/);
  assert.match(html, /data-action="steer">Steer/);
  assert.match(html, /data-action="now">Send now/);
  assert.match(updateSend, /sendEl\.disabled = !promptEl\.value\.trim\(\) && attachments\.length === 0/);
  assert.match(sendFlow, /const action = wasBusy \? \(overrideAction \|\| settings\.busySend\) : 'now'/);
  assert.match(sendFlow, /queuedAsks\.push\(item\)/);
  assert.match(sendFlow, /new AbortController\(\)/);
  assert.match(sendFlow, /signal: controller\.signal/);
  assert.match(sendFlow, /request\.controller\.abort\(\)/);
  assert.match(sendFlow, /error\?\.name === 'AbortError' \|\| controller\.signal\.aborted\) finishAssistant\(assistant\)/);
  assert.doesNotMatch(sendFlow, /AbortError[^\n]+addError/);
  assert.match(sendFlow, /pauseQueueDrain = true[\s\S]*Promise\.allSettled[\s\S]*startAsk\(item\)[\s\S]*pauseQueueDrain = false/);
  assert.match(sendFlow, /\.finally\(\(\) => \{[\s\S]*inFlightAsks\.delete\(request\)[\s\S]*drainQueue\(\)/);
  assert.match(sendFlow, /if \(pauseQueueDrain \|\| activeRequests\(\)\.length > 0\) return;[\s\S]*queuedAsks\.findIndex\(item => item\.sessionId === sessionId\)[\s\S]*startAsk\(queuedAsks\.splice\(index, 1\)\[0\]\)/);
});

test('composer attaches files from picker, drop and paste and forwards image payloads', async () => {
  const [source, html, css] = await Promise.all([
    readUiSource(),
    readFile(new URL('sidepanel.html', extensionDirectory), 'utf8'),
    readFile(new URL('sidepanel.css', extensionDirectory), 'utf8'),
  ]);

  assert.match(html, /id="composer-plus"[^>]*aria-label="Attach files"/);
  assert.match(html, /id="file-input" type="file" multiple hidden/);
  assert.match(source, /composerPlus\.addEventListener\('click', \(\) => fileInput\.click\(\)\)/);
  assert.match(source, /addEventListener\('dragover'/);
  assert.match(source, /promptEl\.addEventListener\('paste'/);
  assert.match(source, /MAX_ATTACHMENT_BYTES = 10 \* 1024 \* 1024/);
  assert.match(source, /MAX_IMAGE_EDGE = 2000/);
  assert.match(source, /Look at the attached image\./);
  assert.match(source, /if \(images\.length\) body\.images = images/);
  assert.match(source, /if \(files\.length\) body\.files = files/);
  assert.match(css, /\.composer\.drop-active/);
  assert.match(css, /\.attachment-previews/);
});

test('side panel launches and switches sessions without replaying the visible transcript', async () => {
  const [source, html] = await Promise.all([
    readUiSource(),
    readFile(new URL('sidepanel.html', extensionDirectory), 'utf8'),
  ]);
  const sendAsk = source.slice(source.indexOf('async function sendAsk('), source.indexOf('\nfunction setPending'));
  const performAsk = source.slice(source.indexOf('async function performAsk('), source.indexOf('\nfunction applySseBlock'));
  const titleFlow = source.slice(source.indexOf('async function requestSessionTitle('), source.indexOf('\nfunction setPending'));

  assert.match(html, /id="session-btn"/);
  assert.match(html, /id="new-session"[^>]*>New session</);
  assert.match(html, /id="composer-plus"[^>]*aria-label="Attach files"/);
  assert.match(html, /id="file-input" type="file" multiple hidden/);
  assert.doesNotMatch(html, /id="pluck-menu"/);
  assert.match(html, /id="title-model-btn"/);
  assert.match(html, /id="title-model-label">Same as chat</);
  assert.match(html, /id="nav-toggle"/);
  assert.match(source, /titleModel: null/);
  assert.match(source, /fullNavCollapsed: false/);
  assert.match(source, /dataset\.navCollapsed = String\(collapsed\)/);
  assert.match(source, /\/sessions\/\$\{encodeURIComponent\(item\.sessionId\)\}\/title/);
  assert.match(source, /fetch\(`http:\/\/127\.0\.0\.1:\$\{settings\.daemonPort\}\/sessions`/);
  assert.match(source, /chrome\.storage\.local\.set\(\{ sessionId: id \}\)/);
  assert.match(source, /messagesEl\.replaceChildren\(siteChipWrap\)/);
  assert.match(source, /const sessionRoots = new Map\(\)/);
  assert.match(source, /parkSession\(previousId\)/);
  assert.match(source, /if \(sessionRoots\.has\(id\) \|\| hasInFlightAsk\(id\)\) restoreSession\(id\)/);
  const switchFlow = source.slice(source.indexOf('async function switchSession'), source.indexOf('\nasync function hydrateTranscript'));
  assert.doesNotMatch(switchFlow, /\.abort\(/);
  assert.match(source, /function fallbackSessionName\(prompt\)/);
  const fallbackSource = source.slice(source.indexOf('function fallbackSessionName'), source.indexOf('\nfunction updateSessionName'));
  const fallbackContext: { fallbackSessionName?: (prompt: string) => string } = {};
  runInNewContext(`${fallbackSource}\nglobalThis.fallbackSessionName = fallbackSessionName;`, fallbackContext);
  assert.equal(fallbackContext.fallbackSessionName?.('“Reddit\'s” usual take: **there isn\'t** any reason'), "Reddit's usual take: there isn't any");
  assert.doesNotMatch(fallbackContext.fallbackSessionName?.('__Markdown__ `session` # title') ?? '', /[*_`#]/);
  assert.match(source, /normalized === 'new session' \|\| normalized === 'recovered session' \|\| normalized === 'untitled session'/);
  assert.match(source, /function canReplaceSessionName\(name, prompt, reply\)/);
  assert.match(source, /function looksLikeAssistantTitle/);
  assert.match(sendAsk, /applyFallbackSessionTitle\(item\)/);
  assert.doesNotMatch(sendAsk, /requestSessionTitle/);
  assert.match(performAsk, /finishAssistant\(assistant\);[\s\S]*?if \(assistant\.bodyText\.trim\(\)\) requestSessionTitle\(\{ \.\.\.item, reply: assistant\.bodyText \}\)/);
  assert.match(titleFlow, /const body = \{ prompt: item\.prompt, reply: item\.reply \}/);
  assert.match(titleFlow, /\/title[\s\S]*?await applyFallbackSessionTitle\(item\)/);
  assert.match(source, /if \(!firstAssistantReply && text\.trim\(\)\) firstAssistantReply = text\.trim\(\)/);
  assert.match(source, /function openSession\(id\)/);
  assert.match(source, /chrome\.storage\.local\.set\(\{ lastView: 'chat', sessionId: id \}\)/);
  assert.match(source, /requestSessionTitle\(\{ sessionId: id, prompt: firstUserPrompt, reply: firstAssistantReply \}\)/);
  assert.match(source, /method: 'PATCH'/);
  assert.match(performAsk, /const body = \{ prompt: item\.prompt, harness: settings\.harness, sessionId: item\.sessionId \}/);
  assert.doesNotMatch(source, /visibleConversationPrompt/);
});

test('search tool rows prefer structured results and render favicon cards', async () => {
  const [source, css] = await Promise.all([
    readUiSource(),
    readFile(new URL('sidepanel.css', extensionDirectory), 'utf8'),
  ]);

  assert.match(source, /Array\.isArray\(event\.results\)/);
  assert.match(source, /Array\.isArray\(row\.results\) && row\.results\.length/);
  assert.match(source, /google\.com\/s2\/favicons\?domain=/);
  assert.match(source, /kind === 'search' && results\.length && row\.phase === 'end'/);
  assert.match(css, /\.result-card[\s\S]*border-radius: 10px/);
  assert.match(css, /\.result-favicon/);
});

test('settings exposes a chat model picker and persists the shared selection', async () => {
  const [source, html] = await Promise.all([
    readUiSource(),
    readFile(new URL('sidepanel.html', extensionDirectory), 'utf8'),
  ]);

  assert.match(html, /<span>Model<\/span>[\s\S]*id="settings-model-btn"/);
  assert.match(source, /togglePopover\('settingsModel'\)/);
  assert.match(source, /settingsModelLabel\.textContent = modelTitle\(settings\.model\)/);
  assert.match(source, /chrome\.storage\.local\.set\(\{[\s\S]*model: settings\.model/);
});

test('thinking completion keeps a timed collapsed row before trace wrapping', async () => {
  const [source, css] = await Promise.all([
    readUiSource(),
    readFile(new URL('sidepanel.css', extensionDirectory), 'utf8'),
  ]);
  const endThinking = source.slice(source.indexOf('function endThinking'), source.indexOf('\nfunction startAssistant'));
  const finishAssistant = source.slice(source.indexOf('function finishAssistant'), source.indexOf('\nfunction failAssistant'));
  const appendThinking = source.slice(source.indexOf('function appendAssistantBlock'), source.indexOf('\nfunction timelineBlock'));

  assert.match(endThinking, /Thought for \$\{seconds\}s/);
  assert.match(endThinking, /element\.open = false/);
  assert.match(appendThinking, /element\.open = false/);
  assert.match(finishAssistant, /endThinking\(assistant\)/);
  assert.match(finishAssistant, /collapseTrace\(assistant\)/);
  assert.match(css, /\.work-trace:not\(\[open\]\) \.thinking \{ display: none; \}/);
  assert.match(css, /\.work-trace\[open\] \.thinking/);
});

test('collapseTrace keeps only the last assistant body outside the worked trace', async () => {
  const source = await readUiSource();
  const helperSource = source.slice(source.indexOf('function formatWorked'), source.indexOf('\nfunction finishAssistant'));

  class FakeClassList {
    private element: FakeElement;
    constructor(element: FakeElement) { this.element = element; }
    contains(name: string) { return this.element.className.split(/\s+/).includes(name); }
    add(name: string) {
      if (!this.contains(name)) this.element.className = `${this.element.className} ${name}`.trim();
    }
    remove(name: string) {
      this.element.className = this.element.className.split(/\s+/).filter(value => value && value !== name).join(' ');
    }
  }

  class FakeElement {
    className = '';
    classList = new FakeClassList(this);
    children: FakeElement[] = [];
    open = false;
    parent: FakeElement | null = null;
    textContent = '';
    tagName: string;

    constructor(tagName = 'div') { this.tagName = tagName.toUpperCase(); }
    append(...elements: FakeElement[]) {
      for (const element of elements) {
        if (element.parent) element.parent.children = element.parent.children.filter(child => child !== element);
        element.parent = this;
        this.children.push(element);
      }
    }
    insertBefore(element: FakeElement, before: FakeElement) {
      if (element.parent) element.parent.children = element.parent.children.filter(child => child !== element);
      const index = this.children.indexOf(before);
      assert.notEqual(index, -1);
      element.parent = this;
      this.children.splice(index, 0, element);
    }
  }

  const context: {
    document: { createElement: (tagName: string) => FakeElement };
    collapseTrace?: (assistant: any) => void;
  } = { document: { createElement: tagName => new FakeElement(tagName) } };
  runInNewContext(`${helperSource}\nglobalThis.collapseTrace = collapseTrace;`, context);

  const turn = new FakeElement();
  const thinking = new FakeElement('details');
  thinking.className = 'thinking';
  thinking.open = true;
  const narration = new FakeElement();
  narration.className = 'assistant-body';
  const tools = new FakeElement();
  tools.className = 'tools';
  const answer = new FakeElement();
  answer.className = 'assistant-body';
  const caption = new FakeElement();
  caption.className = 'caption';
  turn.append(thinking, narration, tools, answer, caption);

  context.collapseTrace?.({ turn, caption, startedAt: Date.now() - 2000 });

  assert.equal(turn.children.filter(element => element.classList.contains('assistant-body')).length, 1);
  assert.equal(turn.children.find(element => element.classList.contains('assistant-body')), answer);
  const trace = turn.children.find(element => element.classList.contains('work-trace'));
  assert.ok(trace);
  const traceBody = trace.children[1];
  assert.ok(traceBody);
  assert.deepEqual(traceBody.children.map(element => element.className), ['thinking', 'assistant-narration', 'tools']);
  assert.equal(thinking.open, false);
});

test('new tab home searches, asks and opens chats in the same page', async () => {
  const [manifestText, redirect, html, source, stub] = await Promise.all([
    readFile(new URL('manifest.json', extensionDirectory), 'utf8'),
    readFile(new URL('ntp-redirect.html', extensionDirectory), 'utf8'),
    readFile(new URL('sidepanel.html', extensionDirectory), 'utf8'),
    readUiSource(),
    readFile(new URL('newtab.js', extensionDirectory), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText) as { chrome_url_overrides?: { newtab?: string }; side_panel?: unknown; permissions?: string[] };

  assert.equal(manifest.chrome_url_overrides?.newtab, 'ntp-redirect.html');
  assert.equal((manifest.side_panel as { default_path?: string } | undefined)?.default_path, 'sidepanel.html');
  assert.ok(manifest.permissions?.includes('sidePanel'));
  assert.match(redirect, /src="newtab\.js"/);
  assert.match(stub, /location\.replace\(chrome\.runtime\.getURL\('sidepanel\.html\?view=home'\)\)/);
  assert.match(html, /Search or type a URL/);
  assert.match(html, /Tab<\/kbd> to switch/);
  assert.match(html, /id="view-home"/);
  assert.doesNotMatch(html, /id="open-full"/);
  assert.match(source, /event\.key === 'Tab'/);
  assert.match(source, /setHomeMode\(homeMode === 'search' \? 'ask' : 'search'\)/);
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /homeForm\.addEventListener\('submit', submitHomeQuery\)/);
  assert.match(html, /id="search-suggest"/);
  assert.match(html, /id="query-ghost"/);
  assert.match(source, /chrome\.history\?\.search/);
  assert.match(source, /chrome\.bookmarks\?\.search/);
  assert.match(source, /chrome\.topSites\?\.get/);
  assert.match(source, /complete\/search\?client=firefox/);
  assert.ok(manifest.permissions?.includes('history'));
  assert.ok(manifest.permissions?.includes('bookmarks'));
  assert.ok(manifest.permissions?.includes('topSites'));
  assert.match(source, /chrome\.tabs\.getCurrent\(\)/);
  assert.match(source, /chrome\.tabs\.update\(tab\.id, \{ url: searchUrl\(value\) \}\)/);
  assert.match(source, /async function sendHomeAsk/);
  assert.match(source, /showView\('chat'\)/);
  assert.match(source, /await createSession\(\)/);
  assert.doesNotMatch(source, /openFullChats/);
  assert.doesNotMatch(source, /sidePanel\.open|type: 'openSidePanel'/);
  assert.match(source, /document\.addEventListener\('mousedown'/);
  assert.match(source, /if \(persist && name !== 'setup'\) chrome\.storage\.local\.set\(\{ lastView: name \}\)/);
  assert.match(source, /query\.get\('view'\) \|\| query\.get\('nav'\)/);
  assert.match(source, /queryView \|\| stored\.lastView/);
  assert.match(source, /showView\(requested, !queryView && requested !== stored\.lastView\)/);
  assert.match(source, /if \(!isFull\) \{[\s\S]*?showView\('chat', false\);[\s\S]*?await createSession\(\)/);
  assert.match(source, /function acceptTabComplete/);
  assert.match(source, /if \(!q\) return \[\];/);
  assert.match(source, /function addHydratedAssistant\(message\)/);
  assert.match(source, /timelineBlock\(assistant, 'thinking'\)/);
  assert.match(html, /src="layout\.js"/);
});

test('new tab rail is inset, ignores focus stealing and toggles in place', async () => {
  const [html, css, source] = await Promise.all([
    readFile(new URL('sidepanel.html', extensionDirectory), 'utf8'),
    readFile(new URL('newtab.css', extensionDirectory), 'utf8'),
    readUiSource(),
  ]);
  const mouseDown = source.slice(
    source.indexOf("document.addEventListener('mousedown'"),
    source.indexOf('searchModeBtn.addEventListener') > 0 ? source.indexOf('init();') : source.length,
  );
  const toggle = source.slice(source.indexOf('async function setNavCollapsed'), source.indexOf('\nfunction showView'));
  const expandRule = css.match(/\.nav-expand\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(html, /id="nav-expand"/);
  assert.match(html, /id="full-nav"/);
  assert.match(html, /<div class="nav-new-row">[\s\S]*id="nav-new-chat"[\s\S]*id="nav-toggle"/);
  assert.match(mouseDown, /target\.closest\('#nav-expand, #nav-toggle, #full-nav,/);
  assert.match(toggle, /document\.body\.dataset\.navCollapsed = String\(collapsed\)/);
  assert.match(toggle, /fullNav\.hidden = collapsed/);
  assert.match(toggle, /navExpandBtn\.hidden = !collapsed/);
  assert.match(toggle, /chrome\.storage\.local\.set\(\{ fullNavCollapsed: collapsed \}\)/);
  assert.doesNotMatch(toggle, /location\.replace|tabs\.create/);
  assert.match(source, /stored\.fullNavCollapsed !== false/);
  assert.match(source, /changes\.fullNavCollapsed\?\.newValue/);
  assert.match(source, /function renderHomeChats/);
  assert.doesNotMatch(source.slice(source.indexOf('function renderHomeChats'), source.indexOf('\nfunction relativeTime')), /pip|::after/);
  assert.match(expandRule, /left:\s*(?:8|9|10|11|12)px/);
  assert.match(expandRule, /top:\s*(?:8|9|10|11|12)px/);
  assert.match(expandRule, /width:\s*(?:28|29|30|31|32)px/);
  assert.match(css, /\.full-nav:not\(\[hidden\]\)\s*\{[\s\S]*?width:\s*232px/);
  assert.match(css, /\.search-area\.has-suggest/);
  assert.match(css, /\.search-suggest-copy \{[\s\S]*flex-direction:\s*column/);
});

test('suggest ranking scores fuzzy matches, frecency buckets and adaptive pins', async () => {
  const source = await readFile(new URL('home.js', extensionDirectory), 'utf8');
  const start = source.indexOf('function fuzzyScore');
  const end = source.indexOf('\nasync function topSitesMatching');
  const engine = source.slice(start, end);
  const sandbox: Record<string, unknown> = {
    queryEl: { value: 'gh' },
    hostOf: (url: string) => { try { return new URL(url).hostname; } catch { return url; } },
    searchUrl: (value: string) => `https://www.google.com/search?q=${encodeURIComponent(value)}`,
  };
  runInNewContext(engine + '\n;({ fuzzyScore, recencyWeight, rankSuggestions })', sandbox);
  const { fuzzyScore, recencyWeight, rankSuggestions } = sandbox as {
    fuzzyScore: (pattern: string, text: string) => { score: number; positions: number[] } | null;
    recencyWeight: (lastVisit: number) => number;
    rankSuggestions: (items: unknown[], q: string) => Array<{ kind: string; url: string; marks: number[] | null }>;
  };

  // fzf-style bonuses: string-start match beats mid-word, consecutive beats scattered, camel bumps.
  const boundary = fuzzyScore('git', 'github.com');
  const midword = fuzzyScore('git', 'digitize');
  assert.ok(boundary && midword, 'both match');
  assert.ok(boundary.score > midword.score, 'string-start match should beat mid-word match');
  assert.equal(JSON.stringify(boundary?.positions), '[0,1,2]');
  const consecutive = fuzzyScore('ab', 'abc');
  const scattered = fuzzyScore('ab', 'aXb');
  assert.ok(consecutive.score > scattered.score, 'consecutive match beats scattered');
  const camel = fuzzyScore('bf', 'BigFish');
  const plain = fuzzyScore('bf', 'bigfish');
  assert.ok(camel.score > plain.score, 'camelCase hump bonus applies');
  assert.equal(fuzzyScore('xyz', 'github.com'), null, 'non-matching pattern is null');

  // Firefox frecency buckets: 4d=100, 14d=70, 31d=50, 90d=30, older=10.
  const day = 86_400_000;
  assert.equal(recencyWeight(Date.now() - day), 100);
  assert.equal(recencyWeight(Date.now() - 10 * day), 70);
  assert.equal(recencyWeight(Date.now() - 20 * day), 50);
  assert.equal(recencyWeight(Date.now() - 60 * day), 30);
  assert.equal(recencyWeight(Date.now() - 200 * day), 10);
  assert.equal(recencyWeight(0), 10);

  // rankSuggestions: open tab bonus, recency blend, always a search fallback row.
  const items = [
    { kind: 'tab', title: 'Right Hand Coffee', url: 'https://righthandcoffee.com', value: 'https://righthandcoffee.com', lastVisit: Date.now(), visitCount: 1 },
    { kind: 'history', title: 'GitHub', url: 'https://github.com/dashboard', value: 'https://github.com/dashboard', lastVisit: Date.now(), visitCount: 12 },
    { kind: 'search', title: 'gh', url: 'https://www.google.com/search?q=gh', value: 'gh', lastVisit: 0, visitCount: 0 },
    { kind: 'adaptive', title: 'GitHub Gists', url: 'https://gist.github.com/mine', value: 'https://gist.github.com/mine', lastVisit: Date.now(), visitCount: 1, adaptiveCount: 8 },
  ];
  const ranked = rankSuggestions(items, 'gh');
  assert.ok(ranked.length >= 3, 'renders several rows');
  assert.ok(ranked[0].kind !== 'search', 'a local result leads');
  assert.ok(ranked.some(item => item.url === 'https://gist.github.com/mine'), 'adaptive pin ranks in list');
  const fallback = ranked[ranked.length - 1];
  assert.equal(fallback.kind, 'search');
  assert.ok(fallback.url.includes('google.com/search'), 'last row is the search fallback');
  const tabRow = ranked.find(item => item.kind === 'tab');
  assert.ok(tabRow, 'weak tab match still surfaces');
  assert.ok(ranked.every(item => item.kind !== 'search' || item.marks === null), 'search rows carry no marks');
});

test('assistant timeline appends thinking, tools and text in stream order', async () => {
  const source = await readUiSource();
  const helperSource = source.slice(
    source.indexOf('function appendAssistantBlock'),
    source.indexOf('\nfunction startAssistant'),
  );

  class FakeElement {
    className = '';
    textContent = '';
    open = false;
    children: FakeElement[] = [];

    append(...elements: FakeElement[]) {
      this.children.push(...elements);
    }

    insertBefore(element: FakeElement, before: FakeElement) {
      const index = this.children.indexOf(before);
      assert.notEqual(index, -1);
      this.children.splice(index, 0, element);
    }
  }

  const context: {
    document: { createElement: () => FakeElement };
    timelineBlock?: (assistant: any, type: string) => any;
    endThinking?: (assistant: any) => void;
  } = {
    document: { createElement: () => new FakeElement() },
  };
  runInNewContext(
    `${helperSource}\nglobalThis.timelineBlock = timelineBlock; globalThis.endThinking = endThinking;`,
    context,
  );
  assert.ok(context.timelineBlock && context.endThinking);

  const orderFor = (events: string[]) => {
    const turn = new FakeElement();
    const caption = new FakeElement();
    caption.className = 'caption';
    turn.append(caption);
    const assistant = { turn, caption, latestBlock: null, thinkingActive: false };
    for (const event of events) {
      if (event !== 'thinking') context.endThinking?.(assistant);
      context.timelineBlock?.(assistant, event === 'delta' ? 'text' : event);
    }
    return turn.children.filter(element => element !== caption).map(element => element.className);
  };

  assert.deepEqual(orderFor(['thinking', 'tools', 'delta']), ['thinking', 'tools', 'assistant-body']);
  assert.deepEqual(orderFor(['delta', 'thinking']), ['assistant-body', 'thinking']);
  assert.deepEqual(orderFor(['delta', 'tools']), ['assistant-body', 'tools']);
  assert.deepEqual(
    orderFor(['thinking', 'delta', 'thinking']),
    ['thinking', 'assistant-body', 'thinking'],
  );

  const applySse = source.slice(source.indexOf('function applySseBlock'), source.indexOf('\nfunction finishAssistant'));
  assert.match(applySse, /timelineBlock\(assistant, 'thinking'\)/);
  assert.match(applySse, /timelineBlock\(assistant, 'tools'\)/);
  assert.match(applySse, /timelineBlock\(assistant, 'text'\)/);
  assert.match(applySse, /existing\?\.toolsEl/);
});

test('side panel parses GFM pipe tables without treating lone pipe rows as tables', async () => {
  const source = await readUiSource();
  const helperSource = source.slice(source.indexOf('function hasUnescapedPipe'), source.indexOf('\nfunction renderMarkdown'));
  const context: { parseMarkdownTable?: (lines: string[], start: number) => any } = {};
  runInNewContext(
    `function isEscaped(text, index) { let count = 0; for (let i = index - 1; i >= 0 && text[i] === '\\\\'; i--) count++; return count % 2 === 1; }\n${helperSource}\nglobalThis.parseMarkdownTable = parseMarkdownTable;`,
    context,
  );

  const parsed = context.parseMarkdownTable?.([
    '| claim | verdict |',
    '| --- | :---: |',
    '| first | yes |',
    '| second | no |',
    '# Later heading',
  ], 0);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {
    header: ['claim', 'verdict'],
    alignments: ['', 'center'],
    rows: [['first', 'yes'], ['second', 'no']],
    end: 4,
  });
  assert.equal(context.parseMarkdownTable?.(['| foo | bar |'], 0), null);
  assert.match(source, /document\.createElement\('table'\)/);
  assert.match(source, /document\.createElement\('thead'\)/);
  assert.match(source, /document\.createElement\('th'\)/);
  assert.match(source, /document\.createElement\('tbody'\)/);
  assert.match(source, /document\.createElement\('td'\)/);
  assert.match(source, /!parseMarkdownTable\(lines, i\)/);
});

test('assistant sources use stripped host pills, collapse adjacent cites and expose grouped card controls', async () => {
  const [source, html, css] = await Promise.all([
    readUiSource(),
    readFile(new URL('sidepanel.html', extensionDirectory), 'utf8'),
    readFile(new URL('sidepanel.css', extensionDirectory), 'utf8'),
  ]);
  const hostSource = source.slice(source.indexOf('function sourceHost'), source.indexOf('\nfunction sourceUrlKey'));
  const groupSource = source.slice(source.indexOf('function groupSourcePills'), source.indexOf('\nfunction cancelSourceCardHide'));
  const context: {
    URL: typeof URL;
    Node: { TEXT_NODE: number; ELEMENT_NODE: number };
    sourceHost?: (url: string) => string;
    groupSourcePills?: (root: any) => void;
  } = { URL, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 } };
  runInNewContext(
    `${hostSource}\n${groupSource}\nglobalThis.sourceHost = sourceHost; globalThis.groupSourcePills = groupSourcePills;`,
    context,
  );

  assert.equal(context.sourceHost?.('https://www.michael.team/archive'), 'michael.team');
  assert.equal(context.sourceHost?.('https://reddit.com/r/ipad'), 'reddit.com');

  class FakeNode {
    nodeType: number;
    textContent: string;
    parent: FakeRoot | null = null;
    constructor(nodeType: number, textContent = '') { this.nodeType = nodeType; this.textContent = textContent; }
    get nextSibling(): FakeNode | null {
      if (!this.parent) return null;
      return this.parent.children[this.parent.children.indexOf(this) + 1] || null;
    }
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter(node => node !== this);
      this.parent = null;
    }
  }
  class FakeLink extends FakeNode {
    classList = { contains: (name: string) => name === 'cite' };
    dataset: Record<string, string> = {};
    href = '';
    attributes: Record<string, string> = {};
    _sourceValues: Array<{ url: string; host: string; label: string }>;
    constructor(url: string, host: string) {
      super(1, host);
      this.href = url;
      this._sourceValues = [{ url, host, label: host }];
    }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
  }
  class FakeRoot {
    children: FakeNode[];
    constructor(children: FakeNode[]) {
      this.children = children;
      children.forEach(node => { node.parent = this; });
    }
    querySelectorAll() { return this.children.filter(node => node instanceof FakeLink); }
  }

  const first = new FakeLink('https://www.michael.team/', 'michael.team');
  const second = new FakeLink('https://hellobrio.com/', 'hellobrio.com');
  const root = new FakeRoot([first, new FakeNode(3, ' \n '), second]);
  context.groupSourcePills?.(root);
  assert.equal(root.children.length, 1);
  assert.equal(first.textContent, 'michael.team +1');
  assert.equal(first._sourceValues.length, 2);
  assert.match(source, /a\.className = 'cite'/);
  assert.match(source, /addSourceCatalog\(assistant\.sourceCatalog, results\)/);
  assert.match(source, /snippet', 'description', 'content'/);
  assert.match(html, /id="source-card"/);
  assert.match(html, /id="source-card-prev"/);
  assert.match(html, /id="source-card-next"/);
  assert.match(source, /sourceCardPrev\.hidden = sourceCardPill\._sourceValues\.length < 2/);
  assert.match(source, /sourceCardNext\.hidden = sourceCardPill\._sourceValues\.length < 2/);
  assert.match(source, /google\.com\/s2\/favicons\?domain=/);
  assert.match(css, /\.source-card[\s\S]*border-radius: 16px/);
});

test('side panel loads local KaTeX and wires math rendering', async () => {
  const [html, source, katex] = await Promise.all([
    readFile(new URL('sidepanel.html', extensionDirectory), 'utf8'),
    readUiSource(),
    readFile(new URL('vendor/katex/katex.min.js', extensionDirectory), 'utf8'),
  ]);
  assert.match(html, /href="vendor\/katex\/katex\.min\.css"/);
  assert.match(html, /src="vendor\/katex\/katex\.min\.js"/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(source, /katex\.render\(/);
  assert.match(source, /segmentMathMarkdown/);
  assert.match(source, /appendInlines\(node, heading\[2\], math\)/);
  assert.match(source, /appendInlines\(li, lines\[i\]\.replace\(itemRe, ''\), math\)/);
  assert.match(source, /node\.textContent = segment\.source/);
  assert.ok(katex.length > 100_000);
  const context: { katex?: { renderToString: (latex: string) => string } } = {};
  runInNewContext(katex, context);
  assert.match(context.katex?.renderToString('E = mc^2') || '', /class="katex"/);
});

test('math segmentation supports TeX delimiters while skipping code and currency', async () => {
  const source = await readUiSource();
  const start = source.indexOf('const BLOCK_MATH_ENVIRONMENT');
  const end = source.indexOf('function prepareMathMarkdown');
  const context: { segmentMathMarkdown?: (markdown: string) => any[] } = {};
  runInNewContext(`${source.slice(start, end)}\nglobalThis.segmentMathMarkdown = segmentMathMarkdown;`, context);
  assert.ok(context.segmentMathMarkdown);

  const markdown = [
    '# Energy $E = mc^2$',
    '- \\(x + 1\\)',
    '$$y^2$$',
    '\\[z^3\\]',
    '\\begin{align}a &= b\\\\c &= d\\end{align}',
    '`$inline_code$`',
    '    $indented_code$',
    '~~~',
    '$fenced_code$',
    '~~~',
    'Prices $5 and $ CR stay text; so does \\$escaped$.',
  ].join('\n');
  const segments = context.segmentMathMarkdown(markdown);
  const formulas = JSON.parse(JSON.stringify(
    segments.filter(segment => segment.kind === 'math').map(segment => [segment.latex, segment.display]),
  ));
  assert.deepEqual(
    formulas,
    [
      ['E = mc^2', false],
      ['x + 1', false],
      ['y^2', true],
      ['z^3', true],
      ['\\begin{align}a &= b\\\\c &= d\\end{align}', true],
    ],
  );
});

test('panel batches streaming renders, exposes stop and jump controls, and backs off reconnects', async () => {
  const [transcript, composer, sidepanel, html, css, offscreen, background, tabsUi, sessionsUi] = await Promise.all([
    'transcript.js', 'composer.js', 'sidepanel.js', 'sidepanel.html', 'sidepanel.css', 'offscreen.js', 'background.js', 'tabs-ui.js', 'sessions-ui.js',
  ].map(name => readFile(new URL(name, extensionDirectory), 'utf8')));

  // Streaming deltas coalesce per animation frame and flush before finish/fail.
  assert.match(transcript, /scheduleRender\(body\.element, \(\) => renderStreaming\(body, /);
  assert.match(transcript, /scheduleRender\(thinking\.body,/);
  assert.match(transcript, /function finishAssistant\(assistant\) \{\s*flushRenders\(\);/);
  assert.match(transcript, /function failAssistant\(assistant, message\) \{\s*flushRenders\(\);/);
  assert.match(transcript, /messagesEl\.addEventListener\('scroll'/);

  // Stop and jump-to-latest controls exist and are wired.
  assert.match(html, /id="stop"/);
  assert.match(html, /id="jump-latest"/);
  assert.match(css, /\.stop-btn \{/);
  assert.match(css, /\.jump-latest \{/);
  // Both set display explicitly, which would otherwise override the hidden attribute.
  assert.match(css, /\.stop-btn\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.jump-latest\[hidden\] \{ display: none; \}/);
  assert.match(composer, /stopEl\.hidden = !busy/);
  assert.match(sidepanel, /#stop'\)\?\.addEventListener\('click', \(\) => stopActiveAsks\(\)\)/);
  assert.match(sidepanel, /event\.key === 'Escape' && activeRequests\(\)\.length/);

  // /ask fails fast when the daemon never sends headers.
  assert.match(composer, /const headerTimeout = setTimeout\(\(\) => controller\.abort\(new Error\(/);
  assert.match(composer, /clearTimeout\(headerTimeout\)/);

  // Offscreen reconnect uses capped exponential backoff and resets on open.
  const retry = offscreen.slice(offscreen.indexOf('function retryDelay'), offscreen.indexOf('\nfunction scheduleReconnect'));
  const delayContext: { Math: typeof Math; retryDelay?: () => number; setFailures?: (n: number) => void } = { Math };
  runInNewContext(['let failures = 0;', retry, 'globalThis.retryDelay = retryDelay;', 'globalThis.setFailures = n => { failures = n; };'].join('\n'), delayContext);
  const at = (n: number) => { delayContext.setFailures?.(n); return delayContext.retryDelay?.() ?? -1; };
  assert.ok(at(0) >= 1000 && at(0) < 1300);
  assert.ok(at(3) >= 8000 && at(3) < 8300);
  assert.ok(at(9) >= 30000 && at(9) < 30300);
  assert.match(offscreen, /nextSocket\.onopen = \(\) => \{\s*if \(!isLive\(\)\) return;\s*failures = 0;/);
  assert.doesNotMatch(offscreen, /setTimeout\(connect, 2000\)/);

  // Background state publishing is coalesced and deduplicated.
  assert.match(background, /if \(serialized === lastPublished\) return;/);
  assert.match(background, /if \(changeInfo\.url \|\| changeInfo\.title \|\| changeInfo\.status === 'complete'\) publishState\(\);/);

  // Reconnect refreshes panel data; the panel reuses an empty session on open.
  assert.match(tabsUi, /if \(state\.connected && !wasConnected\)/);
  assert.match(sidepanel, /onDaemonReconnect\(\(\) => \{/);
  assert.match(sessionsUi, /async function createSession\(\{ reuseEmpty = false \} = \{\}\)/);
  assert.match(sidepanel, /await createSession\(\{ reuseEmpty: true \}\)/);
});
