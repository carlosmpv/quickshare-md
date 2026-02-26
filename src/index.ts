import './index.css';
import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const TABSIZE = 2;
const TABSTRING = ' '.repeat(TABSIZE);
const LINELENGTH = 80;
const TAB_LINEBREAK_DELAY = 3; // magic value for text area rows work properly
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
            width: 80ch;
            word-break: break-all;
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
            font: inherit;
            background-color: white;
            border-left: #1a5fb4 4px solid;
            padding-left: 1em;
            margin-left: calc(-1em - 4px);
            width: ${LINELENGTH}ch;
            word-break: break-all;
            white-space: pre-wrap;
            box-sizing: border-box;
        }
        `;
        this.shadowRoot!.appendChild(styleEl);
        this.textareaEl = document.createElement('textarea');
        this.textareaEl.value = text;
    }

    connectedCallback() {
        this.textareaEl.setAttribute('rows', this.textareaRows.toString());
        this.textareaEl.setAttribute('cols', LINELENGTH.toString());
        this.textareaEl.addEventListener('keydown', this.handleKeyDown.bind(this));
        this.shadowRoot!.appendChild(this.textareaEl)
        this.updateTextAreaRows();
    }

    render(): MarkdownResultBlock {
        return new MarkdownResultBlock(this.textareaEl.value);
    }

    override focus(options?: FocusOptions): void {
        console.log("focused")
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
        var lineBreakChage: number = 0

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
                    this.updateTextAreaRows()
                    break;
                }

            case 'Backspace':
                {
                    if (target.selectionEnd == 0) {
                        e.preventDefault();
                        this.dispatchGotoPreviousBlock({
                            shouldCreateNext: false,
                            shouldDeleteCurrent: target.value === '',
                        });
                    }

                    this.updateTextAreaRows()
                    break
                }

            case 'Enter':
                {
                    const value = target.value;
                    const lbIndex = value.lastIndexOf('\n', target.selectionStart);
                    const trailingSpaceCount = (value.substring(lbIndex + 1).match(/^ */g) || [""])[0].length;
                    if (trailingSpaceCount > 0) { // Keeps indentation
                        e.preventDefault();
                        target.value += '\n' + ' '.repeat(trailingSpaceCount)
                    }
                    if (target.selectionStart === 0 && target.selectionEnd === 0 && target.value[target.selectionEnd] !== undefined) {
                        e.preventDefault();
                        this.dispatchGotoPreviousBlock({
                            shouldCreateNext: true,
                            shouldDeleteCurrent: false,
                        });
                    } else if (target.selectionEnd == value.length && value[target.selectionEnd - 1] == '\n') {
                        e.preventDefault();
                        this.dispatchGotoNextBlock({
                            shouldCreateNext: true,
                            shouldDeleteCurrent: false,
                        });
                    }
                    this.updateTextAreaRows()
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
                this.updateTextAreaRows()
                this.text = target.value;
                this.dispatchTextChange({
                    content: target.value
                })
        }
    }

    updateTextAreaRows() {
        const lineBreakCount = (this.textareaEl.value.match(/\n/g) || []).length + 1;
        const lineOverflowCount = this.textareaEl.value.split("\n").map(line => (line.length / (LINELENGTH - TAB_LINEBREAK_DELAY)) >> 0).reduce((a, b) => a + b);
        this.textareaRows = lineBreakCount + lineOverflowCount;
        this.textareaEl.setAttribute('rows', this.textareaRows.toString());
    }
}

type MarkdownBlock = MarkdownEditBlock | MarkdownResultBlock

class MarkdownEditor extends HTMLElement {
    private updateTimeoutRef: ReturnType<typeof setTimeout> | null = null;
    private blocksParent: HTMLDivElement;
    private _activeBlock: MarkdownBlock | null = null;

    private get activeBlock(): MarkdownBlock | null {
        return this._activeBlock;
    }

    private set activeBlock(block: MarkdownBlock) {
        if (this._activeBlock instanceof MarkdownEditBlock) {
            const replacement = this._activeBlock.render()
            this.addListenersToResultBlock(replacement)
            this._activeBlock.replaceWith(replacement)
        }

        if (block instanceof MarkdownResultBlock) {
            const replacement = block.edit()
            this.addListenersToEditBlock(replacement)
            block.replaceWith(replacement)
            this._activeBlock = replacement;
            this._activeBlock.focus(); // always focus when set
        } else {
            this._activeBlock = block;
            this._activeBlock.focus(); // always focus when set
        }
    }

    constructor(
        public content: string = '',
    ) {
        super();
        this.attachShadow({ mode: 'open' });

        const styleEl = document.createElement('style');
        styleEl.textContent = `
        div {
            display: block;
            width: 100%;
        }
        `;
        this.shadowRoot!.appendChild(styleEl);

        this.blocksParent = document.createElement('div')
        this.shadowRoot!.appendChild(this.blocksParent);
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

    private createEditBlock(
        textareaRows: number = 1,
        text: string = '',
    ): MarkdownEditBlock {
        const editBlock = new MarkdownEditBlock(textareaRows, text);
        this.addListenersToEditBlock(editBlock);
        return editBlock;
    }

    private createResultBlock(
        text: string = '',
    ): MarkdownResultBlock {
        const resultBlock = new MarkdownResultBlock(text);
        this.addListenersToResultBlock(resultBlock);
        return resultBlock;
    }


    private addListenersToResultBlock(block: MarkdownResultBlock) {
        block.addEventListener('click', this.handleGotoBlock.bind(this));
    }

    private blockFromPlainText(plainText: string) {
        const blocks = plainText
            .split('\n\n')
            .map(v => this.createResultBlock(v));

        this.blocksParent.append(...blocks);
    }

    async connectedCallback() {
        const q = window.location.search.substring(1).split('=')[1] || '';
        if (q !== '') {
            const plainText = await decompress(q);
            this.blockFromPlainText(plainText);
        } else {
            const firstEditBlock = this.createEditBlock()
            this.blocksParent.appendChild(firstEditBlock);
            this.activeBlock = firstEditBlock;
        }
    }

    handleTextChange(e: TextChangeEvent) {
        this.content = (Array.from(this.blocksParent.children) as MarkdownBlock[]).map((b) => b.text).join('\n\n');

        if (this.updateTimeoutRef) {
            clearTimeout(this.updateTimeoutRef);
        }

        this.updateTimeoutRef = setTimeout(async () => await compress(this.content).then(storeStateOnURL), 500);
    }


    handleGotoBlock(e: Event) {
        const target = e.target! as MarkdownBlock;
        this.activeBlock = target;
    }

    handleGotoPreviousBlock(e: GotoPreviousBlockEvent) {
        if (e.detail.shouldCreateNext)
            this.activeBlock!.before(this.createEditBlock())

        if (this.activeBlock!.previousSibling === null)
            return;

        this.activeBlock = this.activeBlock!.previousSibling! as MarkdownBlock;
    }

    handleGotoNextBlock(e: GotoNextBlockEvent) {
        if (e.detail.shouldCreateNext)
            this.activeBlock!.after(this.createEditBlock()) // else unchanged? 

        if (this.activeBlock!.nextSibling === null)
            return;

        this.activeBlock = this.activeBlock!.nextSibling! as MarkdownBlock;
    }
}

customElements.define("markdown-edit-block", MarkdownEditBlock)
customElements.define("markdown-result-block", MarkdownResultBlock)
customElements.define("markdown-editor", MarkdownEditor)