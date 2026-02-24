import './index.css';
import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const TABSIZE = 2;
const TABSTRING = ' '.repeat(TABSIZE);
const marked = new Marked();

async function compress(text: string): Promise<string> {
    
    const readableStream = new ReadableStream({
        start(controler) {
            controler.enqueue(new TextEncoder().encode(text));
            controler.close();
        }
    })

    const compressionStream = readableStream.pipeThrough(
        new CompressionStream("gzip")
    )

    const blob = await new Response(compressionStream).blob();
    return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result! as string
            const value = (result.split(',') || ['', ''])[1]!;
            resolve(value);
        }
        reader.readAsDataURL(blob);
    });
}

async function decompress(q: string) {
    const bin = atob(q);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
    const stream = new ReadableStream({
        start(controler) {
            controler.enqueue(bytes);
            controler.close();
        }
    })

    const decompressed = stream.pipeThrough(
        new DecompressionStream("gzip")
    );

    return await new Response(decompressed).text();
}

function storeStateOnURL(b64: string) {
    window.history.pushState({}, '', `?q=${b64}`);
}


type GotoEventDetail = {
    shouldDeleteCurrent: boolean,
    shouldCreateNext: boolean,
}

class GotoPreviousBlockEvent extends CustomEvent<GotoEventDetail> {
    constructor(detail: GotoEventDetail) {
        super('gotopreviousblock', {
            detail: detail
        })
    }
}

class GotoNextBlockEvent extends CustomEvent<GotoEventDetail> {
    constructor(detail: GotoEventDetail) {
        super('gotonextblock', {
            detail: detail
        })
    }
}

type TextChangeEventDetail = {
    content: string,
}

class TextChangeEvent extends CustomEvent<TextChangeEventDetail> {
    constructor(detail: TextChangeEventDetail) {
        super('textchange', {
            detail: detail
        })
    }
}

declare global {
    interface HTMLElementEventMap {
        'gotopreviousblock': GotoPreviousBlockEvent;
        'gotonextblock': GotoNextBlockEvent;
        'textchange': TextChangeEvent;
    }
}

class MarkdownResultBlock extends HTMLElement {
    static observedAttributes = ["raw"]
    private shadow_root: ShadowRoot;
    private divEl: HTMLDivElement;

    constructor(public text: string = '') {
        super();
        this.shadow_root = this.attachShadow({ mode: 'open' });

        const styleEl = document.createElement('style');
        styleEl.textContent = `
        div {
            box-sizing: content-box;
            padding: 0px 0px 0px 7px;
        }

        p {
            margin: 0px;
        }
        `;
        this.shadow_root.appendChild(styleEl);

        this.divEl = document.createElement('div');
        this.shadowRoot?.appendChild(this.divEl);
        this.setAttribute('raw', text);
    }

    async attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        if (name !== 'raw') return;

        this.text = newValue;
        const rendered = DOMPurify.sanitize(
            await marked.parse(newValue) + '<br/>'
        );

        this.divEl.innerHTML = rendered
    }

    edit(): MarkdownEditBlock {
        const raw = this.getAttribute('raw') || ''
        const nBreaklines = (raw.match(/\n/g) || []).length + 1;
        const editBlock = new MarkdownEditBlock(nBreaklines, raw);
        return editBlock;
    }
}

class MarkdownEditBlock extends HTMLElement {
    static observedAttributes = ["content"]
    private textareaEl: HTMLTextAreaElement;

    constructor(
        private textareaRows: number = 1,
        public text: string = '',
    ) {
        super();
        this.attachShadow({ mode: 'open' });

        const styleEl = document.createElement('style');
        styleEl.textContent = `
        textarea {
            all: unset;
            display: block;
            width: 100%;
            padding: 0px 0px 0px 5px;
            font: inherit;
            background-color: white;
            border-left: #1a5fb4 3px solid;
        }
        `;
        this.shadowRoot!.appendChild(styleEl);
        this.textareaEl = document.createElement('textarea');
        this.textareaEl.value = text;
    }

    connectedCallback() {
        this.textareaEl.setAttribute('rows', this.textareaRows.toString());
        this.textareaEl.addEventListener('keydown', this.handleKeyDown.bind(this));
        this.shadowRoot!.appendChild(this.textareaEl)
    }

    render(): MarkdownResultBlock {
        return new MarkdownResultBlock(this.textareaEl.value);
    }

    override focus(options?: FocusOptions): void {
        this.textareaEl.focus(options);
    }

    dispatchGotoPreviousBlock(detail: GotoEventDetail): void {
        const gotoPreviousEvent = new GotoPreviousBlockEvent(detail);
        this.dispatchEvent(gotoPreviousEvent);
    }

    dispatchGotoNextBlock(detail: GotoEventDetail): void {
        const gotoNextBlockEvent = new GotoNextBlockEvent(detail);
        this.dispatchEvent(gotoNextBlockEvent);
    }

    dispatchTextChange(detail: TextChangeEventDetail): void {
        const textChangeEvent = new TextChangeEvent(detail);
        this.dispatchEvent(textChangeEvent)
    }

    handleKeyDown(e: KeyboardEvent) {
        const target = e.target! as HTMLTextAreaElement;

        switch (e.key) {
            case 'Tab':
                {
                    e.preventDefault();
                    const value = target.value;
                    if (e.shiftKey) {
                        const lbIndex = value.lastIndexOf('\n', target.selectionStart);
                        if (value.substring(lbIndex + 1, lbIndex + 1 + TABSIZE) == TABSTRING) {
                            target.value = value.substring(0, lbIndex + 1) + value.substring(lbIndex + 1 + TABSIZE)
                        }
                    } else {
                        const start = target.selectionStart;
                        const end = target.selectionEnd;
                        target.value = value.substring(0, start) + TABSTRING + value.substring(end);
                    }
                    break;
                }

            case 'Backspace':
                {
                    const removedLBCount = (target.value.substring(target.selectionStart - 1, target.selectionEnd).match(/\n/g) || []).length;
                    if (target.value[target.selectionEnd] === undefined) {
                        this.textareaRows -= removedLBCount;
                        this.textareaEl.setAttribute('rows', this.textareaRows.toString());
                    }

                    if (target.selectionEnd == 0) {
                        e.preventDefault();
                        this.dispatchGotoPreviousBlock({
                            shouldCreateNext: false,
                            shouldDeleteCurrent: target.value === '',
                        });
                    }
                    break
                }

            case 'Enter':
                {
                    const value = target.value;
                    const lbIndex = value.lastIndexOf('\n', target.selectionStart);
                    const trailingSpaceCount = (value.substring(lbIndex + 1).match(/^ */g) || [""])[0].length;
                    if (trailingSpaceCount > 0) {
                        e.preventDefault();
                        target.value += '\n' + ' '.repeat(trailingSpaceCount)
                    }

                    const lineBreakCount = (target.value.substring(0, target.selectionStart).match(/\n/g) || []).length + 1;
                    if (lineBreakCount >= this.textareaRows) {
                        this.textareaRows++;
                        this.textareaEl.setAttribute('rows', this.textareaRows.toString());
                    }

                    if (target.selectionStart === 0 && target.selectionEnd === 0 && target.value[target.selectionEnd] !== undefined) {
                        e.preventDefault();
                        this.dispatchGotoPreviousBlock({
                            shouldCreateNext: true,
                            shouldDeleteCurrent: false,
                        });
                    } else if (value[target.selectionEnd - 1] == '\n') {
                        e.preventDefault();
                        this.dispatchGotoNextBlock({
                            shouldCreateNext: true,
                            shouldDeleteCurrent: false,
                        });
                    }
                    break;
                }

            case 'ArrowDown':
                {
                    const lineBreakCount = (target.value.substring(0, target.selectionStart).match(/\n/g) || []).length + 1;
                    if (lineBreakCount >= this.textareaRows) {
                        e.preventDefault();
                        this.dispatchGotoNextBlock({
                            shouldCreateNext: false,
                            shouldDeleteCurrent: false,
                        });
                    }
                }
                break;

            case 'ArrowUp':
                {
                    if (target.selectionEnd == 0) {
                        e.preventDefault();
                        this.dispatchGotoPreviousBlock({
                            shouldCreateNext: false,
                            shouldDeleteCurrent: false,
                        });
                    }
                }
                break;

            default:
                this.text = target.value;
                this.dispatchTextChange({
                    content: target.value
                })
        }
    }
}

type MarkdownBlock = MarkdownEditBlock | MarkdownResultBlock

class MarkdownEditor extends HTMLElement {
    private markdownBlocks: MarkdownBlock[] = [];
    private activeBlock: number = -1;
    private updateTimeoutRef: ReturnType<typeof setTimeout> | null = null;

    constructor(
        public content: string = '',
    ) {
        super();
        this.attachShadow({ mode: 'open' });

        const styleEl = document.createElement('style');
        styleEl.textContent = `
        :host {
            display: block;
            width: 100%;
            padding: 1em;
            border-bottom: 2px solid black;
        }
        `;
        this.shadowRoot!.appendChild(styleEl);

        this.addEventListener('keydown', this.handleKeyPress.bind(this))
    }

    private addListenersToEditBlock(block: MarkdownEditBlock) {
        block.addEventListener('gotonextblock', this.handleGotoNextBlock.bind(this));
        block.addEventListener('gotopreviousblock', this.handleGotoPreviousBlock.bind(this));
        block.addEventListener('textchange', this.handleTextChange.bind(this));
    }

    private handleKeyPress(e: KeyboardEvent) {
        if (e.key === 's' && e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            this.saveMarkdownFile();
        }
    }

    private saveMarkdownFile() {
        const blob = new Blob([this.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(new Date()).toISOString()}.md`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    private addListenersToResultBlock(block: MarkdownResultBlock) {
        block.addEventListener('click', this.handleGotoBlock.bind(this));
    }

    private blockFromPlainText(plainText: string) {
        this.markdownBlocks = plainText.split('\n\n').map(v => {
            const block = new MarkdownResultBlock(v);
            this.addListenersToResultBlock(block);
            return block
        });

        this.shadowRoot!.append(...this.markdownBlocks);
    }

    async connectedCallback() {
        const q = window.location.search.substring(1).split('=')[1] || '';
        if (q !== '') {
            const plainText = await decompress(q);
            this.blockFromPlainText(plainText);
        } else {
            const firstEditBlock = document.createElement('markdown-edit-block') as MarkdownEditBlock;
            this.activeBlock = 0;
            this.addListenersToEditBlock(firstEditBlock);
            this.appendBlock(firstEditBlock);
        }
    }

    handleTextChange(e: TextChangeEvent) {
        this.content = this.markdownBlocks.map(b => b.text).join('\n\n');
        if (this.updateTimeoutRef) {
            clearTimeout(this.updateTimeoutRef);
        }

        this.updateTimeoutRef = setTimeout(async () => await compress(this.content).then(storeStateOnURL), 500);
    }

    handleGotoBlock(e: Event) {
        const childBlocks = Array.from(this.shadowRoot!.childNodes).filter(p => p.nodeName != 'STYLE')
        const target = e.target! as MarkdownBlock;

        const previousActiveBlock = this.activeBlock;
        this.activeBlock = Array.prototype.indexOf.call(childBlocks, target);
        if (target instanceof MarkdownResultBlock) {
            const replacement = target.edit();
            this.addListenersToEditBlock(replacement);
            target.replaceWith(replacement);
            replacement.focus();
            this.markdownBlocks[this.activeBlock] = replacement;
        } else {
            target.focus();
        }

        const previousBlock = this.markdownBlocks[previousActiveBlock];
        if (previousActiveBlock >= 0 && previousBlock instanceof MarkdownEditBlock) {
            const replacement = previousBlock.render();
            this.addListenersToResultBlock(replacement);
            previousBlock.replaceWith(replacement);
            this.markdownBlocks[previousActiveBlock] = replacement
        }
    }

    handleGotoPreviousBlock(e: GotoPreviousBlockEvent) {
        const previousActiveBlock = this.activeBlock; // keeps 0 on new active
        let unchanged = false;
        if (this.activeBlock === 0) {
            if (e.detail.shouldCreateNext) {
                const newActiveBlock = document.createElement('markdown-edit-block') as MarkdownEditBlock;
                this.addListenersToEditBlock(newActiveBlock);
                this.prependBlock(newActiveBlock);
                newActiveBlock.focus();
            } else {
                unchanged = true
            }
        } else {
            this.activeBlock--;
            const target = this.markdownBlocks[this.activeBlock]! as MarkdownResultBlock;
            const replacement = target.edit();
            this.addListenersToEditBlock(replacement);
            target.replaceWith(replacement);
            replacement.focus();
            this.markdownBlocks[this.activeBlock] = replacement;
        }

        if (!unchanged) {
            const current = this.markdownBlocks[previousActiveBlock]! as MarkdownEditBlock;
            if (e.detail.shouldDeleteCurrent) {
                current.remove();
                this.markdownBlocks.splice(previousActiveBlock, 1);
                
            } else {
                const replacement = current.render();
                this.addListenersToResultBlock(replacement);
                current.replaceWith(replacement);
                this.markdownBlocks[previousActiveBlock] = replacement;
            }
        }
    }

    handleGotoNextBlock(e: GotoNextBlockEvent) {
        const previousActiveBlock = this.activeBlock;
        let unchanged = false;
        if (this.activeBlock === this.markdownBlocks.length - 1) {
            if (e.detail.shouldCreateNext) {
                const newActiveBlock = new MarkdownEditBlock();
                this.appendBlock(newActiveBlock);
                this.addListenersToEditBlock(newActiveBlock);
                newActiveBlock.focus();
                this.activeBlock++;
            } else {
                unchanged = true
            }
        } else {
            this.activeBlock++;
            const target = this.markdownBlocks[this.activeBlock]! as MarkdownResultBlock;
            const replacement = target.edit();
            this.addListenersToEditBlock(replacement);
            target.replaceWith(replacement);
            replacement.focus();
            this.markdownBlocks[this.activeBlock] = replacement;
        }

        if (!unchanged) {
            const current = this.markdownBlocks[previousActiveBlock]! as MarkdownEditBlock;
            if (e.detail.shouldDeleteCurrent) {
                current.remove();
                this.markdownBlocks.splice(previousActiveBlock, 1);
            } else {
                const replacement = current.render()
                this.addListenersToResultBlock(replacement);
                current.replaceWith(replacement);
                this.markdownBlocks[previousActiveBlock] = replacement;
            }
        }
    }

    prependBlock(block: MarkdownBlock) {
        this.markdownBlocks = [
            block,
            ...this.markdownBlocks
        ]

        this.shadowRoot!.prepend(block);
    }

    appendBlock(block: MarkdownBlock) {
        this.markdownBlocks = [
            ...this.markdownBlocks,
            block
        ]

        this.shadowRoot!.append(block);
    }
}

customElements.define("markdown-edit-block", MarkdownEditBlock)
customElements.define("markdown-result-block", MarkdownResultBlock)
customElements.define("markdown-editor", MarkdownEditor)