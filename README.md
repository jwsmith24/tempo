# Tempo

A tool for planning and tracking training.

## Local development

Prerequisites: Python 3.12+ and Node.js 22+.

```sh
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
npm --prefix frontend install
```

Start Tempo on loopback with one command:

```sh
npm --prefix frontend run tempo
```

Open <http://127.0.0.1:8000>. Application data is stored with owner-only
permissions under `~/Library/Application Support/Tempo` on macOS and
`~/.local/share/tempo` on other platforms. Set `TEMPO_DATABASE_URL` to use a
different SQLite database.

Run the backend and browser suites with:

```sh
.venv/bin/pytest
npm --prefix frontend test
```