"""Build the companion package: character version history + base mesh + baseline evidence.
Read-only against sources; writes only into release/staging and release/*.zip.
"""
import datetime
import hashlib
import json
import os
import shutil
import zipfile
from pathlib import Path

ROOT = Path(r"D:\Agent\传智杯")
LAB = ROOT / "rollcraft" / "character-lab"
REL = ROOT / "rollcraft" / "release"
STAGE = REL / "staging-character-history-base-20261025"
ZIP = REL / "QCDKR-character-history-base-20261025.zip"

PACKAGED_GLB = ROOT / "rollcraft" / "release-web-cloud" / "dist" / "assets" / "engineer-b.glb"


def sha256(path, limit=None):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            if limit and f.tell() > limit:
                return None
    return h.hexdigest()


def iso(ts):
    return datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")


def scan_versions():
    roots = [
        LAB / "assets",
        LAB / "versions",
        LAB / "recovery-20261025",
        LAB / "review-20261024",
        LAB / "plan-reset-20261025",
    ]
    rows = []
    seen = set()
    for base in roots:
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if not p.is_file():
                continue
            if p.suffix.lower() not in (".glb", ".blend", ".zip"):
                continue
            if ".blend1" in p.name.lower():
                continue
            key = str(p).lower()
            if key in seen:
                continue
            seen.add(key)
            st = p.stat()
            digest = None
            if p.suffix.lower() in (".glb", ".zip") and st.st_size <= 200 * 1024 * 1024:
                digest = sha256(p)
            rows.append({
                "path": str(p.relative_to(ROOT)),
                "bytes": st.st_size,
                "mtime": iso(st.st_mtime),
                "sha256": digest or "未计算（体积或类型）",
            })
    for p in sorted(LAB.glob("*.glb")):
        st = p.stat()
        rows.append({
            "path": str(p.relative_to(ROOT)),
            "bytes": st.st_size,
            "mtime": iso(st.st_mtime),
            "sha256": sha256(p) if st.st_size <= 200 * 1024 * 1024 else "未计算（体积）",
        })
    rows.sort(key=lambda r: r["mtime"], reverse=True)
    return rows


def copy(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def main():
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)

    # ---- history ----
    rows = scan_versions()
    inv_json = {
        "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "scope": "character-lab 下全部 .glb/.blend/.zip 版本文件",
        "count": len(rows),
        "files": rows,
    }
    (STAGE / "history").mkdir()
    (STAGE / "history" / "INVENTORY.json").write_text(
        json.dumps(inv_json, ensure_ascii=False, indent=1), encoding="utf8")

    lines = [
        "# B 工程师角色 · 版本文件清单",
        "",
        f"生成时间：{inv_json['generated']}；共 {len(rows)} 个文件。",
        "sha256 覆盖全部 .glb 与 .zip；.blend 只记大小与时间（全量哈希成本过高，未计算）。",
        "",
        "| 时间 | 大小(字节) | 文件 | sha256 |",
        "|---|---|---|---|",
    ]
    for r in rows:
        lines.append(f"| {r['mtime']} | {r['bytes']:,} | `{r['path']}` | {r['sha256'][:16]} |"
                     if r["sha256"].startswith(("未",)) is False else
                     f"| {r['mtime']} | {r['bytes']:,} | `{r['path']}` | {r['sha256']} |")
    (STAGE / "history" / "INVENTORY.md").write_text("\n".join(lines) + "\n", encoding="utf8")

    plan_dir = STAGE / "history" / "plan"
    for name in ["B_CHARACTER_PLAN.md", "B_CHARACTER_PLAN.sha256", "B_CHARACTER_RESTATEMENT.json",
                 "B_CHARACTER_CHECKINS.jsonl", "B_CHARACTER_LEARNING_STATE.json",
                 "B_CHARACTER_LEARNING_EVENTS.jsonl", "B_CHARACTER_AUTOMATION.json",
                 "B_CHARACTER_LEARNING_BLEND_PROBES.json"]:
        src = ROOT / name
        if src.exists():
            copy(src, plan_dir / name)

    # packaged model provenance
    prov = [
        "打包内人物模型的溯源（2026-10-25 核对）",
        "",
        "主包：rollcraft/release/QCDKR-web-cloud-20261025.zip（178,168,386 字节，19:42 生成）",
        "包内人物：QCDKR-web-cloud/dist/assets/engineer-b.glb",
    ]
    if PACKAGED_GLB.exists():
        st = PACKAGED_GLB.stat()
        prov += [
            f"大小：{st.st_size:,} 字节；sha256：{sha256(PACKAGED_GLB)}",
            "同哈希副本：rollcraft/public/assets/engineer-b.glb、rollcraft/dist/assets/engineer-b.glb、"
            "character-lab/recovery-20261025/rebuild-20261025/deliverables/interactive/engineer-b-smooth.glb",
            "结构：2 网格（Mesh_0 + 平板 Cube）、1 套蒙皮 23 骨、动画 Idle / LookTablet / Nod / Point / Wave、3 贴图",
            "来源：18:11 fix_normals.py 打开 b-meshy-hires.blend（17:33），清自定义法线并重算法线后导出 engineer-b-smooth.glb；"
            "18:19 拷入 public/dist；19:35 进 release-web-cloud；19:42 打包。",
            "未进包：18:13 的 b-meshy-eyes.blend（眼睛版，无对应 GLB）、被操作者判退的 assets/b-author-rebuild-20261025"
            "（engineer-b-interactive.glb，62,853,772 字节）。",
            "已知未过项见 rebuild-20261025/deliverables/README.md：持板姿态、手指结构、眼睑、站姿重心、袖管褶皱。",
        ]
    (STAGE / "history" / "PACKAGED-MODEL-PROVENANCE.txt").write_text("\n".join(prov) + "\n", encoding="utf8")

    # git log
    git_log = os.popen('git -C "D:/Agent/传智杯/rollcraft" log --date=iso --stat -n 40 2>&1').read()
    (STAGE / "history" / "git-log.txt").write_text(git_log or "(no git log)", encoding="utf8")

    # ---- base ----
    base_files = [
        (LAB / "assets" / "engineer-b-base.glb", "engineer-b-base.glb"),
        (LAB / "assets" / "engineer-b-base.blend", "engineer-b-base.blend"),
        (LAB / "assets" / "engineer-b-rigged.glb", "engineer-b-rigged.glb"),
    ]
    base_note = [
        "# 底模 / 底板说明",
        "",
        "本目录是角色可继续加工的基础形体与绑定版本，不是最终美术成品。",
        "",
        "| 文件 | 说明 |",
        "|---|---|",
        "| engineer-b-base.glb | 9,651,296 字节，B 工程师的静态底模（未绑定），继续雕刻/改比例从这里起 |",
        "| engineer-b-base.blend | 28 MB 级可编辑底模工程，Blender 4.5.15 打开 |",
        "| engineer-b-rigged.glb | 11,511,728 字节，含骨架的底模版本，做蒙皮与动作试验用 |",
        "",
        "关于“底板”的两种读法都核对过：",
        "1. 底模/基础模型 = 本目录三个文件。",
        "2. 展示底板 = 互动页里的地面是代码生成的 CircleGeometry（deliverables/interactive/index.html:73-74），"
        "没有独立模型文件可打包；包里的 DKQKAR_5Stand.glb 是设备五机架，不是人物底板。",
        "",
        "Blender：rollcraft/character-lab/tooling/blender-4.5.15-windows-x64/blender.exe",
    ]
    (STAGE / "base").mkdir()
    for src, name in base_files:
        if src.exists():
            copy(src, STAGE / "base" / name)
    (STAGE / "base" / "README-底模底板.md").write_text("\n".join(base_note) + "\n", encoding="utf8")

    # ---- baseline ----
    base_dir = STAGE / "baseline"
    pairs = [
        (LAB / "reference" / "B-reference-front.png", "B-reference-front.png"),
        (LAB / "reference" / "B-reference-head.png", "B-reference-head.png"),
        (LAB / "reference" / "B-reference-mask.png", "B-reference-mask.png"),
        (LAB / "reference" / "engineer-style-comparison.png", "engineer-style-comparison.png"),
        (LAB / "reference" / "engineer-b-mesh-input.png", "engineer-b-mesh-input.png"),
        (LAB / "reference" / "STYLE_B.md", "STYLE_B.md"),
        (LAB / "reference" / "SOURCES_AND_TOOLS_20261023.md", "SOURCES_AND_TOOLS_20261023.md"),
        (LAB / "recovery-20261025" / "baseline-comparison.html", "baseline-comparison.html"),
        (LAB / "recovery-20261025" / "baseline-provenance.json", "baseline-provenance.json"),
        (LAB / "recovery-20261025" / "baseline-static-verification.json", "baseline-static-verification.json"),
        (LAB / "recovery-20261025" / "art-diagnosis.md", "art-diagnosis.md"),
        (LAB / "recovery-20261025" / "rebuild-20261025" / "deliverables" / "README.md",
         "deliverable-README-20261025.md"),
        (LAB / "recovery-20261025" / "rebuild-20261025" / "deliverables" / "08-B-comparison.png",
         "08-B-comparison.png"),
        (LAB / "recovery-20261025" / "rebuild-20261025" / "deliverables" / "05-face.png", "05-face.png"),
        (LAB / "recovery-20261025" / "rebuild-20261025" / "deliverables" / "06-hand-tablet.png",
         "06-hand-tablet.png"),
    ]
    for src, name in pairs:
        if src.exists():
            copy(src, base_dir / name)

    # ---- readme ----
    readme = f"""QCDKR · B 工程师角色 · 历史 / 底模 / 基线 附属包
生成：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}（本机时间）
对应主包：rollcraft/release/QCDKR-web-cloud-20261025.zip
  主包内人物模型：dist/assets/engineer-b.glb（34,751,628 字节）

目录：
  history/   版本历史与过程证据
    INVENTORY.md / INVENTORY.json      character-lab 全部角色 .glb/.blend/.zip 清单（时间、大小、sha256）
    PACKAGED-MODEL-PROVENANCE.txt      主包里那个 GLB 的完整溯源与未进包版本
    git-log.txt                        rollcraft 仓库提交记录
    plan/                              锁定计划、哈希、复述记录、卡点与学习状态
  base/      底模（可继续加工的基础模型）
    engineer-b-base.glb / engineer-b-base.blend / engineer-b-rigged.glb
    README-底模底板.md                  “底板”两种读法的核对结论
  baseline/  基线与对照
    原 B 参考图（正/头/遮罩/对照）、STYLE_B.md、来源与工具说明、
    baseline-comparison.html、baseline-provenance.json、baseline-static-verification.json、
    造型诊断 art-diagnosis.md、20261025 交付说明与关键图

未包含：17 GB 全量历史 blend 与各候选工作目录（清单内有路径、大小、时间，可按需单独取用）；
129 MB 的通用基础角色 zip（assets/candidates/universal-base-characters-standard.zip）。

用法：底模用 Blender 4.5.15 打开（rollcraft/character-lab/tooling/blender-4.5.15-windows-x64/blender.exe）；
版本清单里的 glb 可按 sha256 定位到具体候选目录。
"""
    (STAGE / "README.txt").write_text(readme, encoding="utf8")

    # ---- zip ----
    if ZIP.exists():
        ZIP.unlink()
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in sorted(STAGE.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(STAGE).as_posix())

    print("ZIP", ZIP, ZIP.stat().st_size)
    with zipfile.ZipFile(ZIP) as z:
        total = 0
        for i in z.infolist():
            total += i.file_size
            print(f"{i.file_size:>10}  {i.filename}")
        print("entries", len(z.infolist()), "uncompressed", total)

    manifest = []
    for p in sorted(STAGE.rglob("*")):
        if p.is_file():
            manifest.append({
                "path": p.relative_to(STAGE).as_posix(),
                "bytes": p.stat().st_size,
                "sha256": sha256(p),
            })
    (REL / "QCDKR-character-history-base-20261025.MANIFEST.json").write_text(
        json.dumps({"zip": ZIP.name, "zip_bytes": ZIP.stat().st_size,
                    "zip_sha256": sha256(ZIP), "generated": inv_json["generated"],
                    "contents": manifest}, ensure_ascii=False, indent=1), encoding="utf8")
    print("STAGE", STAGE)
    print("ZIPSHA", sha256(ZIP))


if __name__ == "__main__":
    main()
