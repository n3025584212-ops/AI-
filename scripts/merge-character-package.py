"""Merge the character history/base/baseline bundle into a copy of the web release package.
The original QCDKR-web-cloud-20261025.zip is left untouched.
"""
import hashlib
import zipfile
from pathlib import Path

REL = Path(r"D:\Agent\传智杯\rollcraft\release")
MAIN = REL / "QCDKR-web-cloud-20261025.zip"
STAGE = REL / "staging-character-history-base-20261025"
OUT = REL / "QCDKR-web-cloud-20261025-with-history-base.zip"

NOTE = """本包 = 主程序包 QCDKR-web-cloud-20261025.zip（原样，未改动任何程序文件）+ 角色附属内容。

附加目录：
  QCDKR-character-history/    版本历史与过程证据（清单、溯源、计划、复述、卡点与学习状态、git 记录）
  QCDKR-character-base/       底模（engineer-b-base.glb / engineer-b-base.blend / engineer-b-rigged.glb）
  QCDKR-character-baseline/   基线与对照（原 B 参考图、风格说明、基线对照页、溯源核验、造型诊断、交付说明与关键图）

主程序包内人物模型：QCDKR-web-cloud/dist/assets/engineer-b.glb（34,751,628 字节）。
完整溯源见 QCDKR-character-history/PACKAGED-MODEL-PROVENANCE.txt。
未包含：17 GB 全量历史 blend 与各候选工作目录（清单内有路径、大小、时间）。
"""


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    if OUT.exists():
        OUT.unlink()
    mapping = {
        "history": "QCDKR-character-history",
        "base": "QCDKR-character-base",
        "baseline": "QCDKR-character-baseline",
    }
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        with zipfile.ZipFile(MAIN) as src:
            for info in src.infolist():
                out.writestr(info, src.read(info.filename))
        out.writestr("附加内容-角色历史与底板说明.txt", NOTE)
        for sub, prefix in mapping.items():
            for p in sorted((STAGE / sub).rglob("*")):
                if p.is_file():
                    out.write(p, f"{prefix}/{p.relative_to(STAGE / sub).as_posix()}")
    print("OUT", OUT, OUT.stat().st_size)
    print("SHA", sha256(OUT))
    with zipfile.ZipFile(OUT) as z:
        names = z.namelist()
        print("entries", len(names))
        roots = sorted({n.split("/")[0] for n in names})
        print("roots", roots)
        added = [n for n in names if n.startswith("QCDKR-character") or n.startswith("附加内容")]
        print("added_entries", len(added))
        for n in added:
            print("  ", z.getinfo(n).file_size, n)
        bad = z.testzip()
        print("testzip", bad or "OK")


if __name__ == "__main__":
    main()
