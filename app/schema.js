const OPENCODE_SCHEMA_URL = '/schema.json';

class SchemaLoader {
    constructor(url = OPENCODE_SCHEMA_URL) {
        this.url = url;
        this.schema = null;
        this.resources = new Map();
    }

    async load() {
        const response = await fetch(this.url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Schema request failed (${response.status})`);
        this.schema = await response.json();
        const externalRefs = new Set();
        const visit = value => {
            if (!value || typeof value !== 'object') return;
            if (typeof value.$ref === 'string' && !value.$ref.startsWith('#/')) externalRefs.add(value.$ref.split('#')[0]);
            Object.values(value).forEach(visit);
        };
        visit(this.schema);
        await Promise.all([...externalRefs].map(async resource => {
            try {
                const result = await fetch(`/external-schema?url=${encodeURIComponent(resource)}`, { cache: 'no-cache' });
                if (result.ok) this.resources.set(resource, await result.json());
            } catch (_) {
                // The OpenCode schema remains usable if an optional external reference is unavailable.
            }
        }));
        return this.schema;
    }

    resolve(node, depth = 0) {
        if (!node || depth > 30) return node || {};
        if (Array.isArray(node)) return node;
        let current = node;
        let overlay = {};
        let remaining = depth;
        while (current?.$ref && remaining++ < 30) {
            const [resource, fragment = ''] = current.$ref.split('#', 2);
            const root = resource ? this.resources.get(resource) : this.schema;
            if (!root) break;
            const pointer = fragment.replace(/^\//, '');
            const target = pointer ? pointer.split('/').reduce((value, part) => {
                const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
                return value?.[key];
            }, root) : root;
            if (!target || target === current) break;
            overlay = { ...current, ...overlay };
            delete overlay.$ref;
            current = target;
        }
        return current === node && !Object.keys(overlay).length ? node : { ...current, ...overlay, ...(current.$ref ? { $ref: current.$ref } : {}) };
    }

    validate(value, node = this.schema, path = '$') {
        const errors = [];
        this.validateInto(value, node, path, errors, 0);
        return errors;
    }

    validateInto(value, node, path, errors, depth) {
        if (!node || depth > 40) return;
        node = this.resolve(node);
        if (node.$ref && node.$ref.startsWith('#/')) {
            this.validateInto(value, this.resolve(node), path, errors, depth + 1);
            return;
        }

        if (node.anyOf || node.oneOf) {
            const alternatives = node.anyOf || node.oneOf;
            const matches = alternatives.map(option => this.validate(value, option, path).length === 0);
            const count = matches.filter(Boolean).length;
            if (node.anyOf && count === 0) errors.push(`${path} does not match any allowed schema`);
            if (node.oneOf && count !== 1) errors.push(`${path} must match exactly one allowed schema`);
            return;
        }
        if (Array.isArray(node.allOf)) {
            node.allOf.forEach(option => this.validateInto(value, option, path, errors, depth + 1));
        }

        if (node.enum && !node.enum.some(item => Object.is(item, value))) {
            errors.push(`${path} must be one of: ${node.enum.map(String).join(', ')}`);
            return;
        }
        if (Object.prototype.hasOwnProperty.call(node, 'const') && !Object.is(node.const, value)) {
            errors.push(`${path} must equal ${JSON.stringify(node.const)}`);
            return;
        }

        const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;
        const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
        if (types.length && !types.some(type => type === actualType || (type === 'number' && actualType === 'integer'))) {
            errors.push(`${path} must be ${types.join(' or ')}`);
            return;
        }

        if (typeof value === 'string') {
            if (node.minLength !== undefined && value.length < node.minLength) errors.push(`${path} is shorter than ${node.minLength} characters`);
            if (node.maxLength !== undefined && value.length > node.maxLength) errors.push(`${path} is longer than ${node.maxLength} characters`);
            if (node.pattern) {
                try { if (!(new RegExp(node.pattern)).test(value)) errors.push(`${path} does not match ${node.pattern}`); }
                catch (_) { /* Ignore invalid patterns in third-party schema fragments. */ }
            }
        }

        if (typeof value === 'number') {
            if (node.minimum !== undefined && value < node.minimum) errors.push(`${path} must be ≥ ${node.minimum}`);
            if (node.maximum !== undefined && value > node.maximum) errors.push(`${path} must be ≤ ${node.maximum}`);
            if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) errors.push(`${path} must be > ${node.exclusiveMinimum}`);
            if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) errors.push(`${path} must be < ${node.exclusiveMaximum}`);
        }

        if (Array.isArray(value)) {
            if (node.minItems !== undefined && value.length < node.minItems) errors.push(`${path} must contain at least ${node.minItems} items`);
            if (node.maxItems !== undefined && value.length > node.maxItems) errors.push(`${path} must contain at most ${node.maxItems} items`);
            value.forEach((item, index) => {
                const itemSchema = node.prefixItems?.[index] || node.items;
                if (itemSchema && typeof itemSchema === 'object') this.validateInto(item, itemSchema, `${path}[${index}]`, errors, depth + 1);
            });
        }

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const required of node.required || []) {
                if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push(`${path}.${required} is required`);
            }
            for (const [key, child] of Object.entries(value)) {
                if (node.properties?.[key]) {
                    this.validateInto(child, node.properties[key], `${path}.${key}`, errors, depth + 1);
                } else if (node.patternProperties) {
                    const matching = Object.entries(node.patternProperties).find(([pattern]) => {
                        try { return new RegExp(pattern).test(key); } catch (_) { return false; }
                    });
                    if (matching) this.validateInto(child, matching[1], `${path}.${key}`, errors, depth + 1);
                    else if (node.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
                    else if (node.additionalProperties && typeof node.additionalProperties === 'object') this.validateInto(child, node.additionalProperties, `${path}.${key}`, errors, depth + 1);
                } else if (!node.properties?.[key]) {
                    if (node.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
                    else if (node.additionalProperties && typeof node.additionalProperties === 'object') this.validateInto(child, node.additionalProperties, `${path}.${key}`, errors, depth + 1);
                }
            }
        }
    }
}

const schemaLoader = new SchemaLoader();
