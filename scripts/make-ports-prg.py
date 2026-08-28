#!/usr/bin/env python3
"""Build ports.prg — full-screen CIA fire test (headless-friendly solid colors).

Black = idle, green = CIA port 2 ($DC00), yellow = CIA port 1 ($DC01), white = both.
"""

from pathlib import Path

ORG = 0x080E


def pet(s: str) -> bytes:
    out = bytearray()
    for ch in s.upper():
        o = ord(ch)
        if 64 <= o <= 90:
            out.append(o - 64)
        else:
            out.append(o)
    return bytes(out)


def assemble() -> bytes:
    # 10 SYS 2062 — same stub as hopper, code begins at $080E
    basic = bytes([0x0C, 0x08, 0x0A, 0x00, 0x9E, 0x30, 0x32, 0x30, 0x36, 0x32, 0x00, 0x00, 0x00])
    body = bytearray()
    labels: dict[str, int] = {}
    patches: list[tuple[int, str, str]] = []

    def here() -> int:
        return ORG + len(body)

    def b(*xs: int) -> None:
        body.extend(xs)

    def rel(name: str) -> None:
        patches.append((len(body), name, "rel"))
        b(0)

    def abs16(name: str) -> None:
        patches.append((len(body), name, "abs"))
        b(0, 0)

    def label(name: str) -> None:
        labels[name] = here()

    # clear screen, black
    b(0xA9, 0x93, 0x20, 0xD2, 0xFF)
    b(0xA9, 0x00, 0x8D, 0x20, 0xD0, 0x8D, 0x21, 0xD0)

    # print banner
    b(0xA2, 0x00)
    label("copy")
    b(0xBD)
    abs16("msg")
    b(0xF0)
    rel("copied")
    b(0x9D, 0x00, 0x04)
    b(0xA9, 0x01, 0x9D, 0x00, 0xD8)
    b(0xE8, 0xD0)
    rel("copy")
    label("copied")

    label("wait")
    b(0xAD, 0x12, 0xD0, 0xC9, 0xFA, 0xD0)
    rel("wait")
    b(0x78, 0xA9, 0xFF, 0x8D, 0x00, 0xDC)
    b(0xAD, 0x00, 0xDC, 0x29, 0x10, 0x85, 0xFB)  # P2 fire bit -> $FB (0 = down)
    b(0xAD, 0x01, 0xDC, 0x29, 0x10, 0x85, 0xFC)  # P1 fire bit -> $FC
    b(0x58)

    b(0xA5, 0xFB, 0xD0)
    rel("p2up")
    b(0xA5, 0xFC, 0xD0)
    rel("p2only")
    b(0xA9, 0x01, 0xD0)  # both → white
    rel("set")
    label("p2only")
    b(0xA9, 0x05, 0xD0)  # P2 → green
    rel("set")
    label("p2up")
    b(0xA5, 0xFC, 0xD0)
    rel("none")
    b(0xA9, 0x07, 0xD0)  # P1 → yellow
    rel("set")
    label("none")
    b(0xA9, 0x00)
    label("set")
    b(0x8D, 0x20, 0xD0, 0x8D, 0x21, 0xD0)
    b(0x4C)
    abs16("wait")

    label("msg")
    body.extend(pet("FIRE  P1=YEL  P2=GRN"))
    b(0x00)

    for off, name, kind in patches:
        target = labels[name]
        if kind == "rel":
            rel8 = target - (ORG + off + 1)
            if rel8 < -128 or rel8 > 127:
                raise SystemExit(f"branch {name} out of range {rel8}")
            body[off] = rel8 & 0xFF
        else:
            body[off] = target & 0xFF
            body[off + 1] = (target >> 8) & 0xFF

    load = (0x0801).to_bytes(2, "little")
    return load + basic + bytes(body)


def main() -> None:
    out = Path("/workspace/public/software/ports.prg")
    data = assemble()
    out.write_bytes(data)
    print(f"wrote {out} {len(data)} bytes")


if __name__ == "__main__":
    main()
