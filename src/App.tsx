import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { markdown as mdLang } from '@codemirror/lang-markdown';
import MarkdownPreview from '@uiw/react-markdown-preview';
import rehypePrism from 'rehype-prism-plus';
import "./App.css";
import { Save, FolderOpen, Pin, PinOff, X, Bold, Italic, Heading1, Heading2, Heading3, Code, List, ListOrdered, Table, Image, Eraser, Settings, Columns, PanelLeft, PanelRight, Search, Minus, Square } from 'lucide-react';
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from '@tauri-apps/api/window';
import { search, openSearchPanel, closeSearchPanel } from '@codemirror/search';

type Theme = 'auto' | 'light' | 'dark';
type LayoutMode = 'editor' | 'split' | 'preview';

const imageCache = new Map<string, string>();

const PersistentImage = memo(({ src, alt, ...props }: any) => {
  const decodedPath = useMemo(() => {
    if (!src) return '';
    try {
      let d = decodeURIComponent(src);
      if (d.startsWith("file://")) {
        d = d.replace(/^file:\/\//, '');
        if (d.match(/^\/[a-zA-Z]:\//)) d = d.substring(1); // Windows fix removing initial slash
      }
      return d;
    } catch {
      return src;
    }
  }, [src]);

  const [data, setData] = useState<string | null>(imageCache.get(decodedPath) || null);
  
  useEffect(() => {
    if (!decodedPath || decodedPath.startsWith('http') || decodedPath.startsWith('data:') || decodedPath.startsWith('blob:')) return;
    if (imageCache.has(decodedPath)) return;
    let active = true;
    invoke<string>("read_image", { path: decodedPath }).then(b64 => {
      if (active) { imageCache.set(decodedPath, b64); setData(b64); }
    }).catch(e => console.error("Failed to load image:", decodedPath, e));
    return () => { active = false; };
  }, [decodedPath]);
  
  const finalSrc = data || src;
  return <img src={finalSrc} alt={alt} {...props} loading="eager" decoding="sync" style={{ maxWidth: '100%', borderRadius: '8px', backfaceVisibility: 'hidden', transform: 'translateZ(0)' }} />;
});

const TablePicker = memo(({ onSelect }: { onSelect: (r: number, c: number) => void }) => {
  const [hovered, setHovered] = useState({ r: 0, c: 0 });
  return (
    <div className="table-picker-popup" onMouseLeave={() => setHovered({ r: 0, c: 0 })}>
      <div className="table-picker-title">{hovered.r > 0 ? `${hovered.c} x ${hovered.r}` : "Insert Table"}</div>
      <div className="table-picker-grid">
        {Array.from({ length: 8 }).map((_, r) => (
          <div key={r} className="table-picker-row">
            {Array.from({ length: 10 }).map((_, c) => (
              <div 
                key={c} 
                className={`table-picker-cell ${r < hovered.r && c < hovered.c ? 'active' : ''}`}
                onMouseEnter={() => setHovered({ r: r + 1, c: c + 1 })}
                onClick={(e) => { e.stopPropagation(); onSelect(hovered.r, hovered.c); }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

const DoubleBufferedPreview = memo(({ source, theme, plugins, components }: any) => {
  const [bufferState, setBufferState] = useState({
    active: 'a',
    contentA: source,
    contentB: source,
    pendingSwap: false
  });

  const scrollRefA = useRef<HTMLDivElement>(null);
  const scrollRefB = useRef<HTMLDivElement>(null);
  const scrollPos = useRef(0);
  const isSyncing = useRef(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncing.current) return;
    scrollPos.current = e.currentTarget.scrollTop;
  };

  useEffect(() => {
    setBufferState(prev => {
      if (prev.active === 'a' && prev.contentA === source) return prev;
      if (prev.active === 'b' && prev.contentB === source) return prev;
      
      const targetLayer = prev.active === 'a' ? 'b' : 'a';
      return {
        ...prev,
        contentA: targetLayer === 'a' ? source : prev.contentA,
        contentB: targetLayer === 'b' ? source : prev.contentB,
        pendingSwap: true
      };
    });
  }, [source]);

  useEffect(() => {
    if (!bufferState.pendingSwap) return;
    
    // Allow React to flush the DOM for the hidden layer, then sync scroll and swap
    const timer = setTimeout(() => {
      setBufferState(prev => {
        if (!prev.pendingSwap) return prev;
        const nextActive = prev.active === 'a' ? 'b' : 'a';
        
        isSyncing.current = true;
        if (nextActive === 'a' && scrollRefA.current) scrollRefA.current.scrollTop = scrollPos.current;
        if (nextActive === 'b' && scrollRefB.current) scrollRefB.current.scrollTop = scrollPos.current;
        
        setTimeout(() => isSyncing.current = false, 50);

        return { ...prev, active: nextActive, pendingSwap: false };
      });
    }, 60);

    return () => clearTimeout(timer);
  }, [bufferState.pendingSwap, bufferState.contentA, bufferState.contentB]);

  const commonStyle: React.CSSProperties = { position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden', backgroundColor: 'var(--bg-color)', transition: 'opacity 0.1s ease-in-out' };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div 
        ref={scrollRefA}
        onScroll={bufferState.active === 'a' ? handleScroll : undefined}
        style={{ ...commonStyle, opacity: bufferState.active === 'a' ? 1 : 0, zIndex: bufferState.active === 'a' ? 2 : 1, pointerEvents: bufferState.active === 'a' ? 'auto' : 'none' }}>
        <div style={{ maxWidth: '850px', margin: '0 auto', padding: '40px 60px' }}>
          <MarkdownPreview source={bufferState.contentA} rehypePlugins={plugins} components={components} wrapperElement={{"data-color-mode": theme === 'auto' ? undefined : theme}} style={{ backgroundColor: 'transparent', padding: 0 }} />
        </div>
      </div>
      <div 
        ref={scrollRefB}
        onScroll={bufferState.active === 'b' ? handleScroll : undefined}
        style={{ ...commonStyle, opacity: bufferState.active === 'b' ? 1 : 0, zIndex: bufferState.active === 'b' ? 2 : 1, pointerEvents: bufferState.active === 'b' ? 'auto' : 'none' }}>
        <div style={{ maxWidth: '850px', margin: '0 auto', padding: '40px 60px' }}>
          <MarkdownPreview source={bufferState.contentB} rehypePlugins={plugins} components={components} wrapperElement={{"data-color-mode": theme === 'auto' ? undefined : theme}} style={{ backgroundColor: 'transparent', padding: 0 }} />
        </div>
      </div>
    </div>
  );
});

function App() {
  const [markdown, setMarkdown] = useState("# Welcome to MarkdownPro\n\nExperience zero-flicker flow.");
  const [theme, setTheme] = useState<Theme>('auto');
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [deferredMarkdown, setDeferredMarkdown] = useState(markdown);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('split');
  const [fontSize, setFontSize] = useState(14);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontFamily, setFontFamily] = useState("'Fira Code', 'Consolas', monospace");
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [splitPercent, setSplitPercent] = useState(50);
  const editorRef = useRef<EditorView | null>(null);
  const isResizing = useRef(false);
  
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const tablePickerHideUntilLeave = useRef(false);

  const mdComponents = useMemo(() => ({ img: PersistentImage }), []);
  const previewPlugins = useMemo(() => [[rehypePrism, { showLineNumbers: true }]], []);

  useEffect(() => {
    const timer = setTimeout(() => setDeferredMarkdown(markdown), 200);
    return () => clearTimeout(timer);
  }, [markdown]);

  const handleSave = useCallback(async () => {
    try {
      const savedPath = await invoke<string>("save_file", { content: markdown, path: currentFilePath });
      if (savedPath) {
        setCurrentFilePath(savedPath);
        setToastMessage("文件已保存");
      }
    } catch (e) {
      console.error("Save failed:", e);
      setToastMessage("保存失败");
    }
  }, [markdown, currentFilePath]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleSave]);

  useEffect(() => {
    document.body.classList.remove('light-theme', 'dark-theme');
    if (theme !== 'auto') document.body.classList.add(`${theme}-theme`);
  }, [theme]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      e.preventDefault();
      const newPercent = (e.clientX / window.innerWidth) * 100;
      if (newPercent > 10 && newPercent < 90) setSplitPercent(newPercent);
    };
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Restored helper with full state update guarantee
  const insertText = useCallback((before: string, after: string = '') => {
    if (editorRef.current) {
      const { state, dispatch } = editorRef.current;
      const main = state.selection.main;
      const selected = state.sliceDoc(main.from, main.to);
      const insert = before + selected + after;
      dispatch({
        changes: { from: main.from, to: main.to, insert },
        selection: { anchor: main.from + before.length + selected.length + after.length }
      });
    }
  }, []);

  const handlePaste = useCallback((event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const blob = items[i].getAsFile();
        if (!blob) continue;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
          const b64 = e.target?.result as string;
          try {
            const savedPath = await invoke<string>("save_image", { base64Data: b64 });
            const rawPath = savedPath.replace(/\\/g, '/');
            const fileUrl = "file:///" + rawPath.replace(/^\//, '');
            imageCache.set(rawPath, b64);
            insertText(`\n![Image](${fileUrl})\n`);
          } catch (err) {
            console.error("Paste save failed:", err);
            const blobUrl = URL.createObjectURL(blob);
            insertText(`\n![Image](${blobUrl})\n`);
          }
        };
        reader.readAsDataURL(blob);
        event.preventDefault();
        break;
      }
    }
  }, [insertText]);

  return (
    <div className="app-container" data-color-mode={theme === 'auto' ? undefined : theme} style={{ '--editor-font-size': `${fontSize}px`, '--editor-font-family': fontFamily } as any}>
      <div className="titlebar" onPointerDown={(e) => { 
        if (!(e.target as HTMLElement).closest('button')) invoke("drag_window"); 
      }}>
        <div className="titlebar-controls">
          <button className="icon-btn" onClick={() => setSettingsOpen(!settingsOpen)} title="Settings"><Settings size={16} /></button>
          <div className="titlebar-sep"></div>
          <button className="icon-btn" onClick={() => invoke<{path: string | null, content: string}>("open_file").then(res => {
            if (res.content) { setMarkdown(res.content); if(res.path) setCurrentFilePath(res.path); }
          })}><FolderOpen size={16} /></button>
          <button className="icon-btn" onClick={handleSave} title="Save"><Save size={16} /></button>
          <div className="titlebar-sep"></div>
          <button className="icon-btn" onClick={async () => { const n = !alwaysOnTop; await invoke("toggle_always_on_top", { alwaysOnTop: n }); setAlwaysOnTop(n); }}>
            {alwaysOnTop ? <Pin size={16} color="#4a90e2" /> : <PinOff size={16} />}
          </button>
        </div>
        <div className="titlebar-title">FlowMark</div>
        <div className="titlebar-controls" style={{ paddingRight: '4px', WebkitAppRegion: 'no-drag' } as any}>
          <button className="icon-btn" onClick={() => getCurrentWindow().minimize()}><Minus size={16} /></button>
          <button className="icon-btn" onClick={async () => { await getCurrentWindow().toggleMaximize(); }}><Square size={14} /></button>
          <button className="icon-btn close-btn" onClick={async () => { await getCurrentWindow().close(); }}><X size={16} /></button>
        </div>
      </div>
      
      {settingsOpen && (
        <div className="overlay-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="popup-panel" onClick={e => e.stopPropagation()}>
            <div className="popup-header"><h3>Settings</h3><button className="icon-btn" onClick={() => setSettingsOpen(false)}><X size={16} /></button></div>
            <div className="popup-body">
              <div className="setting-item">
                <label>Font Size</label>
                <input type="range" min="12" max="24" value={fontSize} onChange={e => setFontSize(parseInt(e.target.value))} />
                <span>{fontSize}px</span>
              </div>
              <div className="setting-item">
                <label>Show Line Numbers</label>
                <input type="checkbox" checked={showLineNumbers} onChange={e => setShowLineNumbers(e.target.checked)} />
              </div>
              <div className="setting-item">
                <label>Theme</label>
                <select value={theme} onChange={e => setTheme(e.target.value as Theme)}>
                  <option value="auto">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div className="setting-item">
                <label>Editor Font</label>
                <select value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
                  <option value="'Fira Code', 'Consolas', monospace">Monospace</option>
                  <option value="-apple-system, system-ui, sans-serif">Sans Serif</option>
                  <option value="Georgia, serif">Serif</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="editor-container">
        <div className="global-toolbar">
          <div className="toolbar-group">
            <button className="tb-btn" onClick={() => insertText("\n# ")} title="H1"><Heading1 size={14} /></button>
            <button className="tb-btn" onClick={() => insertText("\n## ")} title="H2"><Heading2 size={14} /></button>
            <button className="tb-btn" onClick={() => insertText("\n### ")} title="H3"><Heading3 size={14} /></button>
            <button className="tb-btn" onClick={() => insertText("**", "**")} title="Bold"><Bold size={14} /></button>
            <button className="tb-btn" onClick={() => insertText("_", "_")} title="Italic"><Italic size={14} /></button>
            <button className="tb-btn" onClick={() => insertText("\n```\n", "\n```")} title="Code Block"><Code size={14} /></button>
            <button className="tb-btn" onClick={() => insertText("\n- ")} title="List"><List size={14} /></button>
            <button className="tb-btn" onClick={() => insertText("\n1. ")} title="Ordered List"><ListOrdered size={14} /></button>
            <div 
              style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '100%' }}
              onMouseEnter={() => { if (!tablePickerHideUntilLeave.current) setTablePickerOpen(true); }}
              onMouseLeave={() => { setTablePickerOpen(false); tablePickerHideUntilLeave.current = false; }}
            >
              <button className={`tb-btn ${tablePickerOpen ? 'active' : ''}`} title="Table"><Table size={14} /></button>
              {tablePickerOpen && (
                <TablePicker onSelect={(r, c) => {
                  if(r === 0 || c === 0) return;
                  let md = '\n|';
                  for (let i = 0; i < c; i++) md += ' Header |';
                  md += '\n|';
                  for (let i = 0; i < c; i++) md += '--------|';
                  md += '\n';
                  for (let j = 0; j < Math.max(0, r - 1); j++) {
                    md += '|';
                    for (let i = 0; i < c; i++) md += '        |';
                    md += '\n';
                  }
                  insertText(md);
                  setTablePickerOpen(false);
                  tablePickerHideUntilLeave.current = true;
                }} />
              )}
            </div>
            <button className="tb-btn" onClick={() => insertText("![]()")} title="Image Link"><Image size={14} /></button>
            <button className="tb-btn" onClick={() => setMarkdown("")}><Eraser size={14} /></button>
            <button className={`tb-btn ${searchOpen ? 'active' : ''}`} onClick={() => {
              const nextState = !searchOpen;
              setSearchOpen(nextState);
              if (editorRef.current) {
                if (nextState) openSearchPanel(editorRef.current);
                else closeSearchPanel(editorRef.current);
                editorRef.current.focus();
              }
            }}><Search size={14} /></button>
          </div>
          <div style={{flex: 1}}></div>
          <div className="toolbar-group">
            <button className={`tb-btn ${layoutMode === 'editor' ? 'active' : ''}`} onClick={() => setLayoutMode('editor')}><PanelLeft size={14} /></button>
            <button className={`tb-btn ${layoutMode === 'split' ? 'active' : ''}`} onClick={() => setLayoutMode('split')}><Columns size={14} /></button>
            <button className={`tb-btn ${layoutMode === 'preview' ? 'active' : ''}`} onClick={() => setLayoutMode('preview')}><PanelRight size={14} /></button>
          </div>
        </div>

        <div className="editor-wrapper-inner">
          <div className="cm-editor-section" style={{ width: layoutMode === 'split' ? `${splitPercent}%` : (layoutMode === 'editor' ? '100%' : '0%'), display: layoutMode === 'preview' ? 'none' : 'flex' }}>
            <div className="cm-actual-editor">
              <CodeMirror value={markdown} height="100%" theme={theme === 'dark' ? 'dark' : 'light'} extensions={[ mdLang(), search({ top: false }), EditorView.domEventHandlers({ paste: handlePaste }) ]} onChange={(value) => setMarkdown(value)} onCreateEditor={(view) => { editorRef.current = view; }} basicSetup={{ lineNumbers: showLineNumbers, foldGutter: true }} />
            </div>
          </div>
          {layoutMode === 'split' && ( <div className="resizer-bar" onMouseDown={() => { isResizing.current = true; document.body.style.cursor = 'col-resize'; }}></div> )}
          <div className="preview-section" style={{ width: layoutMode === 'split' ? `${100 - splitPercent}%` : (layoutMode === 'preview' ? '100%' : '0%'), display: layoutMode === 'editor' ? 'none' : 'flex', overflow: 'hidden', position: 'relative', cursor: 'default' }}>
            <DoubleBufferedPreview source={deferredMarkdown} theme={theme} plugins={previewPlugins} components={mdComponents} />
          </div>
        </div>
      </div>
      
      {toastMessage && (
        <div className="toast-notification">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
export default App;
