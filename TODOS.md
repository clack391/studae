# TODOS

Deferred work captured during planning. Each item has enough context to pick up cold.

## Ingest: figure/image extraction from .docx / .pptx
- **What:** Pass 1 added text extraction for .docx (python-docx) and .pptx (python-pptx). It does NOT pull diagrams/images out of those formats (PDF + scanned pages do get figures).
- **Why:** Office handouts often contain labelled diagrams (anatomy, pathways) that the lesson screen should render alongside the text, same as PDF figures.
- **Pros:** Office-doc lessons get the same figure-rich experience as PDFs.
- **Cons:** python-docx/pptx image extraction + storage upload + chunk association is real work; figures are secondary to text for the teach wedge.
- **Context:** Mirror the PDF path in `study-app-backend/app/ingest.py` (`extract_page_images` / figure-row association). Start by pulling embedded media from the docx/pptx zip parts and uploading to the existing `uploads` storage bucket under `<user>/<doc>/figures/`.
- **Depends on / blocked by:** W3 multi-format ingest (text) landing first.

## Ingest: move off FastAPI BackgroundTasks to a job queue
- **What:** Ingest runs as a synchronous FastAPI `BackgroundTask`. Fine for one user; will not hold under concurrent uploads.
- **Why:** When multiple students ingest large scanned books at once, BackgroundTasks share the web process and can starve request handling.
- **Pros:** Reliable ingest under load; retries, visibility, backpressure.
- **Cons:** Adds infra (Celery/RQ + broker) — an innovation token; premature pre-product.
- **Context:** Boring-default is to keep BackgroundTasks until real concurrency exists. Revisit when Henry's cohort (Approach B/C) brings concurrent ingests. The resumable-ingest cursor added in Pass 1 makes a future queue migration easier (work is already page-checkpointed).
- **Depends on / blocked by:** Real multi-user load (Approach C onboarding).
