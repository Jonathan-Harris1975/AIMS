import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("gitleaks_report", Path(__file__).parents[1] / "scripts/gitleaks_report.py")
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class SafeReport(unittest.TestCase):
    def test_only_location_metadata_is_published(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.json"
            source.write_text(json.dumps([{"RuleID": "generic-api-key", "File": "env.template", "StartLine": 4,
                "EndLine": 4, "Commit": "a" * 40, "Fingerprint": "fingerprint", "Secret": "NEVER_PUBLISH_VALUE",
                "Match": "NEVER_PUBLISH_MATCH", "Author": "NEVER_PUBLISH_AUTHOR", "Message": "NEVER_PUBLISH_MESSAGE"}]))
            text = report.render(source, root / "public", "owner/repo")
            self.assertIn("/blob/" + "a" * 40 + "/env.template#L4", text)
            for path in (root / "public").iterdir():
                self.assertNotIn("NEVER_PUBLISH", path.read_text())

    def test_missing_invalid_and_empty_are_distinguished(self):
        for content in (None, "not-json", "{}", "[null]"):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / "raw.json"
                if content is not None:
                    source.write_text(content)
                with self.assertRaises(ValueError):
                    report.render(source, root / "public", "owner/repo")
                self.assertIn("not a clean scan", (root / "public/findings.md").read_text())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "raw.json").write_text("[]")
            self.assertIn("0 detected occurrences", report.render(root / "raw.json", root / "public", "owner/repo"))


if __name__ == "__main__":
    unittest.main()
