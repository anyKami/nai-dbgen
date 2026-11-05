/**
 * 按条目标题筛选已开启的世界书。标题必须完整包含至少一个关键字。
 * 空关键字、空标题、空正文都不算命中。
 * @param {Array<{ name?: string, content?: string }>|null|undefined} entries
 * @param {unknown} keywords
 * @returns {string}
 */
export function selectWorldInfoByEntryName(entries, keywords) {
    const needles = (Array.isArray(keywords) ? keywords : [])
        .map((item) => String(item ?? '').trim())
        .filter((item) => item.length > 0);
    if (!needles.length || !Array.isArray(entries)) {
        return '';
    }
    const parts = [];
    for (const entry of entries) {
        const name = String(entry?.name ?? '').trim();
        const content = String(entry?.content ?? '').trim();
        if (!name || !content) {
            continue;
        }
        if (needles.some((keyword) => name.includes(keyword))) {
            parts.push(content);
        }
    }
    return parts.join('\n');
}
