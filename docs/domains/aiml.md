# AI & ML — IMPLEMENTED + TESTED (scope Python + PyTorch smoke)

Adapter: `packages/core/src/domains/aiml/index.ts`

## Có thật (máy kiểm chứng 2026-11-19)

- Tools detect qua PATH: python3 3.14.4, pip 25.1.1, uv 0.13.9, pytest 9.1.1, jupyter.
- Import thật: **torch 2.13.0+cpu**, **transformers 5.14.1**, **onnxruntime 1.28.0**, **onnx 1.23.2**, **cv2 5.0.0**, numpy/pandas/matplotlib/yaml OK. **scikit-learn MISSING** (import lỗi).
- Detect: `pyproject.toml`, `requirements.txt`, `environment.yml`, `setup.py`, `train.py`, `model.py`, `predict.py`, `*.ipynb`.
- `project.create` → `pyproject.toml` (dep `torch>=2.0`) + `train.py` (linear regression torch, seed cố định) + `test_train.py`.
- `build` → `python3 -m py_compile train.py test_train.py`; `test` → `python3 -m pytest -q` — test assert **loss giảm thật** trong ~6s. E2E `e2e-domain-aiml` exit 0.

## Chưa có

- transformers/ONNX Runner adapter (load model thật, inference bench).
- Training log/loss/checkpoint → ArtifactManager (chưa wire; plan còn đó).
- scikit-learn flow (thiếu lib, cài cần user approve: `uv pip install scikit-learn`).
- GPU flow (torch cpu-only trên máy này).

## Verify

```sh
pnpm run test   # domain.test.ts: aiml project → py_compile → pytest (2 tests)
```

Ràng buộc: không báo "train xong" nếu chưa chạy thật; scaffold CPU-only, không pull weights từ hub.
