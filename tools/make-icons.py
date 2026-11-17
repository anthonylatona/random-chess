"""Generate the extension's original geometric shuffle mark; requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parents[1] / 'icons'
out.mkdir(exist_ok=True)
for size in (16, 32, 48, 128):
    image = Image.new('RGBA', (256, 256))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, 255, 255), radius=52, fill='#5146a9')
    draw.line([(49, 74), (91, 74), (166, 181), (204, 181)], fill='white', width=17, joint='curve')
    draw.line([(49, 181), (91, 181), (166, 74), (204, 74)], fill='white', width=17, joint='curve')
    draw.polygon([(188, 49), (216, 74), (188, 99)], fill='white')
    draw.polygon([(188, 156), (216, 181), (188, 206)], fill='white')
    image.resize((size, size), Image.Resampling.LANCZOS).save(out / f'{size}.png')
