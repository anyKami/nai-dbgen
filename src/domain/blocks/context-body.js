/**
 * 从楼层原文里抽出要送进提示词的正文。
 * 默认只留所有 <content> 里面的字，思维链和其他标签不进去。
 */

/** 默认：每一段 <content>…</content> 的内部。括号里是要留下的正文。 */
export const DEFAULT_CONTEXT_BODY_PATTERN = '<content>([\\s\\S]*?)</content>';

export const CONTEXT_BODY_PATTERN_HINT = '当前上下文和最后一楼只保留这里匹配到的正文。默认取所有 <content> 里面的字，思维链和其他标签不进去。留空则整楼原文都要。这一楼一个都匹配不到时，仍用原文。括号里是要留下的部分。';

/**
 * 空字符串表示关闭过滤。写错的正则退回默认，避免一次手误把上下文清空。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeContextBodyPattern(value) {
    if (value == null) {
        return DEFAULT_CONTEXT_BODY_PATTERN;
    }
    const text = String(value);
    if (text.trim() === '') {
        return '';
    }
    try {
        // 只用源码，全局匹配由提取时加上。
        RegExp(text);
        return text;
    } catch {
        return DEFAULT_CONTEXT_BODY_PATTERN;
    }
}

/**
 * @param {unknown} text
 * @param {unknown} [pattern] 缺省用默认正则；空字符串表示不过滤
 * @returns {string}
 */
export function extractContextBody(text, pattern) {
    const source = String(text ?? '');
    const spec = pattern == null
        ? DEFAULT_CONTEXT_BODY_PATTERN
        : normalizeContextBodyPattern(pattern);
    if (spec.trim() === '') {
        return source;
    }
    let re;
    try {
        re = new RegExp(spec, 'g');
    } catch {
        return source;
    }
    const parts = [];
    for (const match of source.matchAll(re)) {
        const piece = match.length > 1 && match[1] != null ? match[1] : match[0];
        const value = String(piece ?? '').trim();
        if (value) {
            parts.push(value);
        }
    }
    return parts.length ? parts.join('\n') : source;
}
