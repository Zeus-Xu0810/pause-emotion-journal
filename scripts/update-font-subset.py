"""更新本地圆体界面子集，保留历史界面字符与动态日期字符。"""
from pathlib import Path
import json
from fontTools import subset
from fontTools.ttLib import TTFont

# 所有可修改输入集中在这里；完整字库与授权文件保持原样。
ROOT = Path(__file__).resolve().parents[1]
FULL_FONT = ROOT / "public/fonts/pause-round-full.woff2"
UI_FONT = ROOT / "public/fonts/pause-round-ui.woff2"
SOURCE_SUFFIXES = {".ts", ".tsx"}
EXTRA_CHARACTERS = "0123456789年月日星期一二三四五六七八九十百千上午下午周今天昨天：，。！？、（）—…+-/ %"


def main():
    # 以已有子集为底，避免后续精简文案时误删日历、日期与异步提示所需字形。
    with TTFont(UI_FONT) as previous:
        codepoints = set(previous.getBestCmap())
    codepoints.update(map(ord, EXTRA_CHARACTERS))
    for source in (ROOT / "src").rglob("*"):
        if source.suffix in SOURCE_SUFFIXES:
            codepoints.update(map(ord, source.read_text(encoding="utf-8")))

    # 只抽取完整圆体中存在的字符，保留字体名称与许可证元数据。
    font = TTFont(FULL_FONT)
    available = set(font.getBestCmap())
    options = subset.Options()
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=codepoints & available)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(UI_FONT)
    font.close()
    print(json.dumps({"glyphs": len(codepoints & available), "bytes": UI_FONT.stat().st_size}))


if __name__ == "__main__":
    main()
