import { Session } from './session.ts';

export type YouTubeSearchResult = {
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
};

export type YouTubeMetadata = {
  title: string;
  channelName: string;
  url: string;
  videoId: string;
  durationSeconds: number;
  viewCount: number;
  description: string;
  publishDate: string;
  isLiveContent: boolean;
  thumbnailUrl: string;
};

export type YouTubeTranscriptLanguage = {
  languageCode: string;
  name: string;
  kind?: string;
};

export type YouTubeComment = {
  authorName: string;
  text: string;
  publishedAtText: string;
  likeCountText: string;
  replyCountText: string;
  url?: string;
};

export type YouTubeCommentsPage = {
  comments: YouTubeComment[];
  continuation?: string;
};

type Json3 = {
  events?: Array<{
    tStartMs?: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string }>;
  }>;
};

type BackgroundPage = { targetId: string; sessionId: string };
type RuntimeResult<T> = { result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
type RequestEvent = { requestId: string; request: { url: string } };

const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function createMutex(): <T>(action: () => Promise<T>) => Promise<T> {
  let tail = Promise.resolve();
  return async <T>(action: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  };
}

export function parseVideoId(videoIdOrUrl: string): string {
  const input = videoIdOrUrl.trim();
  if (VIDEO_ID.test(input)) return input;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid YouTube video id or URL: ${videoIdOrUrl}`);
  }
  const hostname = url.hostname.toLowerCase();
  let candidate: string | null = null;
  if (hostname === 'youtu.be' || hostname === 'www.youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0] ?? null;
  else if (WATCH_HOSTS.has(hostname)) {
    if (url.pathname === '/watch') candidate = url.searchParams.get('v');
    else {
      const [kind, id] = url.pathname.split('/').filter(Boolean);
      if (kind === 'shorts' || kind === 'live' || kind === 'embed') candidate = id ?? null;
    }
  }
  if (!candidate || !VIDEO_ID.test(candidate)) throw new Error(`Invalid YouTube video id or URL: ${videoIdOrUrl}`);
  return candidate;
}

export function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function eventText(event: NonNullable<Json3['events']>[number]): string {
  return (event.segs ?? []).map(segment => segment.utf8 ?? '').join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function flattenJson3(json: Json3, includeTimestamp = false): string {
  const events = (json.events ?? []).map(event => ({ event, text: eventText(event) })).filter(item => item.text);
  if (includeTimestamp) {
    return events.map(({ event, text }) => {
      const start = event.tStartMs ?? 0;
      const end = start + (event.dDurationMs ?? 0);
      return `[${formatTimestamp(start)} - ${formatTimestamp(end)}] ${text}`;
    }).join('\n');
  }
  return events.map(item => item.text).join(' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export class YouTubeApi {
  private readonly session: Session;
  private readonly runExclusive = createMutex();

  constructor(session: Session) {
    this.session = session;
  }

  async search(query: string, options: { limit?: number; lang?: string; region?: string } = {}): Promise<YouTubeSearchResult[]> {
    const limit = positiveLimit(options.limit, 10);
    const url = new URL('https://www.youtube.com/results');
    url.searchParams.set('search_query', query);
    if (options.lang) url.searchParams.set('hl', options.lang);
    if (options.region) url.searchParams.set('gl', options.region);
    return this.withBackgroundPage(url.toString(), async page => {
      const results = await this.evaluate<YouTubeSearchResult[]>(page, `(() => {
        const text = value => value?.simpleText || value?.runs?.map(run => run.text).join('') || '';
        const thumbnail = value => value?.thumbnails?.at(-1)?.url || '';
        const fromRenderer = renderer => ({
          videoId: renderer.videoId,
          url: 'https://www.youtube.com/watch?v=' + renderer.videoId,
          title: text(renderer.title),
          channelName: text(renderer.ownerText || renderer.longBylineText || renderer.shortBylineText),
          thumbnailUrl: thumbnail(renderer.thumbnail),
        });
        const dom = [...document.querySelectorAll('ytd-video-renderer')].map(node => {
          const anchor = node.querySelector('a#video-title');
          const videoId = new URL(anchor?.href || '', location.href).searchParams.get('v');
          return videoId ? {
            videoId,
            url: 'https://www.youtube.com/watch?v=' + videoId,
            title: anchor?.textContent?.trim() || '',
            channelName: node.querySelector('ytd-channel-name #text, #channel-name #text')?.textContent?.trim() || '',
            thumbnailUrl: node.querySelector('img')?.src || '',
          } : null;
        }).filter(Boolean);
        if (dom.length) return dom;
        const found = [];
        const visit = value => {
          if (!value || typeof value !== 'object') return;
          if (value.videoRenderer?.videoId) found.push(fromRenderer(value.videoRenderer));
          for (const child of Object.values(value)) visit(child);
        };
        visit(globalThis.ytInitialData);
        return found;
      })()`);
      return dedupeVideos(results).slice(0, limit);
    });
  }

  async getMetadata(videoIdOrUrl: string): Promise<YouTubeMetadata> {
    const videoId = parseVideoId(videoIdOrUrl);
    return this.withWatchPage(videoId, async page => {
      const metadata = await this.evaluate<YouTubeMetadata | null>(page, `(() => {
        const response = globalThis.ytInitialPlayerResponse;
        const details = response?.videoDetails;
        if (!details) return null;
        const micro = response?.microformat?.playerMicroformatRenderer || {};
        return {
          title: details.title || '',
          channelName: details.author || '',
          url: 'https://www.youtube.com/watch?v=' + details.videoId,
          videoId: details.videoId,
          durationSeconds: Number(details.lengthSeconds || 0),
          viewCount: Number(details.viewCount || 0),
          description: details.shortDescription || '',
          publishDate: micro.publishDate || micro.uploadDate || '',
          isLiveContent: Boolean(details.isLiveContent),
          thumbnailUrl: details.thumbnail?.thumbnails?.at(-1)?.url || '',
        };
      })()`);
      if (!metadata) throw new Error(`YouTube metadata is unavailable for ${videoId}`);
      return metadata;
    });
  }

  async listTranscriptLanguages(videoIdOrUrl: string): Promise<YouTubeTranscriptLanguage[]> {
    const videoId = parseVideoId(videoIdOrUrl);
    return this.withWatchPage(videoId, async page => this.evaluate<YouTubeTranscriptLanguage[]>(page, `(() => {
      const tracks = globalThis.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const text = value => value?.simpleText || value?.runs?.map(run => run.text).join('') || '';
      return tracks.map(track => ({
        languageCode: track.languageCode || '',
        name: text(track.name),
        ...(track.kind ? { kind: track.kind } : {}),
      }));
    })()`));
  }

  async getTranscript(videoIdOrUrl: string, options: { lang?: string; includeTimestamp?: boolean } = {}): Promise<string> {
    const videoId = parseVideoId(videoIdOrUrl);
    return this.withWatchPage(videoId, async page => {
      const tracks = await this.evaluate<Array<{ languageCode: string; baseUrl: string }>>(page, `(() =>
        (globalThis.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [])
          .map(track => ({ languageCode: track.languageCode, baseUrl: track.baseUrl })))()`);
      if (!tracks.length) throw captionsUnavailable(videoId);
      const requestedTrack = options.lang ? tracks.find(track => track.languageCode === options.lang) : undefined;
      if (options.lang && !requestedTrack) throw new Error(`Captions in language "${options.lang}" are unavailable for YouTube video ${videoId}`);

      const isTranscriptRequest = (event: RequestEvent) => {
        const url = event.request.url;
        return url.includes('timedtext') && url.includes('fmt=json3') && new URL(url).searchParams.get('v') === videoId;
      };
      const captureBody = async (): Promise<string | undefined> => {
        const requestPromise = this.session.waitFor<RequestEvent>({
          method: 'Network.requestWillBeSent',
          sessionId: page.sessionId,
          predicate: isTranscriptRequest,
          timeoutMs: 12_000,
        });
        const clicked = await this.evaluate<boolean>(page, `(async () => {
          const deadline = Date.now() + 5000;
          let expanded = false;
          while (Date.now() < deadline) {
            if (!expanded) {
              const expand = document.querySelector('tp-yt-paper-button#expand, #expand');
              if (expand instanceof HTMLElement) { expand.click(); expanded = true; }
            }
            const buttons = [...document.querySelectorAll('ytd-video-description-transcript-section-renderer button')];
            if (buttons.length) {
              for (const button of buttons) if (button instanceof HTMLElement) button.click();
              return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          return false;
        })()`, true);
        if (!clicked) {
          void requestPromise.catch(() => undefined);
          return undefined;
        }

        let request: RequestEvent;
        try {
          request = await requestPromise;
        } catch {
          return undefined;
        }
        await sleep(1_500);
        if (requestedTrack && requestedTrack.languageCode !== tracks[0]?.languageCode) {
          const captured = new URL(request.request.url);
          const desired = new URL(requestedTrack.baseUrl);
          const pot = captured.searchParams.get('pot');
          if (pot) desired.searchParams.set('pot', pot);
          desired.searchParams.set('fmt', 'json3');
          return this.evaluate<string>(page, `fetch(${JSON.stringify(desired.toString())}, { credentials: 'include' }).then(response => response.text())`, true);
        }
        try {
          const response = await this.session._call('Network.getResponseBody', { requestId: request.requestId }, { sessionId: page.sessionId }) as { body: string; base64Encoded?: boolean };
          return response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body;
        } catch {
          return undefined;
        }
      };

      let body = await captureBody();
      if (!body?.trim()) body = await captureBody();
      if (!body?.trim()) throw captionsUnavailable(videoId);
      let json: Json3;
      try { json = JSON.parse(body) as Json3; }
      catch { throw captionsUnavailable(videoId); }
      const transcript = flattenJson3(json, options.includeTimestamp);
      if (!transcript) throw captionsUnavailable(videoId);
      return transcript;
    });
  }

  async getComments(videoIdOrUrl: string, options: { limit?: number; continuation?: string } = {}): Promise<YouTubeCommentsPage> {
    const videoId = parseVideoId(videoIdOrUrl);
    const limit = positiveLimit(options.limit, 20);
    return this.withWatchPage(videoId, async page => this.evaluate<YouTubeCommentsPage>(page, `(async () => {
      const limit = ${limit};
      const suppliedContinuation = ${JSON.stringify(options.continuation ?? '')};
      const text = value => value?.simpleText || value?.runs?.map(run => run.text).join('') || '';
      const findContinuation = root => {
        const found = [];
        const visit = (value, insideReplies = false) => {
          if (!value || typeof value !== 'object') return;
          const token = value.continuationEndpoint?.continuationCommand?.token;
          if (token && !insideReplies) found.push(token);
          for (const [key, child] of Object.entries(value)) visit(child, insideReplies || key === 'commentRepliesRenderer');
        };
        visit(root);
        return found.at(-1) || '';
      };
      const collect = root => {
        const comments = [];
        for (const mutation of root?.frameworkUpdates?.entityBatchUpdate?.mutations || []) {
          const entity = mutation.payload?.commentEntityPayload;
          if (!entity) continue;
          const likeCount = entity.toolbar?.likeCountNotliked?.trim()
            || entity.toolbar?.likeCountA11y?.match(/[\\d,.]+/)?.[0] || '';
          const channelUrl = entity.author?.channelCommand?.innertubeCommand?.browseEndpoint?.canonicalBaseUrl;
          comments.push({
            authorName: entity.author?.displayName || '',
            text: entity.properties?.content?.content || '',
            publishedAtText: entity.properties?.publishedTime || '',
            likeCountText: likeCount,
            replyCountText: entity.toolbar?.replyCount || '',
            ...(channelUrl ? { url: 'https://www.youtube.com' + channelUrl } : {}),
          });
        }
        const visit = value => {
          if (!value || typeof value !== 'object') return;
          const thread = value.commentThreadRenderer;
          const renderer = thread?.comment?.commentRenderer;
          if (renderer) comments.push({
            authorName: text(renderer.authorText),
            text: text(renderer.contentText),
            publishedAtText: text(renderer.publishedTimeText),
            likeCountText: text(renderer.voteCount),
            replyCountText: text(thread.replies?.commentRepliesRenderer?.moreText),
            ...(renderer.authorEndpoint?.browseEndpoint?.canonicalBaseUrl
              ? { url: 'https://www.youtube.com' + renderer.authorEndpoint.browseEndpoint.canonicalBaseUrl }
              : {}),
          });
          for (const child of Object.values(value)) visit(child);
        };
        visit(root);
        return comments;
      };
      let continuation = suppliedContinuation;
      const comments = [];
      const key = globalThis.ytcfg?.get?.('INNERTUBE_API_KEY');
      const context = globalThis.ytcfg?.get?.('INNERTUBE_CONTEXT');
      let initialRequest = !continuation;
      while (key && context && comments.length < limit && (initialRequest || continuation)) {
        const body = initialRequest ? { context, videoId: ${JSON.stringify(videoId)} } : { context, continuation };
        initialRequest = false;
        const response = await fetch('/youtubei/v1/next?key=' + encodeURIComponent(key), {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) break;
        const data = await response.json();
        comments.push(...collect(data));
        const next = findContinuation(data);
        if (!next || next === continuation) { continuation = ''; break; }
        continuation = next;
      }
      if (!comments.length) {
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise(resolve => setTimeout(resolve, 1500));
        for (const node of document.querySelectorAll('ytd-comment-thread-renderer')) {
          const renderer = node.querySelector('ytd-comment-renderer');
          comments.push({
            authorName: renderer?.querySelector('#author-text')?.textContent?.trim() || '',
            text: renderer?.querySelector('#content-text')?.textContent?.trim() || '',
            publishedAtText: renderer?.querySelector('#published-time-text')?.textContent?.trim() || '',
            likeCountText: renderer?.querySelector('#vote-count-middle')?.textContent?.trim() || '',
            replyCountText: node.querySelector('#more-replies')?.textContent?.trim() || '',
          });
        }
      }
      return { comments: comments.slice(0, limit), ...(continuation ? { continuation } : {}) };
    })()`, true));
  }

  private async withWatchPage<T>(videoId: string, action: (page: BackgroundPage) => Promise<T>): Promise<T> {
    return this.withBackgroundPage(`https://www.youtube.com/watch?v=${videoId}`, action);
  }

  private async withBackgroundPage<T>(url: string, action: (page: BackgroundPage) => Promise<T>): Promise<T> {
    return this.runExclusive(async () => {
      if (!this.session.isConnected()) await this.session.connect();
      let targetId: string | undefined;
      try {
        targetId = (await this.session.domains.Target.createTarget({ url: 'about:blank', background: true })).targetId;
        const attached = await this.session.domains.Target.attachToTarget({ targetId, flatten: true });
        const page = { targetId, sessionId: attached.sessionId };
        await Promise.all([
          this.session._call('Page.enable', {}, { sessionId: page.sessionId }),
          this.session._call('Network.enable', {}, { sessionId: page.sessionId }),
          this.session._call('Runtime.enable', {}, { sessionId: page.sessionId }),
        ]);
        await this.session._call('Page.navigate', { url }, { sessionId: page.sessionId });
        await sleep(2_000);
        return await action(page);
      } finally {
        if (targetId) await this.session.domains.Target.closeTarget({ targetId }).catch(() => undefined);
      }
    });
  }

  private async evaluate<T>(page: BackgroundPage, expression: string, awaitPromise = false): Promise<T> {
    const response = await this.session._call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    }, { sessionId: page.sessionId }) as RuntimeResult<T>;
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'YouTube page evaluation failed');
    }
    return response.result?.value as T;
  }
}

export function createYouTubeApi(session: Session): YouTubeApi {
  return new YouTubeApi(session);
}

function captionsUnavailable(videoId: string): Error {
  return new Error(`Captions are unavailable for YouTube video ${videoId}`);
}

function positiveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error('YouTube limit must be a positive number');
  return Math.floor(value);
}

function dedupeVideos(results: YouTubeSearchResult[]): YouTubeSearchResult[] {
  const seen = new Set<string>();
  return results.filter(result => {
    if (!result.videoId || seen.has(result.videoId)) return false;
    seen.add(result.videoId);
    return true;
  });
}
