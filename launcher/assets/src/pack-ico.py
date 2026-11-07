"""Pack PNG frames into a Windows .ico.

Frames up to 64px are stored as classic 32-bit DIBs (maximum compatibility with
the Win32 resource compiler and System.Drawing.Icon); larger frames as PNG.
Usage: python3 pack-ico.py out.ico frame1.png frame2.png ...
"""
import struct
import sys
import io
from PIL import Image


def dib(im):
    w, h = im.size
    px = im.convert('RGBA').tobytes()
    rows = []
    for y in range(h - 1, -1, -1):  # bottom-up
        row = bytearray()
        for x in range(w):
            r, g, b, a = px[(y * w + x) * 4:(y * w + x) * 4 + 4]
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    header = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    mask_row = ((w + 31) // 32) * 4
    return header + b''.join(rows) + bytes(mask_row * h)


def main():
    out, frames = sys.argv[1], sys.argv[2:]
    images = [Image.open(f).convert('RGBA') for f in frames]
    images.sort(key=lambda im: im.size[0])
    blobs = []
    for im in images:
        if im.size[0] > 64:
            buf = io.BytesIO()
            im.save(buf, format='PNG')
            blobs.append(buf.getvalue())
        else:
            blobs.append(dib(im))
    offset = 6 + 16 * len(images)
    data = struct.pack('<HHH', 0, 1, len(images))
    for im, blob in zip(images, blobs):
        w = im.size[0]
        data += struct.pack('<BBBBHHII', 0 if w >= 256 else w, 0 if w >= 256 else w, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    with open(out, 'wb') as f:
        f.write(data + b''.join(blobs))


main()
