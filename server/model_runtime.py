"""Persistent JSON-lines inference worker for explicitly configured DK-QKAR artifacts.

Only load a pickle from a trusted source. The required expected digest binds the
configuration, metadata and exact bytes that are passed to pickle.loads.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import hmac
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import pickle
import re
import sys
import traceback

for _name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_name, "1")
# Embedded distribution runs in isolated mode, which ignores PYTHONDONTWRITEBYTECODE;
# without this the runtime rewrites __pycache__ inside the installation directory.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent / "model-definition"))
MAX_BATCH = 1024
MAX_LINE_BYTES = 4 * 1024 * 1024


class ModelError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


MAX_MESSAGE_CHARS = 700


def describe(error: BaseException) -> str:
    return re.sub(r"\s+", " ", f"{type(error).__name__}: {error}".strip())


def cause_chain(error: BaseException) -> str:
    chain, seen, current = [], set(), error.__cause__
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(describe(current))
        current = current.__cause__
    return " ← ".join(chain)


def error_object(error: Exception) -> dict:
    message = str(error).strip() or type(error).__name__
    chain = cause_chain(error)
    if chain and chain not in message:
        message = f"{message}（底层原因：{chain}）"
    return {"code": getattr(error, "code", "MODEL_ERROR"), "message": message[:MAX_MESSAGE_CHARS]}


RUNTIME_PACKAGES = ("numpy", "pandas", "scipy", "sklearn", "joblib")
ADVICE = "常见原因：压缩包未完整解压、磁盘空间不足，或杀毒软件隔离了程序文件。请将程序目录加入杀毒软件白名单，重新完整解压发行包，并运行包内「verify-integrity.cmd」核对。"


def runtime_preflight() -> None:
    """Pinpoint broken packaging before numpy masks the real cause with its source-tree message."""
    missing = []
    for name in RUNTIME_PACKAGES:
        spec = importlib.util.find_spec(name)
        if spec is None or not spec.submodule_search_locations:
            missing.append(name)
            continue
        root = Path(list(spec.submodule_search_locations)[0])
        if name == "numpy":
            for filename in ("__init__.py", "__config__.py"):
                if not (root / filename).is_file():
                    missing.append(f"numpy/{filename}")
            if not list((root / "_core").glob("_multiarray_umath*.pyd")):
                missing.append("numpy/_core/_multiarray_umath*.pyd")
            if not any((root.parent / "numpy.libs").glob("*.dll")):
                missing.append("numpy.libs/*.dll")
    if missing:
        raise ModelError("RUNTIME_INCOMPLETE", f"模型运行环境不完整：{', '.join(missing)} 缺失。{ADVICE}")


def emit(value: dict) -> None:
    print(json.dumps(value, ensure_ascii=True, allow_nan=False), flush=True)


def dependencies() -> dict[str, str]:
    return {"python": ".".join(map(str, sys.version_info[:3])), **{
        name: importlib.metadata.version(name) for name in ("numpy", "pandas", "scikit-learn", "scipy", "joblib", "threadpoolctl")
    }}


def load_model(model_path: Path, metadata_path: Path, expected_sha256: str):
    if not re.fullmatch(r"[a-fA-F0-9]{64}", expected_sha256):
        raise ModelError("HASH_REQUIRED", "expected-sha256 must be a 64-character SHA-256 digest.")
    try:
        raw = model_path.read_bytes()
    except OSError as error:
        raise ModelError("MODEL_FILE_MISSING", f"Cannot read model artifact: {error}") from error
    digest = hashlib.sha256(raw).hexdigest()
    if not hmac.compare_digest(digest, expected_sha256.lower()):
        raise ModelError("MODEL_HASH_MISMATCH", "Model artifact does not match the configured SHA-256 digest.")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise ModelError("MODEL_METADATA_INVALID", f"Cannot read model metadata: {error}") from error
    if not isinstance(metadata, dict) or metadata.get("schema_version") != 1:
        raise ModelError("MODEL_METADATA_INVALID", "Unsupported or missing metadata schema_version.")
    if metadata.get("model_hash") != digest:
        raise ModelError("MODEL_HASH_MISMATCH", "Metadata and model artifact SHA-256 digests differ.")
    runtime_preflight()
    try:
        import numpy as np
    except ImportError as error:
        detail = describe(error)
        chain = cause_chain(error)
        if chain:
            detail = f"{detail} ← {chain}"
        raise ModelError("RUNTIME_IMPORT_FAILED", f"内置 numpy 运行库加载失败。{ADVICE}（技术细节：{detail[:260]}）") from None
    from dkqkar_v5s2_model import DKQKARV5S2, FEATURES, TARGET
    installed = dependencies()
    saved = metadata.get("dependencies", {})
    for name in ("numpy", "pandas", "scikit-learn", "scipy", "joblib", "threadpoolctl"):
        if saved.get(name) != installed[name]:
            raise ModelError("MODEL_VERSION_MISMATCH", f"{name} requires {saved.get(name)!r}; installed {installed[name]!r}.")
    if ".".join(str(saved.get("python", "")).split(".")[:2]) != ".".join(installed["python"].split(".")[:2]):
        raise ModelError("MODEL_VERSION_MISMATCH", "The model and runtime require matching Python major/minor versions.")
    if metadata.get("feature_keys") != FEATURES or metadata.get("input_dim") != len(FEATURES) or metadata.get("target") != TARGET:
        raise ModelError("MODEL_SCHEMA_MISMATCH", "Model metadata must specify the exact 25 ordered S5 input features and target.")
    ranges = metadata.get("feature_ranges")
    if not isinstance(ranges, dict) or set(ranges) != set(FEATURES):
        raise ModelError("MODEL_METADATA_INVALID", "Metadata feature_ranges must contain all 25 input features.")
    for key, limits in ranges.items():
        if not isinstance(limits, list) or len(limits) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) for v in limits) or limits[0] > limits[1]:
            raise ModelError("MODEL_METADATA_INVALID", f"Invalid feature range: {key}")
    if type(metadata.get("training_samples")) is not int or metadata["training_samples"] < 10:
        raise ModelError("MODEL_METADATA_INVALID", "Metadata training_samples must be an integer of at least 10.")
    # Deserialize the exact bytes already hashed above, never reopen the file.
    model = pickle.loads(raw)
    if not isinstance(model, DKQKARV5S2) or model.is_fitted is not True:
        raise ModelError("MODEL_NOT_FITTED", "Artifact is not a fitted DKQKARV5S2 model.")
    n = metadata["training_samples"]
    def finite_shape(value, shape, label):
        array = np.asarray(value)
        if array.shape != shape or not np.issubdtype(array.dtype, np.number) or not np.isfinite(array).all():
            raise ModelError("MODEL_STATE_INVALID", f"Invalid fitted model state: {label}.")
        return array
    if model.quantum_dim != 5:
        raise ModelError("MODEL_STATE_INVALID", "The deployed DK-QKAR-V5S2 model must have 5 quantum inputs.")
    indices = model.selected_feature_indices
    if not isinstance(indices, list) or len(indices) != 5 or len(set(indices)) != 5 or any(type(i) not in (int, np.int64, np.int32) or i < 0 or i >= 25 for i in indices):
        raise ModelError("MODEL_STATE_INVALID", "Invalid selected quantum feature indices.")
    if model.selected_features != [FEATURES[i] for i in indices]:
        raise ModelError("MODEL_STATE_INVALID", "Selected feature names and indices disagree.")
    finite_shape(model.theta, (5,), "theta")
    finite_shape(model.train_x_scaled, (n, 25), "classical training inputs")
    finite_shape(model.train_q_scaled, (n, 5), "quantum training inputs")
    for scaler, size, name in ((model.x_scaler, 25, "x_scaler"), (model.q_scaler, 5, "q_scaler"), (model.y_scaler, 1, "y_scaler")):
        if getattr(scaler, "n_features_in_", None) != size:
            raise ModelError("MODEL_STATE_INVALID", f"Invalid fitted preprocessor: {name}.")
        scale = finite_shape(getattr(scaler, "scale_", None), (size,), f"{name}.scale_")
        if np.any(scale <= 0):
            raise ModelError("MODEL_STATE_INVALID", f"Non-positive fitted preprocessor scale: {name}.")
    if list(getattr(model.x_scaler, "feature_names_in_", [])) != FEATURES:
        raise ModelError("MODEL_STATE_INVALID", "Fitted preprocessor feature order differs from the S5 contract.")
    for scaler, attribute, size in ((model.x_scaler, "mean_", 25), (model.y_scaler, "mean_", 1), (model.q_scaler, "min_", 5)):
        finite_shape(getattr(scaler, attribute, None), (size,), attribute)
    reg = model.regressor
    if reg is None or reg.kernel != "precomputed" or getattr(reg, "n_features_in_", None) != n or tuple(getattr(reg, "shape_fit_", ())) != (n, n):
        raise ModelError("MODEL_STATE_INVALID", "SVR and training kernel dimensions differ.")
    support = np.asarray(getattr(reg, "support_", None))
    if support.ndim != 1 or not np.issubdtype(support.dtype, np.integer) or np.any(support < 0) or np.any(support >= n):
        raise ModelError("MODEL_STATE_INVALID", "Invalid SVR support indices.")
    finite_shape(reg.dual_coef_, (1, len(support)), "SVR dual coefficients")
    finite_shape(reg.intercept_, (1,), "SVR intercept")
    for key in ("C", "epsilon", "gamma", "lambda_scale", "alpha"):
        value = getattr(model, key)
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ModelError("MODEL_STATE_INVALID", f"Invalid model parameter: {key}.")
    # Verify one real inference through every scaler and kernel before ready.
    smoke = model.x_scaler.inverse_transform(model.train_x_scaled[:1]).tolist()
    values = model.predict(smoke)
    if np.asarray(values).shape != (1,) or not np.isfinite(values).all():
        raise ModelError("MODEL_STATE_INVALID", "Model failed its startup inference check.")
    return model, {**metadata, "runtime_dependencies": installed}


def handle(model, request):
    if not isinstance(request, dict):
        raise ModelError("INVALID_REQUEST", "Request must be an object.")
    if type(request.get("id")) not in (int, str):
        raise ModelError("INVALID_REQUEST", "Request id must be a string or integer.")
    if request.get("action") != "predict":
        raise ModelError("INVALID_ACTION", "The worker supports action=predict.")
    rows = request.get("rows")
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_BATCH:
        raise ModelError("INVALID_INPUT", f"rows must contain 1 to {MAX_BATCH} samples.")
    for row in rows:
        if not isinstance(row, list) or len(row) != 25 or any(type(v) not in (int, float) or not math.isfinite(v) for v in row):
            raise ModelError("INVALID_INPUT", "Each row must contain exactly 25 finite numbers; strings and booleans are not accepted.")
    import numpy as np
    values = np.asarray(model.predict(rows), dtype=float)
    if values.shape != (len(rows),) or not np.isfinite(values).all():
        raise ModelError("INVALID_PREDICTION", "Model did not return one finite prediction per row.")
    return values.tolist()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--metadata", required=True, type=Path)
    parser.add_argument("--expected-sha256", required=True)
    args = parser.parse_args()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            model, metadata = load_model(args.model, args.metadata, args.expected_sha256)
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        emit({"type": "error", "error": error_object(error)})
        return 1
    emit({"type": "ready", "model": metadata})
    while True:
        raw = sys.stdin.buffer.readline(MAX_LINE_BYTES + 1)
        if not raw:
            break
        request = None
        try:
            if len(raw) > MAX_LINE_BYTES:
                while raw and not raw.endswith(b"\n"):
                    raw = sys.stdin.buffer.readline(MAX_LINE_BYTES + 1)
                raise ModelError("INVALID_REQUEST", "Request exceeds the maximum line size.")
            request = json.loads(raw.decode("utf-8"), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"Invalid JSON constant: {value}")))
            with contextlib.redirect_stdout(sys.stderr):
                values = handle(model, request)
            emit({"id": request["id"], "ok": True, "values": values})
        except Exception as error:
            request_id = request.get("id") if isinstance(request, dict) and type(request.get("id")) in (int, str) else None
            emit({"id": request_id, "ok": False, "error": error_object(error)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())