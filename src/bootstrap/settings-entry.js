/**
 * 扩展程序列表入口。折叠行为与外观交给酒馆的 inline-drawer。
 */

/**
 * @param {object} deps
 * @param {import('../ports/host.port.js').HostPort} deps.host
 * @param {() => void|Promise<void>} deps.openWorkbench
 * @param {() => void|Promise<void>} deps.openConfig
 * @param {(error: unknown) => void} deps.onError
 * @returns {{ destroy: () => void }}
 */
export function mountSettingsEntry(deps) {
    if (typeof document === 'undefined') {
        return { destroy() {} };
    }

    const root = document.createElement('div');
    root.className = 'inline-drawer';

    const header = document.createElement('div');
    header.className = 'inline-drawer-toggle inline-drawer-header';
    header.tabIndex = 0;
    header.setAttribute('role', 'button');
    const title = document.createElement('b');
    title.textContent = '数据库生图';
    const chevron = document.createElement('div');
    chevron.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down';
    chevron.setAttribute('aria-hidden', 'true');
    header.append(title, chevron);

    const content = document.createElement('div');
    content.className = 'inline-drawer-content';
    const actions = document.createElement('div');
    actions.className = 'flex-container';
    content.appendChild(actions);
    root.append(header, content);

    const cleanups = [];
    for (const { label, icon, action } of [
        { label: '工作台', icon: 'fa-palette', action: deps.openWorkbench },
        { label: '配置', icon: 'fa-sliders', action: deps.openConfig },
    ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button menu_button_icon';
        button.title = `打开数据库生图${label}`;
        const glyph = document.createElement('i');
        glyph.className = `fa-solid ${icon}`;
        glyph.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = label;
        button.append(glyph, text);
        const onClick = async () => {
            if (button.disabled) return;
            button.disabled = true;
            try {
                await action();
            } catch (error) {
                deps.onError(error);
            } finally {
                button.disabled = false;
            }
        };
        button.addEventListener('click', onClick);
        cleanups.push(() => button.removeEventListener('click', onClick));
        actions.appendChild(button);
    }

    const onKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            header.click();
        }
    };
    header.addEventListener('keydown', onKeyDown);
    deps.host.mountSettingsPanel(root);

    return {
        destroy() {
            header.removeEventListener('keydown', onKeyDown);
            for (const cleanup of cleanups) cleanup();
            root.remove();
        },
    };
}
