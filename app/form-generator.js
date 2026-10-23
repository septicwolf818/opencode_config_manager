class FormGenerator {
    constructor(schemaLoader, onChange) {
        this.schemaLoader = schemaLoader;
        this.onChange = onChange;
        this.config = {};
        this.root = null;
        this.navPath = [];
        this.searchQuery = '';
        this.scrollPositions = new Map();
        this.renderedPathKey = null;
        this.unionValues = new Map();
    }

    render(config, root) {
        this.config = config || {};
        this.root = root;
        this.navPath = [];
        this.searchQuery = '';
        this.scrollPositions.clear();
        this.renderedPathKey = null;
        this.unionValues.clear();
        const search = document.getElementById('fieldSearch');
        if (search) search.value = '';
        this.refresh();
    }

    refresh(direction = 'none') {
        if (this.renderedPathKey === this.pathKey()) this.saveScrollPosition();
        this.root.replaceChildren();
        const schema = this.resolveSchemaPath(this.navPath);
        const stage = document.createElement('div');
        stage.className = 'builder-stage';
        if (this.navPath.length) {
            for (let depth = 0; depth < this.navPath.length; depth++) {
                const ancestor = this.navPath.slice(0, depth);
                const label = depth === 0 ? 'All settings' : ancestor[ancestor.length - 1];
                const tab = this.button(label, 'folded-panel', () => this.navigate(ancestor));
                const labelElement = document.createElement('span');
                labelElement.className = 'folded-panel-label';
                labelElement.textContent = label;
                tab.replaceChildren(labelElement);
                tab.title = `Back to ${label}`;
                tab.setAttribute('aria-label', `Return to ${label}`);
                stage.appendChild(tab);
            }
        }
        const activePane = document.createElement('div');
        activePane.className = `active-pane${direction === 'none' ? '' : ` pane-enter-${direction}`}`;
        stage.appendChild(activePane);
        const value = this.get(this.navPath);
        if (schema.type === 'array' || schema.prefixItems) {
            this.buildArrayPane(schema, value, this.navPath, activePane);
        } else {
            this.buildObject(schema, value, this.navPath, activePane, this.navPath.length === 0);
        }
        this.root.appendChild(stage);
        this.setSearch(this.searchQuery);
        this.renderedPathKey = this.pathKey();
        this.restoreScrollPosition();
    }

    setSearch(query) {
        this.searchQuery = query.trim().toLowerCase();
        const cards = [...this.root.querySelectorAll('.property-card')];
        cards.forEach(card => {
            card.hidden = Boolean(this.searchQuery && !card.dataset.search.includes(this.searchQuery));
        });
        let empty = this.root.querySelector('.search-empty');
        if (this.searchQuery && cards.length && cards.every(card => card.hidden)) {
            if (!empty) {
                empty = document.createElement('p');
                empty.className = 'empty-state search-empty';
                empty.textContent = 'No matching fields in this section.';
                this.root.querySelector('.builder-view')?.appendChild(empty);
            }
        } else empty?.remove();
    }

    navigate(path) {
        this.saveScrollPosition();
        const direction = path.length < this.navPath.length ? 'back' : 'forward';
        this.navPath = [...path];
        this.searchQuery = '';
        const search = document.getElementById('fieldSearch');
        if (search) search.value = '';
        this.refresh(direction);
    }

    pathKey(path = this.navPath) {
        return JSON.stringify(path);
    }

    unionCacheKey(path, choiceIndex) {
        return `${this.pathKey(path)}::${choiceIndex}`;
    }

    cloneValue(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    switchUnionChoice(path, previousIndex, nextChoice) {
        const previousValue = this.cloneValue(this.get(path));
        const previousCacheKey = this.unionCacheKey(path, previousIndex);
        if (previousValue === undefined) this.unionValues.delete(previousCacheKey);
        else this.unionValues.set(previousCacheKey, previousValue);

        const nextCacheKey = this.unionCacheKey(path, nextChoice.index);
        const nextValue = this.unionValues.has(nextCacheKey)
            ? this.cloneValue(this.unionValues.get(nextCacheKey))
            : this.initialValue(nextChoice.option);
        const mergedValue = this.mergeCompatibleValue(previousValue, nextValue, nextChoice.raw);
        if (mergedValue === undefined) this.unset(path);
        else this.set(path, mergedValue);
        return mergedValue;
    }

    mergeCompatibleValue(previousValue, nextValue, rawSchema) {
        if (previousValue === undefined) return this.cloneValue(nextValue);
        const schema = this.resolve(rawSchema);

        if (schema.anyOf || schema.oneOf) {
            const options = schema.anyOf || schema.oneOf;
            const selected = options.find(option => this.schemaLoader.validate(nextValue, option).length === 0)
                || options.find(option => this.schemaLoader.validate(previousValue, option).length === 0);
            return selected ? this.mergeCompatibleValue(previousValue, nextValue, selected) : this.cloneValue(nextValue);
        }

        if (schema.type === 'object' || schema.properties) {
            if (!previousValue || typeof previousValue !== 'object' || Array.isArray(previousValue)) return this.cloneValue(nextValue);
            const merged = nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)
                ? this.cloneValue(nextValue)
                : {};

            for (const [key, previousChild] of Object.entries(previousValue)) {
                const childSchema = schema.properties?.[key];
                if (!childSchema) {
                    if (schema.additionalProperties === false) continue;
                    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
                        merged[key] = this.mergeCompatibleValue(previousChild, merged[key], schema.additionalProperties);
                    } else {
                        merged[key] = this.cloneValue(previousChild);
                    }
                    continue;
                }

                const candidate = this.mergeCompatibleValue(previousChild, merged[key], childSchema);
                if (this.schemaLoader.validate(candidate, childSchema).length === 0) merged[key] = candidate;
                else if (this.schemaLoader.validate(previousChild, childSchema).length === 0) merged[key] = this.cloneValue(previousChild);
            }
            return merged;
        }

        if (this.schemaLoader.validate(previousValue, schema).length === 0) return this.cloneValue(previousValue);
        return this.cloneValue(nextValue);
    }

    saveScrollPosition() {
        const pane = document.querySelector('.active-pane');
        this.scrollPositions.set(this.pathKey(), {
            paneTop: pane?.scrollTop || 0,
            windowTop: window.scrollY || 0
        });
    }

    restoreScrollPosition() {
        const position = this.scrollPositions.get(this.pathKey()) || { paneTop: 0, windowTop: 0 };
        requestAnimationFrame(() => {
            const pane = document.querySelector('.active-pane');
            if (pane) pane.scrollTop = position.paneTop;
            window.scrollTo(0, position.windowTop);
        });
    }

    resolve(schema) {
        return this.schemaLoader.resolve(schema || {});
    }

    resolveSchemaPath(path) {
        let schema = this.schemaLoader.schema;
        let value = this.config;
        for (const segment of path) {
            schema = this.resolve(schema);
            if (schema.anyOf || schema.oneOf) {
                const options = schema.anyOf || schema.oneOf;
                const selected = options.find(option => this.schemaLoader.validate(value, option).length === 0) || options[0];
                schema = this.resolve(selected);
            }

            if (typeof segment === 'number' && (schema.type === 'array' || schema.prefixItems)) {
                schema = schema.prefixItems?.[segment] || schema.items || {};
            } else if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, segment)) {
                schema = schema.properties[segment];
            } else if (schema.type === 'object' && schema.additionalProperties && typeof schema.additionalProperties === 'object') {
                schema = schema.additionalProperties;
                if (schema.anyOf || schema.oneOf) {
                    const options = schema.anyOf || schema.oneOf;
                    const selected = options.find(option => this.schemaLoader.validate(value?.[segment], option).length === 0) || options[0];
                    schema = selected || {};
                }
            } else {
                return {};
            }
            value = value?.[segment];
        }

        schema = this.resolve(schema);
        if (schema.anyOf || schema.oneOf) {
            const options = schema.anyOf || schema.oneOf;
            schema = this.resolve(options.find(option => this.schemaLoader.validate(value, option).length === 0) || options[0]);
        }
        return schema;
    }

    buildObject(rawSchema, value, path, parent, isRoot = false) {
        const schema = this.resolve(rawSchema);
        const properties = schema.properties || {};
        const section = document.createElement('section');
        section.className = 'builder-view';
        const heading = document.createElement('div');
        heading.className = 'builder-view-heading';
        const title = document.createElement('h3');
        title.textContent = isRoot ? 'OpenCode configuration' : path[path.length - 1];
        heading.appendChild(title);
        if (schema.description && !isRoot) heading.appendChild(this.description(schema.description));
        const grid = document.createElement('div');
        grid.className = 'builder-grid';
        for (const [key, childSchema] of Object.entries(properties)) {
            const fieldPath = [...path, key];
            const field = this.buildPropertyCard(childSchema, value?.[key], fieldPath, key, (schema.required || []).includes(key));
            if (field) grid.appendChild(field);
        }

        if (schema.additionalProperties !== false && (schema.additionalProperties || Object.keys(properties).length === 0)) {
            const mapSchema = schema.additionalProperties && typeof schema.additionalProperties === 'object' ? schema.additionalProperties : {};
            const map = this.buildMap(mapSchema, value || {}, path, properties);
            map.classList.add('property-card');
            map.dataset.search = 'additional entries';
            grid.appendChild(map);
        }
        if (!grid.childElementCount) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = this.searchQuery ? 'No matching fields in this section.' : 'No fields are defined in this schema section.';
            section.appendChild(empty);
        }
        section.append(heading, grid);
        parent.appendChild(section);
        this.setSearch(this.searchQuery);
        return section;
    }

    buildPropertyCard(rawSchema, value, path, name, required) {
        const schema = this.resolve(rawSchema);
        if (schema.type === 'array' || schema.prefixItems) return this.buildArrayCard(schema, value, path, name, required);
        if (schema.type === 'object' || schema.properties) return this.buildObjectCard(schema, value, path, name, required);

        const card = this.buildNode(rawSchema, value, path, name, required);
        if (card) {
            card.classList.add('property-card');
            card.dataset.search = `${name} ${schema.description || ''}`.toLowerCase();
        }
        return card;
    }

    buildObjectCard(schema, value, path, name, required) {
        const card = document.createElement('article');
        card.className = 'property-card object-card';
        card.dataset.search = `${name} ${schema.description || ''}`.toLowerCase();
        const title = document.createElement('h4');
        title.textContent = name + (required ? ' *' : '');
        card.appendChild(title);
        if (schema.deprecated) {
            const badge = document.createElement('span');
            badge.className = 'deprecated-badge';
            badge.textContent = 'deprecated';
            title.appendChild(badge);
        }
        if (schema.description) card.appendChild(this.description(schema.description));
        const actions = document.createElement('div');
        actions.className = 'object-card-actions';
        const hasObject = value && typeof value === 'object' && !Array.isArray(value);
        const toggle = this.button(hasObject ? (required ? 'Required object' : 'Remove object') : 'Add object', 'btn btn-sm btn-secondary object-toggle', () => {
            if (hasObject && !required) this.unset(path);
            else this.set(path, this.initialValue(schema));
            this.onChange();
            this.refresh();
        });
        toggle.disabled = Boolean(hasObject && required);
        const open = this.button('Configure object →', 'btn btn-sm btn-primary object-open', () => this.navigate(path));
        open.title = `Open the nested ${name} settings`;
        open.setAttribute('aria-label', `Open ${name} section`);
        actions.append(toggle, open);
        card.appendChild(actions);
        return card;
    }

    buildArrayCard(schema, value, path, name, required) {
        const card = document.createElement('article');
        card.className = 'property-card object-card array-card';
        card.dataset.search = `${name} ${schema.description || ''}`.toLowerCase();
        const title = document.createElement('h4');
        title.textContent = name + (required ? ' *' : '');
        card.appendChild(title);
        if (schema.description) card.appendChild(this.description(schema.description));
        const count = document.createElement('p');
        count.className = 'field-description array-count';
        const itemCount = Array.isArray(value) ? value.length : 0;
        count.textContent = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
        card.appendChild(count);
        const action = this.button('Open list →', 'btn btn-sm btn-primary object-open', () => this.navigate(path));
        action.title = `Open the ${name} list`;
        action.setAttribute('aria-label', `Open ${name} list`);
        const actions = document.createElement('div');
        actions.className = 'object-card-actions';
        actions.appendChild(action);
        card.appendChild(actions);
        return card;
    }

    buildArrayPane(schema, value, path, parent) {
        const section = document.createElement('section');
        section.className = 'builder-view list-view';
        const heading = document.createElement('div');
        heading.className = 'builder-view-heading';
        const title = document.createElement('h3');
        title.textContent = path[path.length - 1] || 'List';
        heading.appendChild(title);
        if (schema.description) heading.appendChild(this.description(schema.description));
        const grid = document.createElement('div');
        grid.className = 'builder-grid';
        const list = this.buildArray(schema, value, path, 'List items', false, true);
        list.classList.add('property-card');
        list.dataset.search = `${title.textContent} list items ${schema.description || ''}`.toLowerCase();
        grid.appendChild(list);
        section.append(heading, grid);
        parent.appendChild(section);
    }

    buildNode(rawSchema, value, path, name, required = false) {
        const schema = this.resolve(rawSchema);
        if (schema.anyOf || schema.oneOf) return this.buildUnion(schema, value, path, name, required);
        if (schema.type === 'object' || schema.properties) return this.buildObjectCard(schema, value, path, name, required);
        if (schema.type === 'array' || schema.prefixItems) return this.buildArrayCard(schema, value, path, name, required);
        if (!schema.type && !schema.enum && !schema.anyOf && !schema.oneOf) return this.buildJsonValue(schema, value, path, name, required);
        return this.buildScalar(schema, value, path, name, required);
    }

    buildUnion(schema, value, path, name, required) {
        const choices = this.unionChoices(schema, name);
        const selected = this.findMatchingChoice(choices, value);
        const wrap = document.createElement('div');
        wrap.className = 'form-field union-field';
        wrap.appendChild(this.label(name, required, schema.deprecated));
        if (schema.description) wrap.appendChild(this.description(schema.description));

        const select = document.createElement('select');
        select.className = 'field-input field-select';
        select.setAttribute('aria-label', `${name} type`);
        choices.forEach(choice => {
            const option = document.createElement('option');
            option.value = String(choice.index);
            option.textContent = choice.title;
            option.selected = choice.index === selected.index;
            select.appendChild(option);
        });

        const editor = document.createElement('div');
        editor.className = 'union-editor';
        let activeChoiceIndex = selected.index;
        const renderChoice = choice => {
            editor.replaceChildren();
            const current = this.get(path);
            const child = this.buildNode(choice.raw, current, path, name, required);
            if (child) {
                child.classList.add('union-option-editor');
                editor.appendChild(child);
            }
        };
        select.addEventListener('change', () => {
            const choice = choices[Number(select.value)];
            this.switchUnionChoice(path, activeChoiceIndex, choice);
            activeChoiceIndex = choice.index;
            renderChoice(choice);
            this.onChange();
        });
        renderChoice(selected);
        wrap.append(select, editor);
        return wrap;
    }

    unionChoices(schema, name) {
        const alternatives = schema.anyOf || schema.oneOf || [];
        const flattenAnyOf = Boolean(schema.anyOf) && !schema.oneOf;
        const flattened = [];
        const collect = (raw, depth = 0) => {
            const option = this.resolve(raw);
            if (flattenAnyOf && option.anyOf && !option.oneOf && depth < 20) {
                option.anyOf.forEach(child => collect(child, depth + 1));
            } else {
                flattened.push({ raw, option });
            }
        };
        alternatives.forEach(option => collect(option));
        const choices = flattened.map(({ raw, option }, index) => ({
            raw,
            option,
            index,
            title: this.optionTitle(option, index, name)
        }));
        return choices;
    }

    buildScalar(schema, value, path, name, required) {
        const wrap = document.createElement('div');
        wrap.className = 'form-field';
        if (schema.deprecated) wrap.classList.add('deprecated-field');
        wrap.appendChild(this.label(name, required, schema.deprecated));
        if (schema.description) wrap.appendChild(this.description(schema.description));

        let input;
        const isBoolean = schema.type === 'boolean' || (schema.enum && schema.enum.every(item => typeof item === 'boolean'));
        if (schema.enum) {
            input = document.createElement('select');
            input.className = 'field-input field-select';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Choose…';
            input.appendChild(placeholder);
            schema.enum.forEach(item => {
                const option = document.createElement('option');
                option.value = JSON.stringify(item);
                option.textContent = String(item);
                option.selected = Object.is(item, value);
                input.appendChild(option);
            });
            input.addEventListener('change', () => {
                if (input.value === '') {
                    if (typeof path[path.length - 1] === 'number') this.set(path, null);
                    else this.unset(path);
                }
                else this.set(path, JSON.parse(input.value));
                this.onChange();
            });
        } else if (isBoolean) {
            input = document.createElement('select');
            input.className = 'field-input field-select';
            [
                { value: '', label: 'Not set' },
                { value: 'true', label: 'Enabled (true)' },
                { value: 'false', label: 'Disabled (false)' }
            ].forEach(item => {
                const option = document.createElement('option');
                option.value = item.value;
                option.textContent = item.label;
                option.selected = item.value === '' ? value === undefined : String(value) === item.value;
                input.appendChild(option);
            });
            input.addEventListener('change', () => {
                if (input.value === '') {
                    if (typeof path[path.length - 1] === 'number') this.set(path, null);
                    else this.unset(path);
                }
                else this.set(path, input.value === 'true');
                this.onChange();
            });
        } else {
            const numeric = schema.type === 'integer' || schema.type === 'number';
            const multiline = !numeric && ['system', 'prompt', 'template'].includes(String(name).toLowerCase());
            input = document.createElement(multiline ? 'textarea' : 'input');
            if (multiline) input.rows = 4;
            else input.type = numeric ? 'number' : 'text';
            input.className = 'field-input';
            if (numeric) {
                input.step = schema.type === 'integer' ? '1' : 'any';
                const min = schema.exclusiveMinimum !== undefined ? Number(schema.exclusiveMinimum) + (schema.type === 'integer' ? 1 : Number.EPSILON) : schema.minimum;
                const max = schema.exclusiveMaximum !== undefined ? Number(schema.exclusiveMaximum) - (schema.type === 'integer' ? 1 : Number.EPSILON) : schema.maximum;
                if (min !== undefined) input.min = min;
                if (max !== undefined) input.max = max;
                input.value = value ?? '';
                input.addEventListener('input', () => {
                    if (input.value === '') {
                        if (typeof path[path.length - 1] === 'number') this.set(path, null);
                        else this.unset(path);
                    }
                    else this.set(path, schema.type === 'integer' ? Number.parseInt(input.value, 10) : Number(input.value));
                    this.onChange();
                });
            } else {
                input.value = value ?? '';
                if (schema.pattern) input.pattern = schema.pattern;
                input.addEventListener('input', () => {
                    if (input.value === '') {
                        if (typeof path[path.length - 1] === 'number') this.set(path, '');
                        else this.unset(path);
                    }
                    else this.set(path, input.value);
                    this.onChange();
                });
            }
        }
        input.classList.add('field-input');
        wrap.appendChild(input);
        return wrap;
    }

    buildArray(schema, value, path, name, required, inPane = false) {
        const wrap = document.createElement('fieldset');
        wrap.className = 'form-field array-field';
        const legend = document.createElement('legend');
        legend.appendChild(this.label(name, required, schema.deprecated, true));
        wrap.appendChild(legend);
        if (schema.description && !inPane) wrap.appendChild(this.description(schema.description));

        const items = Array.isArray(value) ? value : [];
        const list = document.createElement('div');
        list.className = 'array-list';
        items.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'array-entry';
            const itemSchema = schema.prefixItems?.[index] || schema.items || {};
            const field = this.buildNode(itemSchema, item, [...path, index], `Item ${index + 1}`, true);
            if (field) row.appendChild(field);
            const remove = this.button('Remove', 'btn btn-danger btn-sm', () => {
                const next = [...items]; next.splice(index, 1);
                next.length ? this.set(path, next) : this.unset(path);
                this.onChange(); this.refresh();
            });
            row.appendChild(remove);
            list.appendChild(row);
        });
        wrap.appendChild(list);
        const add = this.button('+ Add item', 'btn array-add-btn', () => {
            const next = [...items, this.initialValue(schema.items || schema.prefixItems?.[items.length] || {})];
            this.set(path, next); this.onChange(); this.refresh();
        });
        wrap.appendChild(add);
        return wrap;
    }

    buildMap(valueSchema, objectValue, path, knownProperties = {}) {
        const wrap = document.createElement('fieldset');
        wrap.className = 'form-field map-field';
        const legend = document.createElement('legend');
        legend.textContent = 'Entries';
        wrap.appendChild(legend);
        const source = objectValue && typeof objectValue === 'object' && !Array.isArray(objectValue) ? objectValue : {};
        const entries = Object.entries(source).filter(([key]) => !Object.prototype.hasOwnProperty.call(knownProperties, key));
        const list = document.createElement('div');
        list.className = 'map-list';

        entries.forEach(([key, entryValue]) => {
            const row = document.createElement('div');
            row.className = 'map-entry';
            const keyInput = document.createElement('input');
            keyInput.className = 'field-input map-key';
            keyInput.value = key;
            keyInput.setAttribute('aria-label', 'Entry name');
            keyInput.addEventListener('change', () => {
                const newKey = keyInput.value.trim();
                if (!newKey || newKey === key) return;
                const parent = this.get(path) || {};
                if (Object.prototype.hasOwnProperty.call(parent, newKey)) { keyInput.value = key; return; }
                const next = { ...parent, [newKey]: parent[key] }; delete next[key];
                this.set(path, next); this.onChange(); this.refresh();
            });
            const valueField = this.buildNode(valueSchema, entryValue, [...path, key], key, true);
            const remove = this.button('Remove', 'btn btn-danger btn-sm', () => {
                const next = { ...(this.get(path) || {}) }; delete next[key];
                this.set(path, next);
                if (!Object.keys(next).length) this.prune(path);
                this.onChange(); this.refresh();
            });
            row.append(keyInput, valueField, remove);
            list.appendChild(row);
        });
        wrap.appendChild(list);
        wrap.appendChild(this.button('+ Add entry', 'btn array-add-btn', () => {
            const current = this.get(path) || {};
            let key = 'new_entry'; let suffix = 2;
            while (Object.prototype.hasOwnProperty.call(current, key)) key = `new_entry_${suffix++}`;
            this.set(path, { ...current, [key]: this.initialValue(valueSchema) });
            this.onChange(); this.refresh();
        }));
        return wrap;
    }

    buildJsonValue(schema, value, path, name, required) {
        const wrap = document.createElement('div');
        wrap.className = 'form-field';
        wrap.appendChild(this.label(name, required, schema.deprecated));
        if (schema.description) wrap.appendChild(this.description(schema.description));
        const input = document.createElement('textarea');
        input.className = 'field-input json-value-input';
        input.rows = 4;
        input.placeholder = 'Enter a JSON value';
        input.value = value === undefined ? '' : JSON.stringify(value, null, 2);
        input.addEventListener('change', () => {
            if (!input.value.trim()) this.unset(path);
            else {
                try {
                    this.set(path, JSON.parse(input.value));
                    input.setCustomValidity('');
                } catch (error) {
                    input.setCustomValidity(`Invalid JSON: ${error.message}`);
                    input.reportValidity();
                    return;
                }
            }
            this.onChange();
        });
        wrap.appendChild(input);
        return wrap;
    }

    initialValue(rawSchema) {
        const schema = this.resolve(rawSchema);
        if (schema.anyOf || schema.oneOf) return this.initialValue((schema.anyOf || schema.oneOf)[0]);
        if (schema.enum?.length) return schema.enum[0];
        if (schema.const !== undefined) return schema.const;
        if (schema.type === 'boolean') return false;
        if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? (schema.exclusiveMinimum !== undefined ? Number(schema.exclusiveMinimum) + 1 : 0);
        if (schema.type === 'array') return [];
        if (schema.type === 'object' || schema.properties) {
            const result = {};
            for (const key of schema.required || []) result[key] = this.initialValue(schema.properties?.[key] || {});
            return result;
        }
        return '';
    }

    findMatchingChoice(choices, value) {
        const matches = choices.find(choice => this.schemaLoader.validate(value, choice.raw).length === 0);
        return matches || choices[0] || { index: 0, raw: {}, option: {}, title: 'Value' };
    }

    optionTitle(schema, index, fieldName = '') {
        if (schema.title) return schema.title;
        if (schema.type === 'object') {
            const properties = schema.properties || {};
            if (Object.keys(properties).length === 1 && properties.enabled?.type === 'boolean' && (schema.required || []).includes('enabled')) {
                return 'Enabled-only override';
            }
            const discriminator = Object.entries(properties).find(([, property]) =>
                property.const !== undefined || (Array.isArray(property.enum) && property.enum.length === 1)
            );
            if (discriminator) {
                const [key, property] = discriminator;
                const value = property.const !== undefined ? property.const : property.enum[0];
                if (key === 'type' && value === 'local') return 'Local MCP server';
                if (key === 'type' && value === 'remote') return 'Remote MCP server';
                if (key === 'type' && value === 'summary') return 'Summary strategy';
                if (key === 'type' && value === 'native') return 'Native strategy';
                if (key === 'enabled' && value === true && (schema.required || []).includes(key)) return 'Enabled-only override';
                return `Object · ${key}: ${value}`;
            }
            const required = schema.required || [];
            const keys = required.length ? required : Object.keys(properties);
            if (keys.length) return `Object with ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''}`;
            if (schema.additionalProperties) return 'Object map';
            return `Object value${fieldName ? ` (${fieldName})` : ''}`;
        }
        if (schema.type === 'array') return 'List';
        if (schema.enum?.length === 1 && schema.enum[0] === false) return 'Disabled (false)';
        if (schema.enum?.length === 1 && schema.enum[0] === true) return 'Enabled (true)';
        if (schema.enum) return schema.enum.map(String).join(' / ');
        return schema.type || `Option ${index + 1}`;
    }

    label(name, required, deprecated, asNode = false) {
        const label = document.createElement(asNode ? 'span' : 'label');
        label.className = 'field-label';
        label.appendChild(document.createTextNode(name || 'Value'));
        if (required) {
            const mark = document.createElement('span'); mark.className = 'required'; mark.textContent = ' *'; label.appendChild(mark);
        }
        if (deprecated) {
            const badge = document.createElement('span'); badge.className = 'deprecated-badge'; badge.textContent = 'deprecated'; label.appendChild(badge);
        }
        return label;
    }

    description(text) { const p = document.createElement('p'); p.className = 'field-description'; p.textContent = text; return p; }
    button(text, className, handler) { const button = document.createElement('button'); button.type = 'button'; button.className = className; button.textContent = text; button.addEventListener('click', handler); return button; }
    get(path) { return path.reduce((node, key) => node == null ? undefined : node[key], this.config); }

    set(path, value) {
        if (!path.length) { this.config = value; return; }
        let node = this.config;
        for (let index = 0; index < path.length - 1; index++) {
            const key = path[index];
            if (!node[key] || typeof node[key] !== 'object') node[key] = typeof path[index + 1] === 'number' ? [] : {};
            node = node[key];
        }
        node[path[path.length - 1]] = value;
    }

    unset(path) {
        let node = this.config;
        for (let index = 0; index < path.length - 1; index++) {
            node = node?.[path[index]];
            if (!node) return;
        }
        if (node) delete node[path[path.length - 1]];
        this.prune(path.slice(0, -1));
    }

    prune(path) {
        if (!path.length) return;
        let node = this.config;
        for (const key of path) node = node?.[key];
        if (node && typeof node === 'object' && !Array.isArray(node) && Object.keys(node).length === 0) this.unset(path);
    }
}
