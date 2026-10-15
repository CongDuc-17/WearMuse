"""Create a synthetic photo-shaped JPEG for API smoke testing (NOT a model demo)."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parent.parent
output = root / 'sample' / 'demo_shirt.jpg'
img = Image.new('RGB', (700, 900), '#e3ddcf')
d = ImageDraw.Draw(img)
d.rectangle((0, 0, 700, 450), fill='#c5baa8')
d.rectangle((0, 450, 700, 900), fill='#d0c8bc')
d.polygon([(285, 180), (245, 220), (110, 315), (175, 430), (240, 380),
           (240, 720), (460, 720), (460, 380), (525, 430), (590, 315),
           (455, 220), (415, 180)], fill='#f1e9d5', outline='#443b35', width=5)
d.line([(285, 180), (350, 275), (415, 180)], fill='#79685c', width=8)
d.line([(345, 278), (345, 720)], fill='#bcac91', width=4)
img.save(output, quality=90)
print(output)
