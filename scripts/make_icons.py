#!/usr/bin/env python3
"""Génère l'icône Lysto (carré arrondi dégradé violet + triangle play) en PNG,
sans dépendance externe. Les tailles sont ensuite déclinées avec `sips` (macOS)."""
import struct, zlib, subprocess, pathlib

SIZE = 512
SS = 3  # supersampling anti-aliasing

C_TOP = (0x8B, 0x6C, 0xFF)
C_BOT = (0x5A, 0x3E, 0xF0)

HALF = SIZE / 2
RADIUS = SIZE * 0.22
INSET = SIZE * 0.04  # marge transparente autour du carré

# Triangle play (proportions du carré 512)
T1 = (SIZE * 0.40, SIZE * 0.32)
T2 = (SIZE * 0.40, SIZE * 0.68)
T3 = (SIZE * 0.72, SIZE * 0.50)


def in_rounded_rect(x, y):
    half = HALF - INSET
    dx = max(abs(x - HALF) - (half - RADIUS), 0.0)
    dy = max(abs(y - HALF) - (half - RADIUS), 0.0)
    return dx * dx + dy * dy <= RADIUS * RADIUS


def sign(p1, p2, x, y):
    return (x - p2[0]) * (p1[1] - p2[1]) - (p1[0] - p2[0]) * (y - p2[1])


def in_triangle(x, y):
    d1 = sign(T1, T2, x, y)
    d2 = sign(T2, T3, x, y)
    d3 = sign(T3, T1, x, y)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def pixel(px, py):
    """Retourne (r, g, b, a) avec supersampling SSxSS."""
    rect_hits = 0
    tri_hits = 0
    for sy in range(SS):
        for sx in range(SS):
            x = px + (sx + 0.5) / SS
            y = py + (sy + 0.5) / SS
            if in_rounded_rect(x, y):
                rect_hits += 1
                if in_triangle(x, y):
                    tri_hits += 1
    total = SS * SS
    if rect_hits == 0:
        return (0, 0, 0, 0)
    t = py / SIZE
    base = tuple(round(C_TOP[i] + (C_BOT[i] - C_TOP[i]) * t) for i in range(3))
    tri = tri_hits / rect_hits
    rgb = tuple(round(base[i] + (255 - base[i]) * tri) for i in range(3))
    alpha = round(255 * rect_hits / total)
    return (*rgb, alpha)


def write_png(path, size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filtre None
        for x in range(size):
            raw.extend(pixel(x, y))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)


def main():
    icons = pathlib.Path(__file__).resolve().parent.parent / "extension" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    master = icons / "icon-512.png"
    print(f"Génération {master} …")
    write_png(master, SIZE)
    for s in (16, 32, 48, 128, 256):
        out = icons / f"icon-{s}.png"
        subprocess.run(
            ["sips", "-z", str(s), str(s), str(master), "--out", str(out)],
            check=True, capture_output=True,
        )
        print(f"  → {out.name}")
    print("OK")


if __name__ == "__main__":
    main()
