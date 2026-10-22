/**
 * 注解锚定：在渲染后的正文（.md-content 区块）里找到注解锚文本，
 * 分段包上荧光高亮 span（.anno-mark，点击由调用方委托打开注解阅读弹窗）。
 * 跨元素文本分段包裹；按 anchorIndex 定位第 N 次出现，找不到退回第 1 次；
 * 定位失败不画线——由调用方在正文末尾渲染兜底条目。
 *
 * 注意：正文由 react-markdown 内联组件渲染，父组件任何状态变化都会整体重建
 * 正文 DOM 冲掉划线，因此调用方必须在每次渲染后调用本函数重画。
 */
export function applyAnnoMarks(container: HTMLElement | null, annotations: any[]) {
  if (!container) return;
  const items = annotations.filter((a: any) => a.anchorText && a.anchorText.length >= 2);
  const doc = container.ownerDocument!;
  container.querySelectorAll<HTMLElement>('.md-content').forEach(block => {
    // 先清掉旧包裹（注解列表变化时正文 DOM 未重建，需要重画）
    block.querySelectorAll('span.anno-mark').forEach(sp => {
      const parent = sp.parentNode;
      if (!parent) return;
      while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
      parent.removeChild(sp);
      parent.normalize();
    });
    if (!items.length) return;
    for (const a of items) {
      const textNodes: Text[] = [];
      const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: (n: any) => {
          const p = n.parentElement;
          if (!p || p.closest('.anno-mark')) return NodeFilter.FILTER_REJECT;
          const tag = p.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE') return NodeFilter.FILTER_REJECT;
          return (n.nodeValue || '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      let tn: Node | null;
      while ((tn = walker.nextNode())) textNodes.push(tn as Text);
      if (!textNodes.length) continue;
      // 拼全文并记录每个文本节点的起始偏移，支持锚文本跨元素分段匹配
      let full = '';
      const offs: number[] = [];
      for (const t of textNodes) { offs.push(full.length); full += t.nodeValue || ''; }
      const needle: string = a.anchorText;
      const want = Math.max(0, (a.anchorIndex || 1) - 1);
      let pos = -1;
      if (want === 0) pos = full.indexOf(needle);
      else {
        let count = 0, from = 0;
        for (;;) {
          const i = full.indexOf(needle, from);
          if (i < 0) break;
          if (count === want) { pos = i; break; }
          count++; from = i + needle.length;
        }
        if (pos < 0) pos = full.indexOf(needle); // 第 N 次出现找不到时退回第 1 次
      }
      if (pos < 0) continue; // 定位失败：不画线，保留在正文末尾兜底条目中
      const end = pos + needle.length;
      for (let k = 0; k < textNodes.length; k++) {
        const t = textNodes[k];
        const nodeStart = offs[k];
        const nodeLen = (t.nodeValue || '').length;
        if (nodeStart + nodeLen <= pos || nodeStart >= end) continue;
        const s = Math.max(0, pos - nodeStart);
        const e = Math.min(nodeLen, end - nodeStart);
        if (e < t.length) t.splitText(e);
        const mid = s > 0 ? t.splitText(s) : t;
        const span = doc.createElement('span');
        span.className = 'anno-mark'
          + (a.status !== 'approved' ? ' pending' : '')
          + (a.type === 'interview' ? ' interview' : '');
        span.dataset.annoId = String(a.id);
        mid.parentNode?.insertBefore(span, mid);
        span.appendChild(mid);
      }
    }
  });
}

/** 点击荧光高亮的委托处理：找到对应注解则回调（容器 onClick 里调用） */
export function findAnnoByClickTarget(target: HTMLElement, annotations: any[]): any | null {
  const mark = target.closest('.anno-mark');
  if (!mark) return null;
  const id = Number(mark.getAttribute('data-anno-id'));
  return annotations.find((a: any) => a.id === id) || null;
}
