class ConfigEditor {
    static STORAGE_KEYS = {
        previewVisible: 'opencode-config-manager.preview-visible',
        theme: 'opencode-config-manager.theme'
    };

    constructor() {
        this.config = {};
        this.form = new FormGenerator(schemaLoader, () => this.updatePreview());
        this.root = document.getElementById('formRoot');
        this.preview = document.querySelector('#jsonPreview code');
        this.status = document.getElementById('statusBar');
        this.validation = document.getElementById('validationStatus');
        this.mainContent = document.querySelector('.main-content');
        this.previewVisible = true;
        this.themePreference = null;
        this.colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    }

    async start() {
        this.bindEvents();
        this.initializePreferences();
        try {
            await schemaLoader.load();
            document.getElementById('schemaStatus').textContent = 'Schema loaded';
            this.setStatus('Schema loaded. Start adding configuration fields or import a config.');
            this.render();
        } catch (error) {
            document.getElementById('schemaStatus').textContent = 'Schema unavailable';
            this.root.textContent = `Could not load the OpenCode schema: ${error.message}`;
            this.setStatus('Schema loading failed. Check your connection and reload.');
        }
    }

    bindEvents() {
        document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFileInput').click());
        document.getElementById('importFileInput').addEventListener('change', event => this.importFile(event));
        document.getElementById('copyBtn').addEventListener('click', () => this.copyJson());
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadJson());
        document.getElementById('clearBtn').addEventListener('click', () => this.clear());
        document.getElementById('togglePreviewBtn').addEventListener('click', () => this.setPreviewVisible(!this.previewVisible));
        document.getElementById('themeToggleBtn').addEventListener('click', () => this.toggleTheme());
        document.getElementById('fieldSearch').addEventListener('input', event => this.form.setSearch(event.target.value));
        this.colorSchemeQuery.addEventListener?.('change', () => {
            if (!this.themePreference) this.updateThemeButton();
        });
    }

    initializePreferences() {
        const storedPreview = this.readPreference(ConfigEditor.STORAGE_KEYS.previewVisible);
        const previewVisible = storedPreview === null
            ? !window.matchMedia('(max-width: 800px)').matches
            : storedPreview === 'true';
        this.setPreviewVisible(previewVisible, false);
        this.applyTheme(this.readPreference(ConfigEditor.STORAGE_KEYS.theme));
    }

    readPreference(key) {
        try { return window.localStorage.getItem(key); }
        catch (_) { return null; }
    }

    savePreference(key, value) {
        try { window.localStorage.setItem(key, value); }
        catch (_) { /* The editor still works when browser storage is unavailable. */ }
    }

    render() {
        this.form.render(this.config, this.root);
        this.updatePreview();
    }

    updatePreview() {
        const json = JSON.stringify(this.config, null, 2);
        this.preview.textContent = json;
        const errors = schemaLoader.validate(this.config);
        if (this.validation) {
            this.validation.replaceChildren();
            if (!errors.length) {
                this.validation.className = 'validation-status valid';
                this.validation.textContent = 'Valid against the loaded schema';
            } else {
                this.validation.className = 'validation-status invalid';
                const summary = document.createElement('span');
                summary.textContent = `${errors.length} schema issue${errors.length === 1 ? '' : 's'}`;
                const list = document.createElement('ul');
                errors.slice(0, 20).forEach(error => {
                    const item = document.createElement('li'); item.textContent = error; list.appendChild(item);
                });
                this.validation.append(summary, list);
            }
        }
        this.setStatus(errors.length ? `${errors.length} schema issue${errors.length === 1 ? '' : 's'} — review the validation panel.` : 'Configuration is valid JSON and matches the loaded schema.');
    }

    async importFile(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(this.parseJsonc(text));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The config root must be a JSON object.');
            this.config = parsed;
            this.render();
            this.setStatus(`Imported ${file.name}. Review validation results before copying or downloading.`);
        } catch (error) {
            this.setStatus(`Import failed: ${error.message}`);
        }
    }

    parseJsonc(source) {
        let output = '';
        let inString = false;
        let escaped = false;
        for (let index = 0; index < source.length; index++) {
            const char = source[index];
            const next = source[index + 1];
            if (inString) {
                output += char;
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') inString = false;
                continue;
            }
            if (char === '"') { inString = true; output += char; continue; }
            if (char === '/' && next === '/') {
                index += 2;
                while (index < source.length && source[index] !== '\n') index++;
                output += '\n';
                continue;
            }
            if (char === '/' && next === '*') {
                index += 2;
                while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index++;
                index++;
                output += ' ';
                continue;
            }
            output += char;
        }

        // Strip trailing commas without touching commas inside string values.
        let cleaned = '';
        inString = false;
        escaped = false;
        for (let index = 0; index < output.length; index++) {
            const char = output[index];
            if (inString) {
                cleaned += char;
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') inString = false;
                continue;
            }
            if (char === '"') { inString = true; cleaned += char; continue; }
            if (char === ',') {
                let lookahead = index + 1;
                while (/\s/.test(output[lookahead] || '') && lookahead < output.length) lookahead++;
                if (output[lookahead] === '}' || output[lookahead] === ']') continue;
            }
            cleaned += char;
        }
        return cleaned;
    }

    async copyJson() {
        const text = JSON.stringify(this.config, null, 2);
        try {
            await navigator.clipboard.writeText(text);
            this.setStatus('Configuration JSON copied to clipboard.');
        } catch (_) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed'; textarea.style.opacity = '0';
            document.body.appendChild(textarea); textarea.select();
            const copied = document.execCommand('copy'); textarea.remove();
            this.setStatus(copied ? 'Configuration JSON copied to clipboard.' : 'Clipboard access failed. Select and copy the JSON preview.');
        }
    }

    downloadJson() {
        const blob = new Blob([JSON.stringify(this.config, null, 2) + '\n'], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = 'opencode.json'; link.click();
        URL.revokeObjectURL(url);
        this.setStatus('Downloaded opencode.json.');
    }

    clear() {
        this.config = {};
        this.render();
        this.setStatus('Configuration cleared.');
    }

    setPreviewVisible(visible, persist = true) {
        this.previewVisible = visible;
        this.mainContent.classList.toggle('preview-hidden', !visible);
        const toggle = document.getElementById('togglePreviewBtn');
        toggle.textContent = visible ? 'Hide JSON' : 'Show JSON';
        toggle.setAttribute('aria-expanded', String(visible));
        if (persist) this.savePreference(ConfigEditor.STORAGE_KEYS.previewVisible, String(visible));
    }

    applyTheme(preference) {
        this.themePreference = preference === 'dark' || preference === 'light' ? preference : null;
        if (this.themePreference) document.documentElement.dataset.theme = this.themePreference;
        else delete document.documentElement.dataset.theme;
        this.updateThemeButton();
    }

    updateThemeButton() {
        const button = document.getElementById('themeToggleBtn');
        if (!button) return;
        const isDark = this.themePreference ? this.themePreference === 'dark' : this.colorSchemeQuery.matches;
        const target = isDark ? 'light' : 'dark';
        button.textContent = isDark ? '☀' : '☾';
        button.setAttribute('aria-label', `Switch to ${target} theme`);
        button.title = `Switch to ${target} theme`;
    }

    toggleTheme() {
        const isDark = this.themePreference ? this.themePreference === 'dark' : this.colorSchemeQuery.matches;
        const nextTheme = isDark ? 'light' : 'dark';
        this.savePreference(ConfigEditor.STORAGE_KEYS.theme, nextTheme);
        this.applyTheme(nextTheme);
    }

    setStatus(message) { this.status.textContent = message; }
}

window.addEventListener('DOMContentLoaded', () => {
    window.editor = new ConfigEditor();
    window.editor.start();
});
