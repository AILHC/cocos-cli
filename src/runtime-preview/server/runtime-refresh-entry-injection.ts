import type { RuntimeRefreshResult } from '../refresh/runtime-refresh-coordinator';

export interface RuntimeRefreshClientState {
    lastRefresh?: RuntimeRefreshResult;
    refreshOnReloadFailure?: RuntimeRefreshResult;
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
                    window.location.reload();
                    return;
                }
                button.disabled = false;
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
