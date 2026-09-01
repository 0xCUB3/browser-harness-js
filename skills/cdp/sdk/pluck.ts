import { axView, type AxViewOptions } from './axview.ts';
import type { Session } from './session.ts';

export type PluckCard = {
  id: string;
  kind: 'tab' | 'ax' | 'quote';
  title: string;
  content: string;
};

type AxOptions = AxViewOptions & { query?: string };

const MAX_CARDS = 8;
const MAX_AX_CHARS = 6_000;
const MAX_QUOTE_CHARS = 500;

export class PluckSet {
  private cards: PluckCard[] = [];
  private nextId = 1;
  private readonly session: Session;

  constructor(session: Session) {
    this.session = session;
  }

  createApi(): {
    tab: () => Promise<PluckCard>;
    ax: (options?: AxOptions | string) => Promise<PluckCard>;
    quote: (text: string) => PluckCard;
    drop: (id: string) => boolean;
    list: () => PluckCard[];
    render: () => string;
  } {
    return {
      tab: () => this.tab(),
      ax: options => this.ax(options),
      quote: text => this.quote(text),
      drop: id => this.drop(id),
      list: () => this.list(),
      render: () => this.render(),
    };
  }

  async tab(): Promise<PluckCard> {
    const { targetInfo } = await this.session.domains.Target.getTargetInfo({});
    const title = targetInfo.title || targetInfo.url || 'Current tab';
    return this.add('tab', title, targetInfo.url || 'about:blank');
  }

  async ax(options: AxOptions | string = { interactive: true }): Promise<PluckCard> {
    const normalized: AxOptions = typeof options === 'string' ? { query: options } : options;
    const { query, ...viewOptions } = normalized;
    const effectiveOptions = Object.keys(viewOptions).length ? viewOptions : { interactive: true };
    const result = query
      ? await this.session.domains.Accessibility.queryAXTree({ accessibleName: query })
      : await this.session.domains.Accessibility.getFullAXTree({});
    const rendered = axView(result.nodes, effectiveOptions).slice(0, MAX_AX_CHARS);
    return this.add('ax', query ? `AX: ${query}` : 'Interactive AX', rendered);
  }

  quote(text: string): PluckCard {
    if (typeof text !== 'string' || !text.trim()) throw new Error('pluck.quote needs text');
    return this.add('quote', 'Quote', text.trim().slice(0, MAX_QUOTE_CHARS));
  }

  drop(id: string): boolean {
    const index = this.cards.findIndex(card => card.id === id);
    if (index < 0) return false;
    this.cards.splice(index, 1);
    return true;
  }

  list(): PluckCard[] {
    return this.cards.map(card => ({ ...card }));
  }

  render(): string {
    if (!this.cards.length) return '';
    return ['## Working set', ...this.cards.map(card => `### ${card.id} · ${card.kind} · ${card.title}\n${card.content}`)].join('\n\n');
  }

  private add(kind: PluckCard['kind'], title: string, content: string): PluckCard {
    const card = { id: `pluck-${this.nextId++}`, kind, title, content };
    this.cards.push(card);
    if (this.cards.length > MAX_CARDS) this.cards.shift();
    return { ...card };
  }
}
