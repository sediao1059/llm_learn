/**
 * 解析模型返回文本里的 JSON 对象（取首个 `{` 到最后一个 `}` 之间的片段）。
 * 模型偶发会把 JSON 包进 ``` 代码块、前后带解释文字，或者多转义一层引号——
 * 整份都转义（`{\"a\":\"b\"}`）或只在部分字段里出现（`"tags": [\"x\"]`）；
 * 严格解析失败时按这几种情况依次尝试修复，都失败才抛中文错误，便于管理端看懂原因后重试。
 */
export function parseLlmJson(text: string): any {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  const brief = s.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (start === -1) throw new Error(`模型没有返回 JSON：${brief}`);
  if (end <= start) throw new Error(`模型返回的 JSON 不完整（可能输出被截断，可重试）：${brief}`);
  const body = s.slice(start, end + 1);
  const attempts: (() => string)[] = [
    () => body,
    // 整份被多转义一层：\" → "，\\ → \
    () => body.replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
    () => fixStrayEscapedQuotes(body),
  ];
  let lastErr: unknown;
  for (const make of attempts) {
    try {
      return JSON.parse(make());
    } catch (e) {
      lastErr = e;
    }
  }
  const reason = String((lastErr as any)?.message || lastErr).slice(0, 200);
  throw new Error(`模型返回的 JSON 格式不合法（已尝试自动修复仍失败，可重试）：${reason}`);
}

/**
 * 只修复「字符串外」出现的 `\"`：把它当作字符串的开头，并以下一个 `\"` 作为该字符串的结尾；
 * 正常字符串内部的转义原样保留，不碰已经合法的部分。
 */
function fixStrayEscapedQuotes(s: string): string {
  let out = '';
  let inStr = false;
  let strayOpen = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inStr) {
      if (c === '\\' && s[i + 1] === '"') {
        out += '"';
        inStr = true;
        strayOpen = true;
        i++;
        continue;
      }
      if (c === '"') {
        inStr = true;
        strayOpen = false;
      }
      out += c;
      continue;
    }
    if (c === '\\') {
      if (strayOpen && s[i + 1] === '"') {
        out += '"';
        inStr = false;
        i++;
        continue;
      }
      out += c + (s[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '"') inStr = false;
    out += c;
  }
  return out;
}
