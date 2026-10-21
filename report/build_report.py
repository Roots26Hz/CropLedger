"""
Build the CropLedger synopsis PDF from report/REPORT.md.

REPORT.md is the editable source. This script understands the small
Markdown subset used there (headings, paragraphs, bullet and numbered lists,
pipe tables, **bold**, *italic*, `code`) plus one marker,
<!-- figure:architecture -->, which inserts a vector architecture diagram.

It then checks that the PDF has at most five pages and exits with an error
otherwise.

    python3 -m venv report/.venv
    report/.venv/bin/pip install -r report/requirements.txt
    report/.venv/bin/python report/build_report.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from pypdf import PdfReader
from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    CondPageBreak,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "REPORT.md"
OUTPUT = HERE / "CropLedger_Synopsis.pdf"
MAX_PAGES = 5

FOREST = colors.HexColor("#1a5535")
FOREST_LIGHT = colors.HexColor("#eef6f0")
INK = colors.HexColor("#1b2a21")
MUTED = colors.HexColor("#56665b")
LINE = colors.HexColor("#c9cfc6")

# Built-in PDF fonts only cover WinAnsi; map a few symbols to safe text.
SAFE = {"→": "->", "≤": "<=", "≥": ">=", "≈": "approx.", "‑": "-"}

BODY = ParagraphStyle("body", fontName="Times-Roman", fontSize=10.2, leading=12.8, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=4)
TITLE = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=FOREST, alignment=TA_CENTER, spaceAfter=6)
SUBTITLE = ParagraphStyle("subtitle", parent=BODY, fontName="Helvetica", fontSize=9.5, leading=12.5, alignment=TA_CENTER, textColor=MUTED, spaceAfter=1)
LEAD = ParagraphStyle("lead", parent=SUBTITLE, fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=INK, spaceAfter=6)
TEAM = ParagraphStyle("team", fontName="Helvetica", fontSize=10, leading=13, textColor=INK)
TEAM_HEAD = ParagraphStyle("teamhead", parent=TEAM, fontName="Helvetica-Bold", fontSize=8.2, leading=11, textColor=FOREST)
H1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=11.5, leading=14, textColor=FOREST, spaceBefore=8, spaceAfter=4)
H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=10.3, leading=13, textColor=INK, spaceBefore=4, spaceAfter=2)
LIST = ParagraphStyle("list", parent=BODY, alignment=TA_LEFT, spaceAfter=1.5)
CELL = ParagraphStyle("cell", fontName="Times-Roman", fontSize=9, leading=11, textColor=INK)
CELL_HEAD = ParagraphStyle("cellhead", fontName="Helvetica-Bold", fontSize=8.6, leading=10.5, textColor=colors.white)
CAPTION = ParagraphStyle("caption", parent=BODY, fontName="Helvetica-Oblique", fontSize=8.6, leading=11, alignment=TA_CENTER, textColor=MUTED, spaceBefore=2, spaceAfter=6)


def inline(text: str) -> str:
    """Escape XML and convert **bold**, *italic*, `code` and URLs."""
    for k, v in SAFE.items():
        text = text.replace(k, v)
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", text)
    text = re.sub(r"`(.+?)`", r'<font name="Courier" size="9">\1</font>', text)
    text = re.sub(r"(https?://[^\s<]+)", r'<link href="\1" color="#2d5884">\1</link>', text)
    return text


def architecture_figure() -> Drawing:
    """Vector diagram: device -> gateway -> network -> contract -> verifier."""
    width, height = 17 * cm, 4.6 * cm
    d = Drawing(width, height)
    boxes = [
        ("Edge AI device", "simulated sensor", "NPK + anomaly model", "EIP-712 signature"),
        ("Gateway", "dashboard + MetaMask", "or Node CLI", "eth_call preflight"),
        ("Polygon Amoy", "RPC node", "validators -> blocks", "receipts"),
        ("CropLedger.sol", "registry, nonces", "signature check", "storage + events"),
        ("Verifier", "evidence explorer", "recompute hash", "verifyReading()"),
    ]
    arrows = ["signed reading", "transaction", "block", "events / views"]
    box_w, gap = 2.96 * cm, 0.55 * cm
    box_h, y = 2.45 * cm, 1.55 * cm
    for i, (title, *lines) in enumerate(boxes):
        x = i * (box_w + gap)
        fill = FOREST_LIGHT if i != 3 else colors.HexColor("#d8ebde")
        d.add(Rect(x, y, box_w, box_h, rx=6, ry=6, fillColor=fill, strokeColor=FOREST, strokeWidth=0.9))
        d.add(String(x + box_w / 2, y + box_h - 0.55 * cm, title, fontName="Helvetica-Bold", fontSize=8.6, fillColor=FOREST, textAnchor="middle"))
        for j, line in enumerate(lines):
            d.add(String(x + box_w / 2, y + box_h - 1.08 * cm - j * 0.4 * cm, line, fontName="Helvetica", fontSize=6.9, fillColor=INK, textAnchor="middle"))
        if i < len(boxes) - 1:
            ax0, ax1, ay = x + box_w + 0.06 * cm, x + box_w + gap - 0.06 * cm, y + box_h / 2
            d.add(Line(ax0, ay, ax1, ay, strokeColor=FOREST, strokeWidth=1.2))
            d.add(Polygon([ax1, ay, ax1 - 0.16 * cm, ay + 0.09 * cm, ax1 - 0.16 * cm, ay - 0.09 * cm], fillColor=FOREST, strokeColor=FOREST))
            # Arrow label below the boxes, centred under the arrow.
            d.add(String(x + box_w + gap / 2, y - 0.38 * cm, arrows[i], fontName="Helvetica-Oblique", fontSize=6.6, fillColor=MUTED, textAnchor="middle"))
            d.add(Line(x + box_w + gap / 2, y - 0.22 * cm, x + box_w + gap / 2, ay - 0.12 * cm, strokeColor=LINE, strokeWidth=0.5, strokeDashArray=[1.5, 1.5]))
    d.add(String(width / 2, 0.25 * cm, "Full payload kept off-chain; only compact values + the keccak-256 payload hash are stored on-chain.", fontName="Helvetica-Oblique", fontSize=7.4, fillColor=MUTED, textAnchor="middle"))
    return d


def make_table(rows: list[list[str]], col_widths: list[float] | None) -> Table:
    data = [[Paragraph(inline(c), CELL_HEAD if r == 0 else CELL) for c in row] for r, row in enumerate(rows)]
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), FOREST),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f6f8f5")]),
                ("GRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ]
        )
    )
    return table


def team_table(rows: list[list[str]]) -> Table:
    """Title-page table of team members: centred, no grid, header rule."""
    data = [[Paragraph(inline(c.upper() if r == 0 else c), TEAM_HEAD if r == 0 else TEAM) for c in row] for r, row in enumerate(rows)]
    table = Table(data, colWidths=[5.2 * cm, 4.4 * cm], hAlign="CENTER")
    table.setStyle(
        TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, FOREST),
                ("LINEBELOW", (0, -1), (-1, -1), 0.4, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ]
        )
    )
    return table


def team_names(markdown: str) -> list[str]:
    """Names from the title-page table, for the PDF's author field."""
    match = re.search(r"^\| Team member.*\n\|[-| ]+\|\n((?:\|.*\n?)+)", markdown, re.MULTILINE)
    if not match:
        return []
    return [row.strip().strip("|").split("|")[0].strip() for row in match.group(1).splitlines() if row.strip()]


def column_widths(rows: list[list[str]], total: float) -> list[float]:
    """Share the width by content length, but never break inside a word."""
    cols = len(rows[0])
    lengths = [max(min(len(r[c]) if c < len(r) else 0, 70), 8) for r in rows for c in range(cols)]
    per_col = [max(lengths[c::cols]) for c in range(cols)]
    longest_word = [max((len(w) for r in rows if c < len(r) for w in r[c].split()), default=4) for c in range(cols)]
    minimum = [w * 5.4 + 10 for w in longest_word]
    widths = [total * w / sum(per_col) for w in per_col]
    # Raise narrow columns to their minimum, taking the space from the widest.
    for c in range(cols):
        if widths[c] < minimum[c]:
            deficit = minimum[c] - widths[c]
            widths[c] = minimum[c]
            widest = max(range(cols), key=lambda k: widths[k] - minimum[k])
            widths[widest] -= deficit
    return widths


def parse(markdown: str, width: float) -> list:
    story: list = []
    lines = markdown.splitlines()
    i = 0
    in_front_matter = False
    front_paragraphs = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            i += 1
            continue
        if line.startswith("# "):
            story.append(Paragraph(inline(line[2:]), TITLE))
            in_front_matter = True
            i += 1
            continue
        if line.startswith("## "):
            if in_front_matter:
                story.append(Spacer(1, 4))
                story.append(Table([[""]], colWidths=[width], rowHeights=[1.2], style=[("LINEABOVE", (0, 0), (-1, -1), 0.8, FOREST)]))
            in_front_matter = False
            # Avoid a heading stranded at the bottom of a page, without
            # forcing the following (splittable) paragraph to move with it.
            story.append(CondPageBreak(2.2 * cm))
            story.append(Paragraph(inline(line[3:]), H1))
            i += 1
            continue
        if line.startswith("### "):
            story.append(CondPageBreak(2.2 * cm))
            story.append(Paragraph(inline(line[4:]), H2))
            i += 1
            continue
        if line.strip() == "<!-- figure:architecture -->":
            story.append(KeepTogether([architecture_figure(), Paragraph("Figure 1. CropLedger architecture and evidence flow.", CAPTION)]))
            i += 1
            continue
        image = re.match(r"^<!-- image: (.+?) \| (.+?) -->$", line.strip())
        if image:
            path = (HERE.parent / image.group(1)).resolve()
            img = Image(str(path))
            scale = (width * 0.58) / img.imageWidth
            img.drawWidth, img.drawHeight = img.imageWidth * scale, img.imageHeight * scale
            story.append(KeepTogether([img, Paragraph(inline(image.group(2)), CAPTION)]))
            i += 1
            continue
        if line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            if in_front_matter:
                story.extend([Spacer(1, 2), team_table(rows), Spacer(1, 8)])
                continue
            # Tables may split across pages; the header row repeats.
            story.append(make_table(rows, column_widths(rows, width)))
            story.append(Spacer(1, 6))
            continue
        bullet = re.match(r"^- (.*)", line)
        numbered = re.match(r"^\d+\. (.*)", line)
        if bullet or numbered:
            items = []
            pattern = r"^- (.*)" if bullet else r"^\d+\. (.*)"
            while i < len(lines) and re.match(pattern, lines[i]):
                items.append(ListItem(Paragraph(inline(re.match(pattern, lines[i]).group(1)), LIST), leftIndent=12))
                i += 1
            story.append(
                ListFlowable(
                    items,
                    bulletType="bullet" if bullet else "1",
                    start=None if bullet else "1",
                    bulletFormat=None if bullet else "%s.",
                    bulletFontName="Times-Roman",
                    bulletFontSize=9 if bullet else 10,
                    leftIndent=14,
                    bulletOffsetY=0 if not bullet else -1,
                )
            )
            continue
        # Paragraph: join consecutive non-empty lines.
        buf = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||- |\d+\. |<!--)", lines[i]):
            buf.append(lines[i].strip())
            i += 1
        if in_front_matter:
            story.append(Paragraph(inline(" ".join(buf)), LEAD if front_paragraphs == 0 else SUBTITLE))
            front_paragraphs += 1
        else:
            story.append(Paragraph(inline(" ".join(buf)), BODY))
    return story


class NumberedCanvas(rl_canvas.Canvas):
    """Adds 'Page X of Y' and a running title to every page."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self.setFont("Helvetica", 7.8)
            self.setFillColor(MUTED)
            self.drawString(2 * cm, 1.2 * cm, "CropLedger - Synopsis Report")
            self.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {self._pageNumber} of {total}")
            super().showPage()
        super().save()


def main() -> int:
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=1.6 * cm,
        bottomMargin=1.8 * cm,
        title="CropLedger: Blockchain-Backed Evidence for Edge AI Crop-Field Data",
        author=", ".join(team_names(SOURCE.read_text(encoding="utf-8"))) or "CropLedger team",
        subject="Synopsis report - 23CSE335 Blockchain",
        creator="report/build_report.py",
    )
    story = parse(SOURCE.read_text(encoding="utf-8"), doc.width)
    doc.build(story, canvasmaker=NumberedCanvas)

    pages = len(PdfReader(str(OUTPUT)).pages)
    print(f"Wrote {OUTPUT.relative_to(HERE.parent)} ({pages} page{'s' if pages != 1 else ''})")
    if pages > MAX_PAGES:
        print(f"ERROR: the synopsis must not exceed {MAX_PAGES} pages.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
