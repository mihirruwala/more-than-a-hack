"""Synthetic tests for tools/inspect_atd_metadata.py. Every file here is invented in a temp dir.

    python -m unittest discover -s tests -v
"""

import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))

import inspect_atd_metadata as inspect  # noqa: E402

# A made-up EPTS-shaped metadata file. Values are arbitrary test numbers, not from the match.
XML = """<?xml version="1.0"?>
<main xmlns="urn:test">
  <Metadata>
    <GlobalConfig>
      <FrameRate>25</FrameRate>
      <ProviderGlobalParameters>
        <ProviderParameter><Name>first_half_start</Name><Value>{fs}</Value></ProviderParameter>
        <ProviderParameter><Name>first_half_end</Name><Value>{fe}</Value></ProviderParameter>
        <ProviderParameter><Name>second_half_start</Name><Value>{ss}</Value></ProviderParameter>
        <ProviderParameter><Name>second_half_end</Name><Value>{se}</Value></ProviderParameter>
        <ProviderParameter><Name>best_estimate</Name><Value>x</Value></ProviderParameter>
      </ProviderGlobalParameters>
    </GlobalConfig>
  </Metadata>
</main>
"""


def bundle(folder, fs=1, fe=100, ss=150, se=300, raw_ids=None):
    """Write data/broadcast/BAR-ATH_broadcast_atd.xml (+ .txt if raw_ids) under folder."""
    source_dir = os.path.join(folder, "broadcast")
    os.makedirs(source_dir)
    with open(os.path.join(source_dir, "BAR-ATH_broadcast_atd.xml"), "w") as handle:
        handle.write(XML.format(fs=fs, fe=fe, ss=ss, se=se))
    if raw_ids is not None:
        with open(os.path.join(source_dir, "BAR-ATH_broadcast_atd.txt"), "w") as handle:
            for frame_id in raw_ids:
                handle.write("{}:NaN,NaN,NaN:NaN,NaN,NaN\n".format(frame_id))


class InspectMetadata(unittest.TestCase):

    def test_reads_frame_rate_and_periods_through_a_namespace(self):
        with tempfile.TemporaryDirectory() as folder:
            bundle(folder)
            lines = inspect.report("broadcast", folder)
        text = "\n".join(lines)
        self.assertIn("frame rate  25", text)
        self.assertIn("first_half", text)
        self.assertIn("second_half", text)
        self.assertIn("_atd.txt not found", text)
        self.assertIn("other provider parameters: best_estimate", text)

    def test_converts_frames_the_way_kloppy_does(self):
        with tempfile.TemporaryDirectory() as folder:
            bundle(folder, fe=16448)
            text = "\n".join(inspect.report("broadcast", folder))
        # 16448 / 25 = 657.92 s = 10:57.92
        self.assertIn("10:57.92", text)

    def test_flags_boundaries_outside_the_raw_id_range(self):
        with tempfile.TemporaryDirectory() as folder:
            bundle(folder, fs=1, fe=100, ss=150, se=999, raw_ids=range(1, 301))
            lines = inspect.report("broadcast", folder)
        text = "\n".join(lines)
        self.assertIn("raw ids     1..300", text)
        end_lines = [line for line in lines if line.strip().startswith("end")]
        self.assertIn("[inside raw id range]", end_lines[0])
        self.assertIn("[OUTSIDE raw id range]", end_lines[1])

    def test_never_prints_raw_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            bundle(folder, raw_ids=range(1, 11))
            text = "\n".join(inspect.report("broadcast", folder))
        self.assertNotIn("NaN,NaN", text)

    def test_missing_metadata_is_a_readable_error(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(IOError):
                inspect.report("broadcast", folder)


if __name__ == "__main__":
    unittest.main()
