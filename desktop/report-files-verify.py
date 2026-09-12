"""Read-only OOXML checks on files downloaded by report-ui-smoke.cjs.

Uses Python's standard library, independently of the application's XLSX writer.
No report files are rewritten. Run with the smoke output directory as argument.
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
from decimal import Decimal
from xml.etree import ElementTree as ET

root = Path(sys.argv[1]).resolve()
result = json.loads((root / "result.json").read_text(encoding="utf-8-sig"))
assert result["ok"]
ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
checks = []
reports = [result["base"], result["financial"], result["revised"], result["base"]]
for download, report in zip(result["downloads"], reports, strict=True):
    file = Path(download["path"])
    assert file.parent.resolve() == root
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    assert digest == report["fileSha256"]
    with zipfile.ZipFile(file) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        names = [sheet.attrib["name"] for sheet in workbook.findall("m:sheets/m:sheet", ns)]
        assert names == ["汇总表", "甲店", "乙店", "代发表"] + (["扣款"] if report["kind"] == "financial" else [])
        sheets = []
        for index, name in enumerate(names, 1):
            xml = ET.fromstring(archive.read(f"xl/worksheets/sheet{index}.xml"))
            cells = {}
            for cell in xml.findall(".//m:sheetData/m:row/m:c", ns):
                value = "".join(cell.itertext())
                cells[cell.attrib["r"]] = {"value": value, "type": cell.attrib.get("t"), "style": cell.attrib.get("s")}
                assert cell.attrib.get("t") != "e", f"Excel error {name} {cell.attrib['r']}"
            assert xml.find("m:pageSetup", ns).attrib["fitToWidth"] == "1"
            assert xml.find("m:sheetViews/m:sheetView/m:pane", ns).attrib["state"] == "frozen"
            sheets.append(cells)
        summary = sheets[0]
        final_column = "O" if report["kind"] == "financial" else "M"
        total_row = next(address[1:] for address, cell in summary.items() if address.startswith("K") and cell["value"] == "合计")
        final = summary[final_column + total_row]
        assert final["type"] == "n"
        assert Decimal(final["value"]) == Decimal(report["displayTotals"]["profit"])
        # Tiny real cost and true zero remain numeric, not formatted strings.
        assert any(c["type"] == "n" and Decimal(c["value"]) == Decimal("0.009") for c in summary.values() if c["type"] == "n")
        assert any(c["type"] == "n" and Decimal(c["value"]) == 0 for c in summary.values() if c["type"] == "n")
        if report["revision"] == 1:
            dispatch = sheets[3]
            for identifier in ["12345678901234567890", "12345678901234567891"]:
                assert any(c["value"] == identifier and c["type"] == "inlineStr" for c in dispatch.values())
        if report["kind"] == "financial":
            deduction = sheets[4]
            values = [Decimal(c["value"]) for c in deduction.values() if c["type"] == "n"]
            assert Decimal("1.009") in values and Decimal("-0.004") in values
        checks.append({"file": file.name, "sha256": digest, "sheets": names, "profit": final["value"], "typedValues": True, "printWidthAndFreeze": True})
assert Path(result["downloads"][0]["path"]).read_bytes() == Path(result["downloads"][3]["path"]).read_bytes()
(root / "xlsx-verification.json").write_text(json.dumps({"ok": True, "checks": checks}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"ok": True, "files": len(checks)}, ensure_ascii=True))
