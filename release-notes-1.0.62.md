## Pulse Med 1.0.62

The PDF reader becomes a proper study tool: a library shelf, book contents, OCR engine choice and teaching notes that are saved per book.

### PDF reader
- **Library shelf:** the reader opens on your books, grouped by subject. Click a book to open it; **Library** returns to the shelf.
- **Book contents:** **Scan whole book** reads every page and builds units, chapters, sections and topics as dropdowns with page numbers. A printed contents page is used when the book has one. Import from bookmarks is also available, and entries you add by hand are kept.
- **Scanned pages:** PDFs with JPEG 2000 or JBIG2 images now render. Previously these pages showed as blank.
- **Selection:** selected text in the OCR layer shows only a highlight, not the letters on top of the page.

### OCR
- **Engine choice:** Tesseract (on this device, the default) or NVIDIA nemotron-ocr-v2 (hosted). The hosted engine cleaned up most of the low-confidence words on the scans we tested. Pages are sent to NVIDIA when you use it.

### Teaching notes
- **Structured notes:** each note has a takeaway, sections, step strips, comparison tables, exam traps and self-check questions with hidden answers.
- **Read from the page image:** each page is read from its image, then the note is written from those readings. Pages that cannot be read fall back to the text layer, and the note says so.
- **Notes button on each chapter:** creates notes for that chapter's page range.
- **Saved per book:** notes survive a reload, show only in their own book, and can be deleted one by one.
- **Web check:** after each note, the riskiest claims are checked against web and PubMed sources. Confirmed claims show their source; conflicts are flagged in red. The check flags problems and never rewrites a note.

### Known limits
- A note can still misread handwriting, and the web check covers only up to 8 claims per note. Check numbers and exceptions against the page.
- Zooming past about 200% can blank a page until you zoom back out.
- The overlapping-letters report when selecting text has not been reproduced yet.
- The installer is not code-signed, so Windows may show a SmartScreen warning.
