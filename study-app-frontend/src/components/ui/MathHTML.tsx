import { useMemo, useState } from 'react';
import { WebView } from 'react-native-webview';
import { useTheme, useThemeMode } from '@/lib/theme';

// Renders markdown that the native renderer (react-native-markdown-display in
// MD.tsx) cannot: LaTeX/chemistry math AND Mermaid diagrams. Pipeline inside a
// WebView: markdown-it + markdown-it-texmath + KaTeX + mhchem for math, and
// Mermaid for ```mermaid``` fenced blocks (flowcharts, trees, graphs, etc.).
// Mermaid is only loaded when a diagram is actually present, so math-only
// content stays lightweight.
//
// Versions below are the exact ones verified rendering in the Android WebView.
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist';
const MDIT = 'https://cdn.jsdelivr.net/npm/markdown-it@14/dist/markdown-it.min.js';
const TEXMATH = 'https://cdn.jsdelivr.net/npm/markdown-it-texmath@1.0.0/texmath.min.js';
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';

const MERMAID_RE = /```mermaid/;

function buildHtml(md: string, C: ReturnType<typeof useTheme>, fontPx: number, isDark: boolean): string {
  const src = JSON.stringify(md);
  const wantsMermaid = MERMAID_RE.test(md);
  const mermaidScript = wantsMermaid ? `<script src="${MERMAID}"></script>` : '';
  // Mermaid setup + run, only emitted when a diagram is present. Converts the
  // markdown-rendered ```mermaid code blocks into mermaid divs, renders them,
  // then re-measures height (mermaid renders async).
  const mermaidRun = wantsMermaid ? `
      try {
        window.mermaid.initialize({ startOnLoad:false, securityLevel:'loose',
          theme:'${isDark ? 'dark' : 'neutral'}',
          themeVariables:{ fontFamily:"-apple-system,Roboto,sans-serif",
                           fontSize:"20px", background:'transparent' } });
        document.querySelectorAll('#c code.language-mermaid').forEach(function(b){
          var d = document.createElement('div');
          d.className = 'mermaid';
          d.textContent = b.textContent;
          (b.closest('pre') || b).replaceWith(d);
        });
        window.mermaid.run({ querySelector:'.mermaid', suppressErrors:true })
          .then(post).catch(post);
      } catch(e) { post(); }
  ` : '';
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="${KATEX}/katex.min.css">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Kalam:wght@700&display=swap');
  html,body{margin:0;padding:0;background:transparent;-webkit-text-size-adjust:100%;}
  #c{color:${C.ink};font-size:${fontPx}px;line-height:24px;
     font-family:-apple-system,Roboto,'Segoe UI',sans-serif;
     word-wrap:break-word;overflow-wrap:break-word;}
  #c p{margin:0 0 12px;}
  #c h1,#c h2,#c h3,#c h4{font-family:'Kalam',cursive;color:${C.ink};
     letter-spacing:.3px;font-weight:700;margin:16px 0 6px;}
  #c h1{font-size:26px;line-height:38px;} #c h2{font-size:22px;line-height:32px;}
  #c h3{font-size:19px;line-height:28px;} #c h4{font-size:17px;line-height:26px;}
  #c strong{font-weight:800;color:${C.ink};} #c em{font-style:italic;}
  #c ul,#c ol{margin:0 0 10px;padding-left:22px;} #c li{margin:3px 0;}
  #c li::marker{color:${C.accent};}
  #c code{background:${C.card2};padding:1px 5px;border-radius:4px;font-size:13.5px;
     font-family:monospace;}
  #c pre{background:${C.card2};padding:10px;border-radius:8px;overflow-x:auto;}
  #c pre code{background:transparent;padding:0;}
  #c blockquote{background:${C.card2};border-left:3px solid ${C.accent};
     padding:6px 12px;margin:8px 0;}
  #c a{color:${C.accent};text-decoration:underline;}
  #c hr{border:none;border-top:1px solid ${C.line};margin:14px 0;}
  #c table{border-collapse:collapse;border:1px solid ${C.line};margin:10px 0;width:100%;}
  #c th{background:${C.card2};padding:7px;font-weight:700;text-align:left;}
  #c td{padding:7px;border-top:1px solid ${C.line};}
  #c .katex{font-size:1.05em;}
  #c .katex-display{margin:10px 0;overflow-x:auto;overflow-y:hidden;}
  #c .mermaid{margin:12px 0;overflow-x:auto;-webkit-overflow-scrolling:touch;}
  /* Render diagrams at their natural (readable) size; if a diagram is wider
     than the screen it scrolls horizontally instead of shrinking to a blur. */
  #c .mermaid svg{max-width:none;height:auto;display:block;margin:0 auto;}
</style></head>
<body><div id="c"></div>
<script src="${MDIT}"></script>
<script src="${KATEX}/katex.min.js"></script>
<script src="${KATEX}/contrib/mhchem.min.js"></script>
<script src="${TEXMATH}"></script>
${mermaidScript}
<script>
  var SRC = ${src};
  function post(){
    var c = document.getElementById('c');
    var h = Math.max(c.scrollHeight, c.offsetHeight,
                     document.body.scrollHeight, document.documentElement.scrollHeight);
    // small buffer so the last line is never clipped by scrollHeight rounding
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(String(h + 8));
  }
  function render(){
    try {
      var md = window.markdownit({html:false, linkify:true, breaks:false})
        .use(window.texmath, { engine: window.katex, delimiters:'dollars',
                               katexOptions:{ throwOnError:false } });
      document.getElementById('c').innerHTML = md.render(SRC);
    } catch(e) {
      document.getElementById('c').textContent = SRC;
    }
    post();
    // Re-measure on any later layout shift (fonts, KaTeX, mermaid, images) so
    // the reported height always matches the final content.
    try { if (window.ResizeObserver) new ResizeObserver(post).observe(document.getElementById('c')); } catch(e) {}
    ${mermaidRun}
  }
  if (document.readyState === 'complete') render();
  else window.addEventListener('load', render);
  // re-measure after fonts / KaTeX / mermaid settle (heights shift as they load)
  setTimeout(post, 250); setTimeout(post, 700); setTimeout(post, 1500);
</script></body></html>`;
}

export function MathHTML({
  children,
  fontPx = 15,
  interactive = true,
}: {
  children: string;
  fontPx?: number;
  // When false, the WebView ignores touches so a parent Pressable (e.g. an
  // MCQ option row) still receives the tap. Math there isn't scrollable, which
  // is fine for short option text.
  interactive?: boolean;
}) {
  const C = useTheme();
  const { resolved } = useThemeMode();
  const [height, setHeight] = useState(40);
  const html = useMemo(
    () => buildHtml(children, C, fontPx, resolved === 'dark'),
    [children, C, fontPx, resolved],
  );
  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={{ width: '100%', height, backgroundColor: 'transparent' }}
      // transparent so the app's paper/card background shows through
      // (Android can flash white otherwise without this)
      androidLayerType="hardware"
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      setSupportMultipleWindows={false}
      pointerEvents={interactive ? 'auto' : 'none'}
      onMessage={(e) => {
        const h = Number(e.nativeEvent.data);
        if (h && Math.abs(h - height) > 1) setHeight(h);
      }}
    />
  );
}
