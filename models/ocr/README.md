# Local OCR model data

The bilingual evidence route uses the Tesseract executable installed on the user's machine and these local data files; it never downloads a model during recognition.

- `chi_sim.traineddata`: official `tesseract-ocr/tessdata_fast` Simplified Chinese data bundled during implementation.
- `eng.traineddata`: English data from the installed local Tesseract tessdata distribution.
- `LICENSE.txt`: Apache License 2.0 covering Tesseract model data.

SHA-256 checksums are in `SHA256SUMS`. The executable is not bundled. Missing data or executable returns an actionable OCR error; supported typed text still works. Raw recognition scores are uncalibrated. Actual clean-layout synthetic image checks: `python3 scripts/validate_ux_ocr.py`, detailed scope in `docs/UX_VALIDATION.md`.
