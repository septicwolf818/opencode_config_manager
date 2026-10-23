# OpenCode Config Manager

A local, schema-driven editor for OpenCode configuration. Build a new config from the current OpenCode JSON Schema, or import an existing `.json` or `.jsonc` file and continue editing it.

## Features

- Forms generated from the live OpenCode configuration schema, including nested objects, named maps, arrays, and union types.
- Full-width nested panes: parent sections fold into adjacent vertical title strips while the active object or list opens in its own pane.
- Search within the active pane, live JSON preview, schema validation feedback, clipboard copy, and JSON download.
- JSONC import with support for comments and trailing commas.
- Light/dark appearance follows the system by default. Theme and preview visibility choices are remembered in browser storage.
- The imported or edited configuration stays in the browser. The local Python server serves the app and fetches the schema; it does not read or write your OpenCode config files.

## Requirements

- Python 3.9 or newer
- Internet access when starting the app, to retrieve the OpenCode schema

No Python packages or JavaScript dependencies are required.

## Run locally

```sh
make run
```

Open <http://127.0.0.1:8000/>. The Makefile creates `.venv` on first run and starts the standard-library HTTP server. Press Ctrl+C to stop it.

To use another port:

```sh
make run PORT=8080
```

To remove the virtual environment and Python cache files:

```sh
make clean
```

## Use

1. Start with an empty config, or choose **Import JSON** to load an existing `.json` or `.jsonc` file.
2. Open object or list fields to edit their nested entries. Use the folded title strips to return to a parent pane.
3. Review validation feedback and the live JSON preview.
4. Choose **Copy JSON** or **Download** to export an `opencode.json` file.

The schema is fetched from <https://opencode.ai/config.json> at startup. The server also resolves the schema's model reference from `models.dev` through a restricted local endpoint so the browser does not need cross-origin access.

Validation covers the schema constraints used by the OpenCode config schema, including types, references, required fields, enums, additional properties, patterns, and numeric/array bounds. It is a lightweight config-focused validator rather than a general-purpose JSON Schema implementation.
