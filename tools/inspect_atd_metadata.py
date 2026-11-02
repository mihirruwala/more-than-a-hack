"""Read the period parameters of an ATD metadata XML and check them against the raw frame ids.

Read-only, local-only, metadata only. It prints the declared frame rate, every provider period
parameter (`first_half_start`, `first_half_end`, ...) converted the way kloppy 3.18.0 converts
them, and, if the raw `_atd.txt` is present, the raw frame-id range from the official
`starter/load_atd.check_alignment_raw`. It never prints a position, a player or a label.

    python tools/inspect_atd_metadata.py --source tactical
    python tools/inspect_atd_metadata.py --source broadcast

How kloppy reads a period parameter (kloppy/infra/serializers/tracking/metrica_epts):

    metadata.py   start_timestamp = value / frame_rate          (seconds)
    reader.py     timestamp = frame_id / frame_rate; a frame belongs to the period whose
                  [start, end] contains it, else period_id = None

So kloppy treats the value as a frame number on the raw `frame_id` counter. This script checks
whether the file is consistent with that reading. It cannot tell you what the exporter meant.

Read the output yourself. The competition terms forbid making the datasets, or extracts of them,
available to any hosted LLM, and that includes pasting this output into a chat.
"""

import argparse
import os
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "starter"))
from games import GAME, SOURCES, require  # noqa: E402
from load_atd import check_alignment_raw  # noqa: E402

# Params
PERIOD_NAMES = ("first_half", "second_half", "first_extra_half", "second_extra_half")


def local_name(tag):
    """'{namespace}Name' -> 'Name'. EPTS exports may or may not declare a namespace."""
    return tag.rsplit("}", 1)[-1]


def find_first(root, name):
    for element in root.iter():
        if local_name(element.tag) == name:
            return element
    return None


def child_text(element, name):
    for child in element:
        if local_name(child.tag) == name:
            return (child.text or "").strip()
    return None


def read_metadata(path):
    """{'frame_rate': str|None, 'global': {name: value}} from ProviderGlobalParameters only."""
    root = ET.parse(path).getroot()
    rate = find_first(root, "FrameRate")
    params = {}
    container = find_first(root, "ProviderGlobalParameters")
    if container is not None:
        for parameter in container:
            if local_name(parameter.tag) != "ProviderParameter":
                continue
            name, value = child_text(parameter, "Name"), child_text(parameter, "Value")
            if name:
                params[name] = value
    return {"frame_rate": (rate.text or "").strip() if rate is not None else None, "global": params}


def as_number(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def clock(seconds):
    minutes, rest = divmod(seconds, 60.0)
    return "{:d}:{:05.2f}".format(int(minutes), rest)


def periods(meta):
    """[(name, start_raw, end_raw)] in kloppy's order, stopping at the first missing start."""
    out = []
    for name in PERIOD_NAMES:
        start, end = meta["global"].get(name + "_start"), meta["global"].get(name + "_end")
        if start is None:
            break
        out.append((name, start, end))
    return out


def report(source, data_dir=None):
    """The whole report as a list of lines, so it can be tested without capturing stdout."""
    lines = []
    meta_path = require(["atd_meta"], GAME, data_dir, source)[0]
    meta = read_metadata(meta_path)
    lines.append("source      {}".format(source))
    lines.append("metadata    {}".format(os.path.basename(meta_path)))

    rate = as_number(meta["frame_rate"])
    lines.append("frame rate  {}".format(meta["frame_rate"] if meta["frame_rate"] else "NOT FOUND"))
    if rate is not None and rate != int(rate):
        lines.append("            note: kloppy reads it with int(...), which fails on a non-integer string")

    try:
        raw = check_alignment_raw(GAME, data_dir, source)
    except IOError:
        raw = None
    if raw:
        first, last = raw["frame_id_range"]
        lines.append("raw ids     {}..{}  ({} records, contiguous: {}, expected {} video frames, agrees: {})".format(
            first, last, raw["n_records"], raw["contiguous"], raw["n_video_frames"], raw["agrees"]))
    else:
        lines.append("raw ids     _atd.txt not found; range checks skipped")

    found = periods(meta)
    lines.append("")
    if not found:
        lines.append("periods     no *_start parameters; kloppy would build no periods")
    for name, start_text, end_text in found:
        lines.append(name)
        for label, text in (("start", start_text), ("end", end_text)):
            value = as_number(text)
            if value is None:
                lines.append("  {:<6} {!r}  not a number".format(label, text))
                continue
            note = ""
            if rate:
                note = "-> {} into the counter at {:g} fps (kloppy's reading)".format(clock(value / rate), rate)
            if raw:
                first, last = raw["frame_id_range"]
                inside = first <= value <= last
                note += "  [{} raw id range]".format("inside" if inside else "OUTSIDE")
            lines.append("  {:<6} {:<12g} {}".format(label, value, note))
        start, end = as_number(start_text), as_number(end_text)
        if start is not None and end is not None and rate:
            lines.append("  length {:g} frames = {}".format(end - start, clock((end - start) / rate)))

    other = sorted(k for k in meta["global"] if not any(k.startswith(p + "_") for p in PERIOD_NAMES))
    if other:
        lines.append("")
        lines.append("other provider parameters: {}".format(", ".join(other)))

    lines.append("")
    lines.append("This checks consistency with kloppy's reading, not what the exporter intended.")
    lines.append("Keep this output local: do not paste it into a hosted LLM (competition terms).")
    return lines


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", choices=sorted(SOURCES), default="tactical")
    parser.add_argument("--data-dir", default=None, help="defaults to MTAH_DATA_DIR or ./data")
    args = parser.parse_args()
    try:
        print("\n".join(report(args.source, args.data_dir)))
    except IOError as error:
        print(error)
        sys.exit(1)
