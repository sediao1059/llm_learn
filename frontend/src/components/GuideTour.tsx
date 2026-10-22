import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Tour } from 'antd';
import type { TourProps } from 'antd';
import { useTour } from '../store/tour';

/** 引导步骤定义：target 为元素 id（锚点步）；无 target = 居中展示 */
type Placement = NonNullable<TourProps['steps']>[number]['placement'];
type StepDef = {
  title: string;
  description: React.ReactNode;
  target?: string;
  placement?: Placement;
  /** 该步要求的路由；当前不在时先导航过去 */
  route?: string;
  onEnter?: () => void;
  onLeave?: () => void;
};

/** 取锚点元素；缺失时退回 body（整屏遮罩 + 居中卡片，引导不至于报错中断） */
function byId(id: string): HTMLElement {
  return document.getElementById(id) ?? document.body;
}
function bySel(sel: string): HTMLElement {
  return document.querySelector(sel) ?? document.body;
}

export default function GuideTour({
  openAssistant, openNode,
}: {
  /** 登录后引导第 4 步：自动开/关全局 AI 助手抽屉做示意（不调模型） */
  openAssistant: (open: boolean) => void;
  /** 登录后引导第 5 步：打开/关闭全局笔记浮窗做划词注解演示 */
  openNode: (nodeId: string | null) => void;
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const { type, step, setStep, close } = useTour();
  const [shown, setShown] = useState(false);
  const [demoNodeId, setDemoNodeId] = useState('');
  const demoTimer = useRef<number | undefined>(undefined);

  /** 登录后引导需要一篇示例笔记：取公开「最近更新」接口的第一篇 */
  useEffect(() => {
    if (type !== 'user' || demoNodeId) return;
    fetch('/api/knowledge/recent')
      .then((r) => r.json())
      .then((d) => { if (d?.items?.[0]?.id) setDemoNodeId(d.items[0].id); })
      .catch(() => {});
  }, [type, demoNodeId]);

  /** 划词演示：打开示例笔记，稍等正文渲染后合成一段选区并派发 mouseup，
   *  让真实的「💡 解答」浮钮浮出来（纯界面示意，不发送任何 AI 请求；失败则静默，仅文案引导） */
  const enterAnnoDemo = () => {
    if (!demoNodeId) return;
    openNode(demoNodeId);
    demoTimer.current = window.setTimeout(() => {
      try {
        const content = document.querySelector('.note-content') as HTMLElement | null;
        if (!content) return;
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        let node: Node | null = null;
        while ((node = walker.nextNode())) {
          if ((node.textContent || '').trim().length >= 10) break;
        }
        if (!node) return;
        const text = node.textContent || '';
        const start = text.search(/\S/);
        if (start < 0) return;
        const len = Math.min(24, text.trim().length);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + len);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        // React 的 onMouseUp 挂在容器上，需从容器冒泡才能触发
        content.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      } catch { /* 演示失败不影响引导继续 */ }
    }, 700);
  };
  const leaveAnnoDemo = () => {
    window.clearTimeout(demoTimer.current);
    try { window.getSelection()?.removeAllRanges(); } catch { /* 忽略 */ }
    openNode(null);
  };

  const steps: StepDef[] = useMemo(() => {
    if (type === 'guest') {
      return [
        {
          route: '/',
          title: '👋 欢迎来到大模型学习站',
          description: '这里把全部学习笔记做成了一张可交互的「知识图谱」——30 秒带你上手，马上开始。',
        },
        {
          route: '/',
          target: 'graph-canvas',
          title: '这就是知识图谱',
          description: '每个圆点是一篇知识笔记，连线表示它们有关联。用鼠标点一下任意节点，右侧就会弹出这篇笔记，马上可以读。',
        },
        {
          route: '/',
          target: 'graph-filter-btn',
          placement: 'bottom',
          title: '按需筛选',
          description: '点「筛选」可以按关键词、标签、难度找内容；面板默认折叠，不占地方。',
        },
        {
          route: '/',
          target: 'app-feedback-btn',
          placement: 'bottom',
          title: '有意见，随时提',
          description: '点顶部的「💬 反馈」按钮，把意见或发现的 bug 告诉开发者——不登录也能提。',
        },
        {
          route: '/',
          target: 'app-login-btn',
          placement: 'bottom',
          title: '登录解锁更多',
          description: '注册登录后可以：问 AI 助手、AI 定制专属学习路线、划词注解、收藏与学习进度标注。点右上角「登录 / 注册」马上开始。',
        },
        {
          route: '/',
          title: '开始探索吧！',
          description: '右上角的 💡 灯泡随时可以点开，重看这份引导。',
        },
      ];
    }
    if (type === 'user') {
      return [
        {
          route: '/paths',
          title: '🎉 登录成功！',
          description: '最后几步，带你看懂登录后怎么学——先把页面切到「🗺 学习路线」。',
        },
        {
          route: '/paths',
          target: 'paths-list',
          placement: 'right',
          title: '官方路线，点开就学',
          description: '⭐ 标记的是官方路线，已置顶排好——点开任意一条就能直接开始学习，不需要任何配置。',
        },
        {
          route: '/paths',
          target: 'paths-create-btn',
          placement: 'right',
          title: 'AI 帮你定制专属路线',
          description: '点这个虚线按钮，输入你的学习目标（比如「我想做一个 RAG 应用」），AI 会基于本站知识生成一条专属路线，还能继续对话调整。',
        },
        {
          route: '/',
          target: 'app-assistant-btn',
          placement: 'bottomLeft',
          title: '遇到问题，随时问 AI 助手',
          description: '看图谱的任何时候点顶部「助手」，右侧滑出抽屉（就像现在这样），可以多轮追问；满意的回答还能一键沉淀为知识点。这里只是打开示意，不会真的调用模型。',
          onEnter: () => openAssistant(true),
          onLeave: () => openAssistant(false),
        },
        {
          route: '/',
          target: '.knowledge-drawer .ant-drawer-content-wrapper',
          title: '选中文字，让 AI 解释',
          description: '读笔记时选中任意一段文字（上方示意了一段蓝色选区），会浮出「💡 解答」——AI 解释选中内容，还能存为注解和大家讨论。这里只是界面演示，没有发送任何请求。',
          onEnter: enterAnnoDemo,
          onLeave: leaveAnnoDemo,
        },
        {
          route: '/',
          title: '开始你的学习之旅吧！',
          description: '右上角 💡 灯泡随时重看引导；学习中有任何意见，点顶部「💬 反馈」。',
        },
      ];
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, demoNodeId, openAssistant, openNode]);

  /** 步骤推进器：跨页步骤先导航，到位后等一帧再展示；进入/离开时执行演示效果 */
  useEffect(() => {
    if (!type) { setShown(false); return; }
    const def = steps[step];
    if (!def) { setShown(false); return; }
    if (def.route && loc.pathname !== def.route) {
      setShown(false);
      nav(def.route);
      return;
    }
    let cancelled = false;
    const raf = requestAnimationFrame(() => { if (!cancelled) setShown(true); });
    def.onEnter?.();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      def.onLeave?.();
    };
  }, [type, step, steps, loc.pathname, nav]);

  if (!type) return null;

  const antdSteps: TourProps['steps'] = steps.map((s) => ({
    title: s.title,
    description: s.description,
    placement: s.placement,
    target: s.target?.startsWith('.') ? () => bySel(s.target!) : s.target ? () => byId(s.target!) : undefined,
  }));

  return (
    <Tour
      open={shown}
      current={step}
      onClose={close}
      onChange={(c) => setStep(c)}
      steps={antdSteps}
    />
  );
}
