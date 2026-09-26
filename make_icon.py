"""Build the Toyota icon PNG/ICO for the dashboard executable."""
import os
import cairosvg

HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, "toyota-logo.svg")

sizes = [256, 128, 64, 48, 32]
pngs = []
for s in sizes:
    out = os.path.join(HERE, f"toyota-logo-{s}.png")
    cairosvg.svg2png(url=SVG, write_to=out, output_width=s, output_height=s,
                     background_color="transparent")
    pngs.append(out)
    print("wrote", out)

ico = os.path.join(HERE, "toyota-logo.ico")
from PIL import Image
images = [Image.open(p) for p in pngs]
images[0].save(ico, format="ICO", sizes=[(Image.open(p).width, Image.open(p).height) for p in pngs])
print("wrote", ico)