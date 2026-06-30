import type { RuntimeRefreshResult, RuntimeRefreshWatcherStatus } from '../refresh/runtime-refresh-coordinator';

export interface RuntimeRefreshClientState {
    lastRefresh?: RuntimeRefreshResult;
    refreshOnReloadFailure?: RuntimeRefreshResult;
    watcher?: RuntimeRefreshWatcherStatus;
}

function serializeForInlineScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

function createRuntimeRefreshInstallerScript(state?: RuntimeRefreshClientState | null): string {
    const serializedState = serializeForInlineScript(state ?? {});
    return `<script>
window.__RUNTIME_PREVIEW_REFRESH_STATE__ = ${serializedState};
(function installRuntimeRefresh() {
    function getFailureMessage(result, fallback) {
        if (result && typeof result.error === 'string' && result.error) {
            return result.error;
        }
        return fallback;
    }

    function getSuccessMessage(result) {
        if (result && result.target === 'dirty-set' && Array.isArray(result.targets) && result.targets.length === 0) {
            return 'No asset changes detected.';
        }
        if (result && result.target === 'dirty-set') {
            return 'Refreshed ' + (Array.isArray(result.targets) ? result.targets.length : 0) + ' changed asset target(s).';
        }
        return 'Runtime refresh completed.';
    }

    function getCompileDiagnostic(result) {
        if (!result) {
            return null;
        }
        return result.compileError || (result.scriptCompile && result.scriptCompile.diagnostic) || null;
    }

    function getDiagnosticLocation(diagnostic) {
        var location = diagnostic && diagnostic.location ? diagnostic.location : {};
        var text = location.relativeFilePath || location.filePath || location.assetUrl || 'unknown';
        if (typeof location.line === 'number') {
            text += ':' + location.line;
            if (typeof location.column === 'number') {
                text += ':' + location.column;
            }
        }
        return text;
    }

    function getCompileStateMessage(result) {
        if (result && result.outputState === 'lastGoodDueToFailure') {
            return 'Current change was not applied. Preview keeps last good scripts.';
        }
        if (result && result.outputState === 'noUsableOutput') {
            return 'Current change was not applied. Preview has no usable script output.';
        }
        return '';
    }

    function appendCompilePanelText(parent, tagName, className, text) {
        if (!text) {
            return null;
        }
        var element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }

    function renderRuntimePreviewCompileErrorPanel(result) {
        var diagnostic = getCompileDiagnostic(result);
        var existing = document.querySelector('#runtime-preview-compile-error-panel');
        if (!diagnostic) {
            if (existing) {
                existing.remove();
            }
            return;
        }
        var panel = existing || document.createElement('section');
        panel.id = 'runtime-preview-compile-error-panel';
        panel.setAttribute('role', 'alert');
        panel.textContent = '';
        Object.assign(panel.style, {
            position: 'fixed',
            left: '16px',
            right: '16px',
            bottom: '16px',
            zIndex: '10002',
            maxHeight: '55vh',
            overflow: 'auto',
            padding: '14px 16px',
            border: '1px solid #7f3535',
            borderRadius: '4px',
            color: '#f7d7d7',
            background: '#211515',
            font: '12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            boxShadow: '0 6px 24px rgba(0, 0, 0, 0.45)',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
        });
        var title = appendCompilePanelText(panel, 'div', 'runtime-preview-compile-error-title', 'Script compile failed');
        if (title) {
            Object.assign(title.style, {
                fontSize: '14px',
                fontWeight: '700',
                marginBottom: '8px',
            });
        }
        appendCompilePanelText(panel, 'div', 'runtime-preview-compile-error-location', getDiagnosticLocation(diagnostic));
        appendCompilePanelText(panel, 'div', 'runtime-preview-compile-error-message', diagnostic.message || 'Unknown compile error');
        if (diagnostic.codeFrame) {
            var codeFrame = appendCompilePanelText(panel, 'pre', 'runtime-preview-compile-error-code-frame', diagnostic.codeFrame);
            if (codeFrame) {
                Object.assign(codeFrame.style, {
                    margin: '10px 0 0',
                    padding: '10px',
                    overflow: 'auto',
                    color: '#f0f0f0',
                    background: '#111111',
                    border: '1px solid #333333',
                    borderRadius: '3px',
                    whiteSpace: 'pre',
                    userSelect: 'text',
                });
            }
        }
        appendCompilePanelText(panel, 'div', 'runtime-preview-compile-error-state', getCompileStateMessage(result));
        if (!existing) {
            document.body.appendChild(panel);
        }
    }

    function showRuntimeRefreshToast(message) {
        var toast = document.querySelector('#runtime-preview-refresh-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'runtime-preview-refresh-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
    }

    function ensureRuntimeRefreshButton() {
        var button = document.querySelector('#btn-runtime-refresh');
        var toolbar = document.querySelector('.toolbar');
        if (!button) {
            button = document.createElement('button');
            button.id = 'btn-runtime-refresh';
            button.className = 'item';
            button.type = 'button';
            button.title = 'Refresh AssetDB';
            button.textContent = 'Refresh';
            if (toolbar) {
                toolbar.appendChild(button);
            } else {
                button.classList.add('runtime-preview-refresh-fixed');
                document.body.appendChild(button);
            }
        } else if (!toolbar) {
            button.classList.add('runtime-preview-refresh-fixed');
        }

        if (button.dataset.runtimeRefreshInstalled === 'true') {
            return button;
        }
        button.dataset.runtimeRefreshInstalled = 'true';
        button.addEventListener('click', function onRuntimeRefreshClick(event) {
            event.preventDefault();
            button.disabled = true;
            fetch('/__runtime-preview/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            }).then(function(response) {
                return response.json();
            }).then(function(result) {
                window.__RUNTIME_PREVIEW_LAST_REFRESH__ = result;
                if (result && result.ok === true) {
                    if (result.target === 'dirty-set' && result.scriptCompile && result.scriptCompile.status === 'skipped') {
                        button.disabled = false;
                        renderRuntimePreviewCompileErrorPanel(null);
                        showRuntimeRefreshToast(getSuccessMessage(result));
                        return;
                    }
                    window.location.reload();
                    return;
                }
                button.disabled = false;
                window.__RUNTIME_PREVIEW_REFRESH_STATE__ = { lastRefresh: result };
                renderRuntimePreviewCompileErrorPanel(result);
                var message = getFailureMessage(result, 'Runtime refresh failed.');
                console.warn('[runtime-preview] refresh failed', result);
                showRuntimeRefreshToast(message);
            }).catch(function(error) {
                button.disabled = false;
                var message = error && error.message ? error.message : String(error);
                console.warn('[runtime-preview] refresh request failed', error);
                showRuntimeRefreshToast(message);
            });
        });
        return button;
    }

    function bootRuntimeRefresh() {
        ensureRuntimeRefreshButton();
        var state = window.__RUNTIME_PREVIEW_REFRESH_STATE__ || {};
        if (state.refreshOnReloadFailure) {
            window.__RUNTIME_PREVIEW_REFRESH_ON_RELOAD__ = state.refreshOnReloadFailure;
            showRuntimeRefreshToast(getFailureMessage(state.refreshOnReloadFailure, 'Runtime refresh on reload failed.'));
        }
        renderRuntimePreviewCompileErrorPanel(state.lastRefresh || state.refreshOnReloadFailure);
        if (state.watcher && state.watcher.error) {
            showRuntimeRefreshToast('Runtime asset watcher unavailable: ' + state.watcher.error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootRuntimeRefresh, { once: true });
    } else {
        bootRuntimeRefresh();
    }
})();
</script>`;
}

export function injectRuntimeRefreshEntry(html: string, state?: RuntimeRefreshClientState | null): string {
    const script = createRuntimeRefreshInstallerScript(state);
    return html.includes('</body>')
        ? html.replace('</body>', `${script}\n</body>`)
        : `${html}\n${script}`;
}
