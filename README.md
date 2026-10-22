# English Teacher Workbench（英语班主任工作台）

Local-first workbench for English class teachers: student profiles, school exam intake, knowledge-point follow-up, textbook/exam bank, targeted practice snapshots, and lesson notes.

Desktop app: FastAPI + SQLite backend, React/Vite frontend. Optional WeChat mini-program (`miniapp-lite`) for a lightweight student notebook.

## Privacy

- This public tree **excludes** `runtime/`, `data/`, `.venv/`, `release/`, `build/`, `node_modules/`, and any real student databases.
- Example/fixture data in tests is synthetic.
- Configure your own model API keys locally; never commit `.env` or `settings.json`.
- WeChat `appid` in configs is a placeholder — replace with your own.

## Quick start (desktop)

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd frontend && npm install && npm run build && cd ..
python launch.py
```

Default local URL: `http://127.0.0.1:8769` (localhost only).

Tests: `python -m pytest tests -q --tb=short`

## Layout

- `backend/` — FastAPI API
- `frontend/` — React UI source
- `miniapp-lite/` — WeChat native mini-program candidate
- `tests/` — automated checks with synthetic data
- `docs/`, `使用说明.md`, `API_CONTRACT.md`, `V02_CONTRACT.md`

## License

MIT © ThinkPair
