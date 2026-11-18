"""Build the Agent Workbench vector brand assets and visual guide."""

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.graphics import renderPDF
from reportlab.graphics.shapes import Drawing
from reportlab.graphics.svgpath import SvgPath

IN_PACKAGE = Path(__file__).resolve().parent.name == "06-source"
ROOT = Path(__file__).resolve().parents[2] if IN_PACKAGE else Path(__file__).resolve().parents[1]
KIT = Path(__file__).resolve().parents[1] if IN_PACKAGE else ROOT / "assets/branding/brand-kit-v1"
TEMP = ROOT / "tmp/pdfs/brand-kit"
ARTIFACTS = ROOT / "artifacts"
GUIDE = ROOT / "output/pdf/agent-workbench-brand-guide-v1.pdf"
COLORS = {"orange": "#FF791F", "purple": "#21182F", "violet": "#7051A8", "lavender": "#C7B8E8", "paper": "#F5F1FA", "graphite": "#151219", "white": "#FFFFFF"}
OUTER = "M350 230 H438 L604 440 H916 L878 391 H656 L510 204 H880 C980 204 1060 286 1060 386 V890 C1060 987 986 1060 890 1060 H366 C270 1060 195 985 195 890 V400 C195 306 265 230 350 230 Z"
VISOR = "M286 536 H968 L1018 630 V742 L890 874 H358 L236 742 V630 Z"
LEFT_EYE = "M445 630 H562 Q568 630 568 637 V649 L501 740 Q491 755 477 755 H364 Q357 755 357 747 V734 L422 647 Q433 630 445 630 Z"
RIGHT_EYE = "M771 630 H888 Q895 630 895 637 V649 L828 740 Q818 755 804 755 H691 Q684 755 684 747 V734 L749 647 Q760 630 771 630 Z"
SYMBOL = " ".join([OUTER, VISOR, LEFT_EYE, RIGHT_EYE])
FONT_SOURCE = Path("/usr/share/fonts/open-sans")
FONT_FILES = ["OpenSans-Regular.ttf", "OpenSans-Semibold.ttf", "OpenSans-Bold.ttf"]
LANGUAGE = "pt-BR"
TRANSLATIONS = json.loads(Path(__file__).with_name("brand-kit.en.json").read_text())


def translate(content):
    return TRANSLATIONS.get(content, content) if LANGUAGE == "en" else content


def setup():
    for directory in [TEMP, ARTIFACTS, GUIDE.parent, *[KIT / name for name in ["00-guide", "01-logos/svg", "01-logos/pdf", "01-logos/png", "02-icons", "03-colors", "04-fonts/open-sans", "04-fonts/source-code-pro", "05-applications", "06-source"]]]:
        directory.mkdir(parents=True, exist_ok=True)
    for name in FONT_FILES:
        destination = KIT / "04-fonts/open-sans" / name
        if not destination.exists():
            shutil.copy2(FONT_SOURCE / name, destination)
    for source, target in [
        ("/usr/share/doc/open-sans-fonts/LICENSE.txt", "04-fonts/open-sans/LICENSE.txt"),
        ("/usr/share/fonts/adobe-source-code-pro-fonts/SourceCodePro-Regular.otf", "04-fonts/source-code-pro/SourceCodePro-Regular.otf"),
        ("/usr/share/licenses/adobe-source-code-pro-fonts/LICENSE.md", "04-fonts/source-code-pro/LICENSE.md"),
    ]:
        if not (KIT / target).exists():
            shutil.copy2(source, KIT / target)
    for label, filename in [("Regular", FONT_FILES[0]), ("Semibold", FONT_FILES[1]), ("Bold", FONT_FILES[2])]:
        pdfmetrics.registerFont(TTFont(label, str(KIT / "04-fonts/open-sans" / filename)))


def symbol_svg(color):
    return f'<path fill="{color}" fill-rule="evenodd" d="{SYMBOL}"/>'


def svg_document(width, height, body, viewbox=None, title="Agent Workbench"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="{viewbox or f"0 0 {width} {height}"}" role="img" aria-label="{escape(title)}"><title>{escape(title)}</title>{body}</svg>\n'


def outline_wordmark(text, x, baseline, size, color):
    from fontTools.ttLib import TTFont as OutlineFont
    from fontTools.pens.svgPathPen import SVGPathPen

    font = OutlineFont(KIT / "04-fonts/open-sans/OpenSans-Semibold.ttf")
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    cursor = x
    result = []
    for char in text:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        if pen.getCommands():
            result.append(f'<path fill="{color}" transform="translate({cursor:.4f} {baseline}) scale({scale:.6f} {-scale:.6f})" d="{pen.getCommands()}"/>')
        cursor += font["hmtx"].metrics[name][0] * scale - 1.5
    font.close()
    return "".join(result), cursor


def draw_symbol(c, x, y, size, color):
    drawing = Drawing(1280, 1280)
    drawing.add(SvgPath(SYMBOL, fillColor=HexColor(color), strokeColor=None, fillMode=0))
    c.saveState()
    c.translate(x - 83.5 * size / 1088, y + size + 88 * size / 1088)
    c.scale(size / 1088, -size / 1088)
    renderPDF.draw(drawing, c, 0, 0)
    c.restoreState()


def draw_wordmark(c, x, y, size, color):
    c.setFillColor(HexColor(color))
    text = c.beginText(x, y)
    text.setFont("Semibold", size)
    text.setCharSpace(-1.5 * size / 108)
    text.textOut("agent workbench")
    c.drawText(text)


def rasterize(pdf, output, size=1024, transparent=False):
    command = ["pdftocairo", "-png", "-singlefile", "-scale-to", str(size)]
    if transparent:
        command.append("-transp")
    subprocess.run([*command, str(pdf), str(output.with_suffix(""))], check=True, capture_output=True)


def create_logos():
    for variant, color in [("orange", COLORS["orange"]), ("purple", COLORS["purple"]), ("black", "#000000"), ("white", COLORS["white"])]:
        name = f"awb-symbol-{variant}"
        (KIT / f"01-logos/svg/{name}.svg").write_text(svg_document(1088, 1088, symbol_svg(color), "83.5 88 1088 1088"))
        pdf = KIT / f"01-logos/pdf/{name}.pdf"
        c = canvas.Canvas(str(pdf), pagesize=(1088, 1088))
        draw_symbol(c, 0, 0, 1088, color)
        c.showPage(); c.save()
        rasterize(pdf, KIT / f"01-logos/png/{name}-1024.png", transparent=True)
    for variant, color, text_color in [("dark", COLORS["orange"], COLORS["purple"]), ("light", COLORS["orange"], COLORS["paper"]), ("black", "#000000", "#000000"), ("white", "#FFFFFF", "#FFFFFF")]:
        lettering, right = outline_wordmark("agent workbench", 310, 185, 108, text_color)
        width = math.ceil(right + 60)
        body = f'<g transform="translate(15 20) scale({260 / 1088}) translate(-83.5 -88)">{symbol_svg(color)}</g>{lettering}'
        (KIT / f"01-logos/svg/awb-lockup-{variant}.svg").write_text(svg_document(width, 300, body))
        pdf = KIT / f"01-logos/pdf/awb-lockup-{variant}.pdf"
        c = canvas.Canvas(str(pdf), pagesize=(width, 300))
        draw_symbol(c, 15, 20, 260, color)
        draw_wordmark(c, 310, 115, 108, text_color)
        c.showPage(); c.save()
        rasterize(pdf, KIT / f"01-logos/png/awb-lockup-{variant}-2048.png", 2048, True)
    lettering_a, _ = outline_wordmark("agent", 265, 790, 98, COLORS["paper"])
    lettering_b, _ = outline_wordmark("workbench", 145, 910, 98, COLORS["paper"])
    body = f'<g transform="translate(110 30) scale({620 / 1088}) translate(-83.5 -88)">{symbol_svg(COLORS["orange"])}</g>{lettering_a}{lettering_b}'
    (KIT / "01-logos/svg/awb-lockup-stacked-light.svg").write_text(svg_document(840, 1000, body))


def create_icons():
    for variant, background, foreground in [("purple", COLORS["purple"], COLORS["orange"]), ("orange", COLORS["orange"], COLORS["purple"])]:
        body = f'<rect width="1024" height="1024" rx="220" fill="{background}"/><g transform="translate(75 75) scale({874 / 1088}) translate(-83.5 -88)">{symbol_svg(foreground)}</g>'
        (KIT / f"02-icons/awb-app-icon-{variant}.svg").write_text(svg_document(1024, 1024, body))
        pdf = TEMP / f"app-icon-{variant}.pdf"
        c = canvas.Canvas(str(pdf), pagesize=(1024, 1024))
        c.setFillColor(HexColor(background)); c.roundRect(0, 0, 1024, 1024, 220, fill=1, stroke=0)
        draw_symbol(c, 75, 75, 874, foreground)
        c.showPage(); c.save()
        rasterize(pdf, KIT / f"02-icons/awb-app-icon-{variant}-1024.png", 1024, True)
    source = Image.open(KIT / "02-icons/awb-app-icon-purple-1024.png")
    for size in [16, 24, 32, 48, 64, 128, 192, 256, 512]:
        source.resize((size, size), Image.Resampling.LANCZOS).save(KIT / f"02-icons/awb-app-icon-{size}.png")
    source.save(KIT / "02-icons/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    (KIT / "02-icons/site.webmanifest").write_text(json.dumps({"name": "Agent Workbench", "short_name": "Workbench", "icons": [{"src": f"awb-app-icon-{size}.png", "sizes": f"{size}x{size}", "type": "image/png"} for size in [192, 512]], "theme_color": COLORS["purple"], "background_color": COLORS["purple"], "display": "standalone"}, indent=2))


def contrast(first, second):
    def luminance(color):
        values = [int(color[index:index + 2], 16) / 255 for index in [1, 3, 5]]
        values = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4 for value in values]
        return sum(value * weight for value, weight in zip(values, [.2126, .7152, .0722]))
    light, dark = sorted([luminance(first), luminance(second)], reverse=True)
    return (light + .05) / (dark + .05)


def create_tokens():
    (KIT / "03-colors/tokens.json").write_text(json.dumps({"brand": "Agent Workbench", "version": "1.0", "color": COLORS, "typography": {"interface": "Open Sans", "wordmark": "Open Sans Semibold, supplied as vector outlines", "code": "Source Code Pro"}, "contrast": {"orangeOnPurple": round(contrast(COLORS["orange"], COLORS["purple"]), 2), "purpleOnOrange": round(contrast(COLORS["purple"], COLORS["orange"]), 2), "paperOnPurple": round(contrast(COLORS["paper"], COLORS["purple"]), 2)}}, indent=2))
    (KIT / "03-colors/tokens.css").write_text(":root {\n" + "".join(f"  --awb-{name}: {color};\n" for name, color in COLORS.items()) + "  --awb-font-ui: 'Open Sans', system-ui, sans-serif;\n  --awb-font-code: 'Source Code Pro', monospace;\n}\n")
    palette = "GIMP Palette\nName: Agent Workbench\nColumns: 7\n# RGB screen palette\n"
    palette += "".join(" ".join(str(int(color[index:index + 2], 16)) for index in [1, 3, 5]) + f"\tAWB {name.title()}\n" for name, color in COLORS.items())
    (KIT / "03-colors/agent-workbench.gpl").write_text(palette)


W, H = 960, 600


def text(c, x, y, content, size=12, color="paper", font="Regular"):
    content = translate(content)
    c.setFillColor(HexColor(COLORS.get(color, color))); c.setFont(font, size); c.drawString(x, y, content)


def lines(c, x, y, content, size=13, color="lavender", width=450, leading=None):
    content = translate(content)
    leading = leading or size * 1.6
    current = ""
    for word in content.split():
        test = (current + " " + word).strip()
        if pdfmetrics.stringWidth(test, "Regular", size) > width and current:
            text(c, x, y, current, size, color); y -= leading; current = word
        else: current = test
    if current: text(c, x, y, current, size, color); y -= leading
    return y


def rect(c, x, y, width, height, color, radius=0):
    c.setFillColor(HexColor(COLORS.get(color, color)))
    if radius: c.roundRect(x, y, width, height, radius, fill=1, stroke=0)
    else: c.rect(x, y, width, height, fill=1, stroke=0)


def page(c, number, category, background="purple"):
    rect(c, 0, 0, W, H, background)
    dark = background != "paper"
    ink = "lavender" if dark else "purple"
    text(c, 48, H - 38, "AGENT WORKBENCH", 9, "orange" if dark else "purple", "Bold")
    c.setFillColor(HexColor(COLORS[ink])); c.setFont("Regular", 9); c.drawRightString(W - 48, H - 38, translate(category).upper())
    text(c, 48, 27, "IDENTIDADE VISUAL  /  V1.0  /  NOV 2026", 8, ink)
    c.drawRightString(W - 48, 27, f"{number:02d} / 08")


def heading(c, eyebrow, title, subtitle=None, light=False):
    text(c, 48, 495, translate(eyebrow).upper(), 10, "orange" if not light else "violet", "Semibold")
    text(c, 48, 448, title, 34, "purple" if light else "paper", "Semibold")
    if subtitle: lines(c, 48, 415, subtitle, 12, "violet" if light else "lavender", 810)


def application(c, x, y, width, height):
    scale = width / 864
    c.saveState(); c.translate(x, y); c.scale(scale, scale)
    height /= scale
    rect(c, 0, 0, 864, height, "#151219", 14)
    rect(c, 0, 0, 52, height, "#100D14", 14)
    draw_symbol(c, 7, height - 48, 38, COLORS["orange"])
    for index, label in enumerate(["PE", "TR", "+"]):
        rect(c, 12, height - 93 - index * 42, 29, 29, "purple", 9)
        text(c, 19, height - 83 - index * 42, label, 8, "lavender", "Semibold")
    rect(c, 52, 0, 174, height, "#201928")
    text(c, 70, height - 31, "Pessoal", 13, "paper", "Semibold")
    text(c, 70, height - 49, "AMBIENTE", 6, "lavender")
    rect(c, 66, height - 94, 145, 25, "orange", 6)
    text(c, 78, height - 85, "+ Nova conversa", 8, "purple", "Semibold")
    text(c, 72, height - 123, "Chat       Worker", 8, "lavender")
    text(c, 72, height - 161, "PROJETOS", 6, "lavender", "Semibold")
    for index, label in enumerate(["Agent Workbench", "Uma nova ideia", "Notas do projeto"]):
        text(c, 72, height - 185 - index * 25, label, 8, "paper" if index == 0 else "lavender")
    text(c, 251, height - 28, "Pessoal  /  Agent Workbench  /  Chat", 7, "lavender")
    text(c, 274, height - 101, "Uma ideia começa aqui.", 25, "paper", "Semibold")
    text(c, 275, height - 127, "O teu espaço para pensar e construir.", 10, "lavender")
    for index, label in enumerate(["Explorar uma ideia", "Planear um projeto", "Guardar contexto"]):
        rect(c, 274 + index * 177, height - 234, 163, 70, "#292033", 8)
        text(c, 286 + index * 177, height - 207, label, 9, "paper", "Semibold")
    rect(c, 274, 33, 516, 80, "#2D2338", 12)
    text(c, 291, 84, "O que vamos criar hoje?", 10, "lavender")
    text(c, 291, 49, "+ Contexto", 7, "lavender")
    rect(c, 751, 44, 26, 26, "orange", 8)
    text(c, 759, 52, "+", 15, "purple", "Semibold")
    c.restoreState()


def create_guide():
    c = canvas.Canvas(str(GUIDE), pagesize=(W, H))
    c.setTitle(translate("Agent Workbench - Guia de marca v1.0"))
    c.setAuthor("Agent Workbench")
    c.setSubject(translate("Identidade visual: símbolo, cores, tipografia e aplicações"))

    page(c, 1, "Brand kit")
    draw_symbol(c, 565, 130, 335, COLORS["orange"])
    text(c, 48, 430, "UM ROBÔ. UMA IDENTIDADE.", 10, "orange", "Bold")
    text(c, 44, 340, "agent", 76, "paper", "Semibold")
    text(c, 44, 255, "workbench", 76, "paper", "Semibold")
    lines(c, 48, 190, "Laranja vivo. Roxo profundo. Um símbolo feito para ser reconhecido.", 15, width=400)
    text(c, 48, 81, "GUIA DE MARCA  /  ASSETS VETORIAIS  /  ÍCONES", 9, "lavender")
    c.showPage()

    page(c, 2, "Direção")
    heading(c, "01 / essência", "Um espaço para pensar e construir.", "Uma identidade direta para reunir conversas, código e contexto.")
    for x, title, body in [(48, "Clareza", "Poucas formas, contraste forte e uma hierarquia visual fácil de seguir."), (350, "Presença", "O laranja identifica a marca e destaca a próxima ação na interface roxa."), (652, "Continuidade", "O símbolo mantém a mesma construção em todos os ambientes e formatos.")]:
        rect(c, x, 181, 260, 169, "#2C223A", 12)
        text(c, x + 20, 309, title, 20, "paper", "Semibold")
        lines(c, x + 20, 276, body, 12, width=220)
    text(c, 48, 123, "VOZ", 9, "orange", "Bold")
    text(c, 48, 91, "Clara, próxima e específica. Dizer o que acontece e o que fazer a seguir.", 13, "lavender")
    c.showPage()

    page(c, 3, "Sistema de logos", "paper")
    heading(c, "02 / assinatura", "Um símbolo, várias aplicações.", "O ícone identifica a aplicação. A assinatura completa apresenta o nome.", True)
    rect(c, 48, 150, 274, 226, "purple", 14)
    draw_symbol(c, 85, 174, 200, COLORS["orange"])
    text(c, 48, 124, "Símbolo principal", 11, "purple", "Semibold")
    rect(c, 348, 259, 564, 117, "purple", 12)
    draw_symbol(c, 365, 274, 83, COLORS["orange"])
    draw_wordmark(c, 461, 305, 35, COLORS["paper"])
    draw_symbol(c, 365, 165, 83, COLORS["orange"])
    draw_wordmark(c, 461, 196, 35, COLORS["purple"])
    text(c, 350, 124, "Assinaturas para fundos escuros e claros", 11, "purple", "Semibold")
    text(c, 48, 78, "SVG e PDF são vetoriais. Os SVG das assinaturas têm o lettering convertido em contornos.", 10, "violet")
    c.showPage()

    page(c, 4, "Paleta")
    heading(c, "03 / cor", "O laranja chama. O roxo organiza.")
    swatches = [("orange", "Laranja Workbench", "Marca e ação principal"), ("purple", "Roxo profundo", "Fundo principal"), ("violet", "Violeta", "Elementos secundários"), ("lavender", "Lavanda", "Texto secundário"), ("paper", "Branco lilás", "Texto e fundos claros")]
    for index, (key, label, role) in enumerate(swatches):
        x = 48 + index * 176
        rect(c, x, 235, 160, 136, key, 12)
        if key == "purple":
            c.setStrokeColor(HexColor(COLORS["violet"])); c.roundRect(x, 235, 160, 136, 12, stroke=1, fill=0)
        text(c, x, 211, label, 10, "paper", "Semibold")
        text(c, x, 190, COLORS[key], 13, "paper", "Bold")
        lines(c, x, 167, role, 9, width=160)
    ratio = contrast(COLORS["orange"], COLORS["purple"])
    text(c, 48, 104, translate("Laranja / roxo: {ratio:.2f}:1 de contraste. Em botões laranja, usar texto roxo.").format(ratio=ratio), 12, "lavender")
    text(c, 48, 78, "Paleta RGB para ecrã. Para impressão, converter com o perfil do fornecedor e validar uma prova.", 10, "lavender")
    c.showPage()

    page(c, 5, "Tipografia", "paper")
    heading(c, "04 / tipografia", "Legível, próxima, sem ruído.", "Open Sans para a interface e comunicação. Source Code Pro para código.", True)
    text(c, 48, 333, "Open Sans", 48, "purple", "Semibold")
    text(c, 48, 292, "Aa Bb Cc 0123456789", 23, "violet")
    for x, label, font in [(48, "Regular 400", "Regular"), (252, "Semibold 600", "Semibold"), (480, "Bold 700", "Bold")]:
        text(c, x, 244, label, 14, "purple", font)
    lines(c, 48, 200, "Títulos: Semibold. Corpo: Regular. Ações e ênfase: Semibold ou Bold. Usar uma hierarquia curta e espaço generoso entre os elementos.", 12, "violet", 830)
    rect(c, 48, 83, 864, 70, "purple", 10)
    code = Image.new("RGBA", (1600, 90), (0, 0, 0, 0))
    draw = ImageDraw.Draw(code)
    font = ImageFont.truetype(str(KIT / "04-fonts/source-code-pro/SourceCodePro-Regular.otf"), 44)
    draw.text((0, 0), 'const workspace = { context: "yours" };', font=font, fill=COLORS["orange"])
    code_path = TEMP / "code-sample.png"; code.save(code_path)
    c.drawImage(str(code_path), 70, 93, width=790, height=44, mask="auto")
    text(c, 48, 59, "Fontes e respetivas licenças incluídas em 04-fonts.", 9, "violet")
    c.showPage()

    page(c, 6, "Regras de utilização")
    heading(c, "05 / consistência", "Reconhecível em qualquer escala.")
    draw_symbol(c, 70, 185, 245, COLORS["orange"])
    c.setStrokeColor(HexColor(COLORS["violet"])); c.setDash(4, 4); c.rect(70, 185, 245, 245, stroke=1, fill=0); c.setDash()
    text(c, 86, 156, "Margem livre: 1/8 da largura do símbolo.", 10, "lavender")
    for index, size in enumerate([24, 32, 48, 64]):
        x = 410 + index * 115
        draw_symbol(c, x, 330, size, COLORS["orange"])
        text(c, x, 304, f"{size} px", 10, "lavender")
    text(c, 410, 266, "Mínimos digitais", 15, "paper", "Semibold")
    lines(c, 410, 240, "Símbolo: 24 px. Assinatura horizontal: 160 px de largura. Em tamanhos menores, usar apenas o símbolo.", 12, width=455)
    text(c, 410, 161, "Manter a construção", 15, "paper", "Semibold")
    lines(c, 410, 135, "Preservar proporções e recortes. Usar cor sólida. Evitar contornos, sombras, gradientes, rotações e fundos com pouco contraste.", 12, width=455)
    c.showPage()

    page(c, 7, "Aplicação na interface")
    text(c, 48, 505, "06 / EM CONTEXTO", 10, "orange", "Semibold")
    text(c, 48, 469, "Destaque no sítio certo.", 31, "paper", "Semibold")
    application(c, 95, 105, 770, 310)
    text(c, 95, 77, "Exemplo visual: marca e ação principal em laranja; navegação e contexto em roxo.", 10, "lavender")
    c.showPage()

    page(c, 8, "Entrega")
    heading(c, "07 / ficheiros", "Pronto para usar e continuar.")
    folders = [("01-logos", "SVG com contornos, PDF vetorial e PNG transparente."), ("02-icons", "Ícones de 16 a 1024 px, favicon e manifesto web."), ("03-colors", "Tokens JSON e CSS, mais paleta GIMP."), ("04-fonts", "Open Sans e Source Code Pro, com as licenças originais."), ("05-applications", "Prancha de identidade e exemplo de interface."), ("06-source", "Script de construção dos ficheiros e instruções.")]
    for index, (folder, description) in enumerate(folders):
        y = 350 - index * 43
        text(c, 48, y, folder, 13, "orange", "Semibold")
        text(c, 260, y, description, 11, "lavender")
    text(c, 48, 65, "Usar a variante light em fundo escuro e dark em fundo claro. O símbolo laranja é a versão principal.", 10, "lavender")
    c.showPage(); c.save()
    shutil.copy2(GUIDE, KIT / "00-guide/agent-workbench-brand-guide-v1.pdf")


def create_preview():
    pdf = TEMP / "brand-preview.pdf"
    c = canvas.Canvas(str(pdf), pagesize=(W, H))
    rect(c, 0, 0, W, H, "purple")
    text(c, 45, 553, "AGENT WORKBENCH", 10, "orange", "Bold")
    text(c, 788, 553, "BRAND KIT / 01", 9, "lavender")
    draw_symbol(c, 65, 190, 325, COLORS["orange"])
    text(c, 430, 410, "agent", 60, "paper", "Semibold")
    text(c, 430, 340, "workbench", 60, "paper", "Semibold")
    lines(c, 434, 285, "Um espaço para pensar e construir.", 15, width=450)
    for index, key in enumerate(["orange", "violet", "lavender", "paper"]):
        x = 434 + index * 109
        rect(c, x, 161, 94, 62, key, 10)
        text(c, x, 141, COLORS[key], 9, "lavender")
    text(c, 45, 45, "ROBOT SYMBOL  /  VECTOR LOGOS  /  APP ICONS  /  COLOR SYSTEM", 9, "lavender")
    c.showPage(); c.save()
    rasterize(pdf, ARTIFACTS / f"agent-workbench-brand-kit-preview-{LANGUAGE}.png", 1920)
    shutil.copy2(ARTIFACTS / f"agent-workbench-brand-kit-preview-{LANGUAGE}.png", KIT / "05-applications/brand-board.png")
    app_pdf = KIT / "05-applications/interface-example.pdf"
    c = canvas.Canvas(str(app_pdf), pagesize=(960, 600)); rect(c, 0, 0, 960, 600, "purple")
    application(c, 48, 80, 864, 430)
    text(c, 48, 35, "Agent Workbench - exemplo de aplicação da identidade visual", 11, "lavender")
    c.showPage(); c.save(); rasterize(app_pdf, KIT / "05-applications/interface-example.png", 1920)


def package():
    template = Path(__file__).with_name(f"brand-kit.README.{LANGUAGE}.md")
    (KIT / "README.md").write_text(template.read_text())
    license_source = KIT / "LICENSE" if IN_PACKAGE else ROOT / "assets/branding/LICENSE"
    if license_source.resolve() != (KIT / "LICENSE").resolve():
        shutil.copy2(license_source, KIT / "LICENSE")
    if Path(__file__).resolve() != (KIT / "06-source/build-brand-kit.py").resolve():
        shutil.copy2(Path(__file__), KIT / "06-source/build-brand-kit.py")
    for name in ["brand-kit.en.json", "brand-kit.README.en.md", "brand-kit.README.pt-BR.md"]:
        source = Path(__file__).with_name(name)
        destination = KIT / "06-source" / name
        if source.resolve() != destination.resolve():
            shutil.copy2(source, destination)
    files = sorted(path for path in KIT.rglob("*") if path.is_file() and path.name != "SHA256SUMS")
    (KIT / "SHA256SUMS").write_text("".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(KIT)}\n" for path in files))
    target = ARCHIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(KIT.rglob("*")):
            if path.is_file(): archive.write(path, Path(KIT.name) / path.relative_to(KIT))
    print(json.dumps({"files": len(files) + 1, "zip": str(target), "pdf": str(GUIDE), "contrast": round(contrast(COLORS["orange"], COLORS["purple"]), 2)}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=["pt-BR", "en"], default="pt-BR")
    parser.add_argument("--output", type=Path, help="Destination directory for the complete kit")
    parser.add_argument("--archive", type=Path, help="Destination ZIP path")
    parser.add_argument("--documents-only", action="store_true", help="Reuse existing logos, icons, colors and fonts")
    args = parser.parse_args()
    LANGUAGE = args.language
    original_kit = KIT
    default_kit = KIT if IN_PACKAGE or LANGUAGE == "pt-BR" else ROOT / ".build-cache/brand-kit-v1-en"
    KIT = (args.output or default_kit).resolve()
    ARCHIVE = (args.archive or ARTIFACTS / f"agent-workbench-brand-kit-v1-{LANGUAGE}.zip").resolve()
    TEMP = ROOT / f"tmp/pdfs/brand-kit-{LANGUAGE}"
    GUIDE = ROOT / f"output/pdf/agent-workbench-brand-guide-v1-{LANGUAGE}.pdf"
    if KIT != original_kit.resolve():
        shutil.copytree(original_kit, KIT, dirs_exist_ok=True)
    setup()
    if not args.documents_only:
        create_logos(); create_icons(); create_tokens()
    create_guide(); create_preview(); package()
