# Authored synthetic OCR fixtures

Three independently authored clean PNG layouts: Chinese receipt, bank rows and fund valuation. They contain invented figures and no real financial accounts or screenshots. Ground-truth fields are defined in `scripts/validate_ux_ocr.py`. The API runs real local OCR against the PNGs, not their labels or mock text. Broad vendor/template accuracy is not inferred from these three fixtures.

To regenerate on macOS, use the included Swift/AppKit script and system PingFang font:

```bash
swift -module-cache-path /private/tmp/wallet-swift-module-cache scripts/render_ocr_fixtures.swift "$PWD/tests/fixtures/evidence"
python3 scripts/validate_ux_ocr.py
```

The system font is not redistributed. Fixtures and rendering script are original project test content.
