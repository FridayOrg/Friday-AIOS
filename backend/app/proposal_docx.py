"""Builds the proposal Word file. All design rules live here (fonts, colours, logos,
header, footer, red "to be determined" text) so the layout is identical every time,
whatever text the AI later writes. The AI never sees or controls any of this.

Input is plain structured content: a client name/contact and an ordered list of
sections, each a title plus one of:
  - "body": free text (see conventions below) — may itself embed a table block
  - "table": {"header": [...], "rows": [[...], ...]} — a clean N-column table, or
    the older [[label, value], ...] shape for a 2-column label/value table
  - "signature_block": True — the client/SPD acceptance-and-signature table
Body text conventions:
  - blank line            -> new paragraph
  - "- " or "• " prefix    -> bullet
  - a short line ending ":" on its own -> sub-heading (Heading 2)
  - a block starting with "TABLE: Col1 | Col2 | ..." (header), followed by one
    "val | val | ..." line per row -> a table, same look as the "table" input shape
  - "[To be determined per client]" anywhere -> that phrase in red
  - " (to be confirmed)" anywhere -> that phrase in orange (a brain default value,
    not something the notes actually confirmed)
"""

import io
import re
from datetime import date, timedelta

from docx import Document
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

from .config import ROOT_DIR
from .proposal_brain import CONFIRM, TBD, spd_signatory, validity_days

LOGO_PATH = ROOT_DIR / "backend" / "proposal_assets" / "spd_logo.png"
COMPANY = "SharePoint Designs"  # proposals are always issued by SPD; see brain company.md

CONTENT_WIDTH_CM = 21.0 - 2 * 2.2  # A4 width minus left/right margins, see _setup_page

FONT = "Arial"
NAVY = RGBColor(0x1F, 0x38, 0x64)
BLACK = RGBColor(0x00, 0x00, 0x00)
GREY = RGBColor(0x8C, 0x8C, 0x8C)
RED = RGBColor(0xC0, 0x00, 0x00)
ORANGE = RGBColor(0xC5, 0x6A, 0x00)
LIGHT_BLUE_HEX = "23A6E0"  # logo blue, used only for the header rule
NAVY_HEX = "1F3864"
BORDER_HEX = "C9D3DD"

_TBD_SPLIT = re.compile(r"(" + re.escape(TBD) + r"|" + re.escape(CONFIRM) + r")")


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def _set_style_font(style, size_pt: float, bold: bool = False, color: RGBColor = BLACK) -> None:
    """Force a style to Arial at a fixed size/colour. Built-in heading styles carry
    theme-font attributes that override font.name, so those are stripped."""
    style.font.name = FONT
    style.font.size = Pt(size_pt)
    style.font.bold = bold
    style.font.italic = False
    style.font.color.rgb = color
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        rfonts.attrib.pop(qn(attr), None)
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(attr), FONT)


def _add_runs(paragraph, text: str, size_pt: float | None = None, color: RGBColor | None = None, bold: bool = False):
    """Add text to a paragraph, turning every TBD marker red and every CONFIRM
    marker (a brain-default value, not a confirmed deal fact) orange."""
    for part in _TBD_SPLIT.split(text):
        if not part:
            continue
        run = paragraph.add_run(part)
        run.font.name = FONT
        if size_pt:
            run.font.size = Pt(size_pt)
        if part == TBD:
            run.font.color.rgb = RED
        elif part == CONFIRM:
            run.font.color.rgb = ORANGE
        elif color is not None:
            run.font.color.rgb = color
        if bold:
            run.font.bold = True
    return paragraph


def _bottom_border(paragraph, color_hex: str, size: int = 8) -> None:
    ppr = paragraph._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(size))
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), color_hex)
    pbdr.append(bottom)
    ppr.append(pbdr)


def _cell_borders(cell, color_hex: str | None, style: str = "single") -> None:
    """Set all four borders of a cell; color_hex=None removes them."""
    tcpr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        if color_hex is None:
            el.set(qn("w:val"), "nil")
        else:
            el.set(qn("w:val"), style)
            el.set(qn("w:sz"), "6")
            el.set(qn("w:color"), color_hex)
        borders.append(el)
    tcpr.append(borders)


def _cell_fill(cell, color_hex: str) -> None:
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), color_hex)
    tcpr.append(shd)


def _add_page_number(paragraph, size_pt: float, color: RGBColor) -> None:
    run = paragraph.add_run()
    run.font.name = FONT
    run.font.size = Pt(size_pt)
    run.font.color.rgb = color
    for tag, text in (("begin", None), (None, "PAGE"), ("end", None)):
        if tag:
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), tag)
        else:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = text
        run._r.append(el)


# ---------------------------------------------------------------------------
# Document parts
# ---------------------------------------------------------------------------

def _setup_styles(doc) -> None:
    _set_style_font(doc.styles["Normal"], 11)
    doc.styles["Normal"].paragraph_format.space_after = Pt(6)
    doc.styles["Normal"].paragraph_format.line_spacing = 1.15
    _set_style_font(doc.styles["Title"], 20, bold=True, color=NAVY)
    _set_style_font(doc.styles["Heading 1"], 14, bold=True, color=NAVY)
    _set_style_font(doc.styles["Heading 2"], 12, bold=True, color=NAVY)
    _set_style_font(doc.styles["List Bullet"], 11)
    doc.styles["Heading 1"].paragraph_format.space_before = Pt(18)
    doc.styles["Heading 1"].paragraph_format.space_after = Pt(6)
    doc.styles["Heading 2"].paragraph_format.space_before = Pt(10)
    doc.styles["Heading 2"].paragraph_format.space_after = Pt(4)
    # The built-in Title style draws a coloured rule under itself; remove it.
    title_ppr = doc.styles["Title"].element.get_or_add_pPr()
    for el in title_ppr.findall(qn("w:pBdr")):
        title_ppr.remove(el)


def _setup_page(doc, client_name: str) -> None:
    section = doc.sections[0]
    section.page_width, section.page_height = Cm(21.0), Cm(29.7)  # A4
    section.left_margin = section.right_margin = Cm(2.2)
    section.top_margin = Cm(2.6)
    section.bottom_margin = Cm(2.2)
    section.header_distance = Cm(1.0)
    section.footer_distance = Cm(1.0)
    # Word treats the first page's header/footer as separate stories from the rest,
    # even though both get identical content here — the cover's own larger logo row
    # lives in the body below this, same as every other page's small top-right logo.
    section.different_first_page_header_footer = True

    for header in (section.header, section.first_page_header):
        header_p = header.paragraphs[0]
        header_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        header_p.add_run().add_picture(str(LOGO_PATH), width=Cm(3.6))
        _bottom_border(header_p, LIGHT_BLUE_HEX)

    for footer in (section.footer, section.first_page_footer):
        p = footer.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _add_runs(p, f"{COMPANY}  •  {client_name}  •  Confidential  |  ", size_pt=8, color=GREY)
        _add_page_number(p, 8, GREY)


def _add_cover(doc, client_name: str, client_contact: str, today: date) -> None:
    # Logo row: client logo placeholder on the left, SPD logo on the right.
    logos = doc.add_table(rows=1, cols=2)
    logos.alignment = WD_TABLE_ALIGNMENT.CENTER
    left, right = logos.rows[0].cells
    left.width, right.width = Cm(8.3), Cm(8.3)

    _cell_borders(left, "BFBFBF", style="dashed")
    left.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    lp = left.paragraphs[0]
    lp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    lp.paragraph_format.space_before = Pt(18)
    lp.paragraph_format.space_after = Pt(18)
    _add_runs(lp, "[Client logo]", size_pt=10, color=GREY)

    _cell_borders(right, None)
    rp = right.paragraphs[0]
    rp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    rp.add_run().add_picture(str(LOGO_PATH), width=Cm(5.2))

    doc.add_paragraph().paragraph_format.space_after = Pt(30)

    title = doc.add_paragraph(style="Title")
    _add_runs(title, client_name)
    subtitle = doc.add_paragraph()
    _add_runs(subtitle, "Proposal", size_pt=13, color=NAVY)
    subtitle.paragraph_format.space_after = Pt(24)

    valid_until = today + timedelta(days=validity_days())
    _add_table(doc, [
        ("Prepared for", f"{client_contact}, {client_name}"),
        ("Prepared by", COMPANY),
        ("Date", today.strftime("%d %B %Y")),
        ("Valid until", valid_until.strftime("%d %B %Y")),
    ])


def _add_table(doc, rows: list[tuple[str, str]], header: tuple[str, str] | None = None) -> None:
    """Two-column label/value table: light grey borders, navy header row if given."""
    table = doc.add_table(rows=0, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    all_rows = ([header] if header else []) + list(rows)
    for i, (label, value) in enumerate(all_rows):
        cells = table.add_row().cells
        cells[0].width, cells[1].width = Cm(4.6), Cm(12.0)
        is_head = header is not None and i == 0
        for cell, text in ((cells[0], label), (cells[1], value)):
            _cell_borders(cell, BORDER_HEX)
            if is_head:
                _cell_fill(cell, NAVY_HEX)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(3)
            p.paragraph_format.space_after = Pt(3)
            _add_runs(
                p, text,
                color=RGBColor(0xFF, 0xFF, 0xFF) if is_head else (NAVY if cell is cells[0] else None),
                bold=is_head or cell is cells[0],
            )
    doc.add_paragraph()


def _add_flex_table(doc, header: list[str], rows: list[list[str]]) -> None:
    """A clean N-column table for content that's naturally tabular — a price
    breakdown, payment milestones, a delivery timeline, phases, a small reference
    grid. Navy header row, thin grey borders, no row striping: matches the plain
    tabular style used across the brain's source proposals. Any TBD marker in a
    cell still renders red, same as body text."""
    n = max(len(header), 1)
    col_cm = CONTENT_WIDTH_CM / n
    table = doc.add_table(rows=0, cols=n)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    header_cells = table.add_row().cells
    for i, text in enumerate(header):
        header_cells[i].width = Cm(col_cm)
        _cell_borders(header_cells[i], BORDER_HEX)
        _cell_fill(header_cells[i], NAVY_HEX)
        p = header_cells[i].paragraphs[0]
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after = Pt(3)
        _add_runs(p, text, color=RGBColor(0xFF, 0xFF, 0xFF), bold=True)

    for row in rows:
        cells = table.add_row().cells
        for i, text in enumerate(row[:n]):
            cells[i].width = Cm(col_cm)
            _cell_borders(cells[i], BORDER_HEX)
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_before = Pt(3)
            p.paragraph_format.space_after = Pt(3)
            _add_runs(p, text)
    doc.add_paragraph()


def _sig_cell(cell, party_label: str, name: str, title: str) -> None:
    """One half of the acceptance-and-signature table: a shaded box with the
    party's name, line underneath for signing, line underneath for the date —
    the table-style signature block used across the brain's source proposals."""
    _cell_fill(cell, "F3F8FB")
    _cell_borders(cell, BORDER_HEX)

    label_p = cell.paragraphs[0]
    label_p.paragraph_format.space_before = Pt(8)
    label_p.paragraph_format.space_after = Pt(2)
    _add_runs(label_p, f"FOR {party_label.upper()}", size_pt=9, color=GREY, bold=True)

    name_p = cell.add_paragraph()
    name_p.paragraph_format.space_after = Pt(1)
    _add_runs(name_p, name, size_pt=13, color=NAVY, bold=True)

    title_p = cell.add_paragraph()
    title_p.paragraph_format.space_after = Pt(12)
    _add_runs(title_p, title)

    sig_p = cell.add_paragraph()
    sig_p.paragraph_format.space_after = Pt(8)
    _add_runs(sig_p, "Signature: " + "_" * 28)

    date_p = cell.add_paragraph()
    date_p.paragraph_format.space_after = Pt(8)
    _add_runs(date_p, "Date: " + "_" * 28)


def _add_signature_block(doc, client_name: str, client_contact: str) -> None:
    """The Acceptance & Signatures section — built deterministically, like Terms:
    the client's own typed contact name and SPD's fixed signatory, never passed
    through the AI."""
    intro = doc.add_paragraph()
    intro.paragraph_format.space_after = Pt(12)
    _add_runs(
        intro,
        f"Signing below confirms {client_name}'s acceptance of the scope, "
        "investment, payment schedule and terms set out in this proposal.",
    )

    table = doc.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    left, right = table.rows[0].cells
    left.width = right.width = Cm(CONTENT_WIDTH_CM / 2)
    # Title is left blank: nobody on our side confirmed this contact is authorised
    # to sign, so the client fills in their own title by hand.
    _sig_cell(left, client_name, client_contact, "")
    spd_name, spd_title = spd_signatory()
    _sig_cell(right, COMPANY, spd_name, spd_title)
    doc.add_paragraph()


_TABLE_BLOCK_RE = re.compile(r"^TABLE:\s*(.+)$", re.IGNORECASE)


def _add_body(doc, text: str) -> None:
    """Render body text using the conventions in the module docstring. A block
    whose first line is "TABLE: Col1 | Col2 | ..." is rendered as a real table
    instead of paragraphs, as long as at least one following line in the same
    block has the same number of "|"-separated cells as the header — otherwise
    it falls back to plain text, so a slightly malformed table degrades safely
    rather than breaking the document."""
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue

        table_match = _TABLE_BLOCK_RE.match(lines[0])
        if table_match:
            header = [c.strip() for c in table_match.group(1).split("|") if c.strip()]
            rows = [[c.strip() for c in ln.split("|")] for ln in lines[1:]]
            rows = [r for r in rows if len(r) == len(header)]
            if header and rows:
                _add_flex_table(doc, header, rows)
                continue

        for line in lines:
            if line[:2] in ("- ", "• ", "* "):
                _add_runs(doc.add_paragraph(style="List Bullet"), line[2:].strip())
            elif line.endswith(":") and len(line) <= 60:
                _add_runs(doc.add_paragraph(style="Heading 2"), line[:-1])
            else:
                _add_runs(doc.add_paragraph(), line)


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------

def build_proposal_docx(client_name: str, client_contact: str, sections: list[dict], today: date) -> bytes:
    """sections: [{"title": str, "table": [[label, value], ...]} or {"title": str, "body": str}]"""
    doc = Document()
    _setup_styles(doc)
    _setup_page(doc, client_name)
    _add_cover(doc, client_name, client_contact, today)

    doc.add_page_break()
    for i, sec in enumerate(sections, start=1):
        doc.add_paragraph(f"{i}. {sec['title']}", style="Heading 1")
        if sec.get("signature_block"):
            _add_signature_block(doc, client_name, client_contact)
        elif sec.get("table"):
            t = sec["table"]
            if isinstance(t, dict):
                _add_flex_table(doc, t["header"], [list(r) for r in t["rows"]])
            else:  # the older 2-column [[label, value], ...] shape
                _add_table(doc, [tuple(r) for r in t])
        else:
            _add_body(doc, sec.get("body") or TBD)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
